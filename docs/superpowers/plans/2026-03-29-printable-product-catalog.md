# Printable Product Catalog Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Download PDF" button to the products admin page that generates a formatted product catalog PDF grouped by category with modifier details.

**Architecture:** A new `ProductCatalogPdfDocument` React-PDF component renders the catalog. A `DownloadProductCatalogButton` client component handles PDF generation and download, following the same pattern as the existing `DownloadPdfButton` in reports. The products page wires up filtered data + modifier assignments to the button.

**Tech Stack:** `@react-pdf/renderer`, Convex `useQuery`, React, TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/src/app/(admin)/products/_components/ProductCatalogPdfDocument.tsx` | Create | React-PDF template for the product catalog |
| `apps/web/src/app/(admin)/products/_components/DownloadProductCatalogButton.tsx` | Create | Client component: generates PDF blob, triggers download |
| `apps/web/src/app/(admin)/products/_components/index.ts` | Modify | Add barrel exports for new components |
| `apps/web/src/app/(admin)/products/page.tsx` | Modify | Add download button to page header, query modifier assignments |

---

## Chunk 1: PDF Document Component

### Task 1: Create ProductCatalogPdfDocument

**Files:**
- Create: `apps/web/src/app/(admin)/products/_components/ProductCatalogPdfDocument.tsx`

- [ ] **Step 1: Create the PDF document component**

Create the React-PDF component with types, styles, and rendering logic. Follow the same patterns as `ReportPdfDocument.tsx` (StyleSheet.create, Helvetica font family, same color scheme).

```tsx
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// ── Types ──────────────────────────────────────────────────────

interface ModifierOption {
  name: string;
  priceAdjustment: number;
}

interface ModifierGroup {
  groupName: string;
  selectionType: "single" | "multi";
  minSelections: number;
  maxSelections?: number;
  options: ModifierOption[];
}

interface ProductRow {
  name: string;
  categoryName: string;
  price: number;
  isOpenPrice: boolean;
  minPrice?: number;
  maxPrice?: number;
  isVatable: boolean;
  isActive: boolean;
  modifierGroups: ModifierGroup[];
}

interface CategoryGroup {
  categoryName: string;
  products: ProductRow[];
}

export interface ProductCatalogPdfDocumentProps {
  storeName: string;
  categories: CategoryGroup[];
  totalProducts: number;
  totalCategories: number;
  filterLabel: string; // e.g. "All Categories · Active & Inactive"
}

// ── Helpers ────────────────────────────────────────────────────

const fmt = (amount: number): string =>
  `PHP ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const fmtDate = (): string =>
  new Date().toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const fmtDateTime = (): string =>
  new Date().toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatSelectionRule = (group: ModifierGroup): string => {
  const { selectionType, minSelections, maxSelections } = group;
  const required = minSelections > 0;
  if (selectionType === "single") {
    return required ? "required, pick 1" : "optional, pick 1";
  }
  // multi
  if (!required && !maxSelections) return "optional";
  if (!required && maxSelections) return `optional, up to ${maxSelections}`;
  if (required && !maxSelections) return `min ${minSelections}`;
  return `${minSelections}–${maxSelections}`;
};

// ── Styles ─────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#1F2937" },
  header: { marginBottom: 20, textAlign: "center" },
  storeName: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#6B7280", marginBottom: 16 },
  section: { marginBottom: 12 },
  categoryHeader: {
    flexDirection: "row",
    backgroundColor: "#EFF6FF",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#BFDBFE",
    marginTop: 8,
  },
  categoryName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1E40AF",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F9FAFB",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#F3F4F6",
  },
  tableRowAlt: { backgroundColor: "#FAFAFA" },
  thText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#6B7280" },
  tdText: { fontSize: 8 },
  tdRight: { fontSize: 8, textAlign: "right" },
  tdInactive: { fontSize: 8, color: "#9CA3AF" },
  modifierRow: {
    paddingVertical: 3,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: "#F3F4F6",
  },
  modifierGroupName: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#6B7280",
    marginBottom: 2,
  },
  modifierOptions: {
    fontSize: 7,
    color: "#9CA3AF",
  },
  footer: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    textAlign: "center",
  },
  footerText: { fontSize: 8, color: "#9CA3AF" },
  badge: {
    fontSize: 7,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
});

// ── Component ──────────────────────────────────────────────────

export const ProductCatalogPdfDocument = ({
  storeName,
  categories,
  totalProducts,
  totalCategories,
  filterLabel,
}: ProductCatalogPdfDocumentProps) => (
  <Document>
    <Page size="A4" style={s.page}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.storeName}>{storeName}</Text>
        <Text style={s.title}>Product Catalog</Text>
        <Text style={s.subtitle}>
          {fmtDate()} · {filterLabel}
        </Text>
      </View>

      {/* Category Groups */}
      {categories.map((cat) => (
        <View key={cat.categoryName} style={s.section}>
          {/* Category Header */}
          <View style={s.categoryHeader}>
            <Text style={s.categoryName}>
              {cat.categoryName} ({cat.products.length})
            </Text>
          </View>

          {/* Column Headers (repeated per category for multi-page readability) */}
          <View style={s.tableHeader}>
            <Text style={[s.thText, { flex: 3 }]}>Product</Text>
            <Text style={[s.thText, { flex: 2, textAlign: "right" }]}>Price</Text>
            <Text style={[s.thText, { flex: 1, textAlign: "center" }]}>VAT</Text>
            <Text style={[s.thText, { flex: 1, textAlign: "center" }]}>Status</Text>
          </View>

          {/* Product Rows */}
          {cat.products.map((product, i) => (
            <View key={`${cat.categoryName}-${product.name}-${i}`}>
              <View style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                <Text
                  style={[
                    product.isActive ? s.tdText : s.tdInactive,
                    { flex: 3, paddingLeft: 4 },
                  ]}
                >
                  {product.name}
                </Text>
                <Text
                  style={[
                    product.isActive ? s.tdRight : s.tdInactive,
                    { flex: 2, textAlign: "right" },
                  ]}
                >
                  {product.isOpenPrice
                    ? `Open (${fmt(product.minPrice ?? 0)} – ${fmt(product.maxPrice ?? 0)})`
                    : fmt(product.price)}
                </Text>
                <Text
                  style={[
                    s.tdText,
                    {
                      flex: 1,
                      textAlign: "center",
                      color: product.isVatable ? "#2563EB" : "#6B7280",
                    },
                  ]}
                >
                  {product.isVatable ? "VAT" : "Non-VAT"}
                </Text>
                <Text
                  style={[
                    s.tdText,
                    {
                      flex: 1,
                      textAlign: "center",
                      color: product.isActive ? "#16A34A" : "#DC2626",
                    },
                  ]}
                >
                  {product.isActive ? "Active" : "Inactive"}
                </Text>
              </View>

              {/* Modifier Groups */}
              {product.modifierGroups.map((group) => (
                <View key={group.groupName} style={s.modifierRow}>
                  <Text style={s.modifierGroupName}>
                    └ {group.groupName} ({formatSelectionRule(group)})
                  </Text>
                  <Text style={s.modifierOptions}>
                    {"    "}
                    {group.options
                      .map(
                        (opt) =>
                          `${opt.name}${opt.priceAdjustment !== 0 ? ` (${opt.priceAdjustment > 0 ? "+" : ""}${fmt(opt.priceAdjustment)})` : ""}`,
                      )
                      .join("  ·  ")}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}

      {/* Footer */}
      <View style={s.footer}>
        <Text style={s.footerText}>
          Total: {totalProducts} products · {totalCategories} categories
        </Text>
        <Text style={s.footerText}>Generated: {fmtDateTime()}</Text>
        <Text style={[s.footerText, { marginTop: 4 }]}>Powered by PMGT Flow Suite</Text>
      </View>
    </Page>
  </Document>
);
```

- [ ] **Step 2: Verify the file was created correctly**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck --filter=web`
Expected: No type errors in the new file

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/products/_components/ProductCatalogPdfDocument.tsx
git commit -m "feat(web): add ProductCatalogPdfDocument React-PDF component"
```

---

### Task 2: Create DownloadProductCatalogButton

**Files:**
- Create: `apps/web/src/app/(admin)/products/_components/DownloadProductCatalogButton.tsx`
- Modify: `apps/web/src/app/(admin)/products/_components/index.ts`

- [ ] **Step 1: Create the download button component**

Follow the exact same pattern as `apps/web/src/app/(admin)/reports/_components/DownloadPdfButton.tsx`:

```tsx
"use client";

import { pdf } from "@react-pdf/renderer";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ProductCatalogPdfDocument,
  type ProductCatalogPdfDocumentProps,
} from "./ProductCatalogPdfDocument";

interface DownloadProductCatalogButtonProps {
  data: ProductCatalogPdfDocumentProps;
  disabled?: boolean;
}

export const DownloadProductCatalogButton = ({
  data,
  disabled,
}: DownloadProductCatalogButtonProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const blob = await pdf(<ProductCatalogPdfDocument {...data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const date = new Date().toISOString().split("T")[0];
      link.download = `${data.storeName.replace(/\s+/g, "-")}-product-catalog-${date}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Product catalog PDF downloaded");
    } catch (error) {
      toast.error("Failed to generate PDF");
      console.error("PDF generation error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={disabled || isGenerating}
    >
      {isGenerating ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {isGenerating ? "Generating..." : "Download PDF"}
    </Button>
  );
};
```

- [ ] **Step 2: Update barrel exports**

In `apps/web/src/app/(admin)/products/_components/index.ts`, add:

```ts
export { DownloadProductCatalogButton } from "./DownloadProductCatalogButton";
```

- [ ] **Step 3: Verify types**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck --filter=web`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/products/_components/DownloadProductCatalogButton.tsx apps/web/src/app/\(admin\)/products/_components/index.ts
git commit -m "feat(web): add DownloadProductCatalogButton component"
```

---

## Chunk 2: Wire Up to Products Page

### Task 3: Integrate download button into the products page

**Files:**
- Modify: `apps/web/src/app/(admin)/products/page.tsx`

- [ ] **Step 1: Add modifier assignments query and build PDF data**

In `page.tsx`, add:

1. Import `DownloadProductCatalogButton` from `_components`
2. Import `api` reference for `modifierAssignments.getForStore`
3. Add a `useQuery` call for `modifierAssignments.getForStore` with the selected store ID
4. Add a `useMemo` to transform filtered products into `ProductCatalogPdfDocumentProps`:
   - Group filtered products by `categoryName`
   - Sort groups by category name
   - For each product, look up its modifier groups from the assignments query
   - Build the `filterLabel` string from current filter state

```tsx
// Add these imports at top:
import { DownloadProductCatalogButton } from "./_components";

// After the existing queries, add:
const modifierAssignments = useQuery(
  api.modifierAssignments.getForStore,
  isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
);

// After filteredProducts useMemo, add:
const catalogPdfData = useMemo(() => {
  if (!filteredProducts || !store) return null;

  // Build modifier lookup: productId -> groups
  const modifierMap = new Map<string, NonNullable<typeof modifierAssignments>[number]["groups"]>();
  if (modifierAssignments) {
    for (const entry of modifierAssignments) {
      modifierMap.set(entry.productId, entry.groups);
    }
  }

  // Build category lookup for parent/child grouping
  const categoryLookup = new Map<string, { name: string; parentId?: string; sortOrder: number }>();
  if (categories) {
    for (const cat of categories) {
      categoryLookup.set(cat._id, { name: cat.name, parentId: cat.parentId, sortOrder: cat.sortOrder });
    }
  }

  // Group products by category, showing "ParentCategory > SubCategory" for subcategories
  const grouped = new Map<string, { sortKey: string; products: typeof filteredProducts }>();
  for (const product of filteredProducts) {
    const catInfo = categoryLookup.get(product.categoryId);
    let displayName = product.categoryName ?? "Uncategorized";
    let sortKey = displayName;
    if (catInfo?.parentId) {
      const parentInfo = categoryLookup.get(catInfo.parentId);
      if (parentInfo) {
        displayName = `${parentInfo.name} > ${catInfo.name}`;
        // Sort subcategories after their parent
        sortKey = `${parentInfo.name} > ${catInfo.name}`;
      }
    }
    if (!grouped.has(displayName)) grouped.set(displayName, { sortKey, products: [] });
    grouped.get(displayName)!.products.push(product);
  }

  const pdfCategories = Array.from(grouped.entries())
    .sort(([, a], [, b]) => a.sortKey.localeCompare(b.sortKey))
    .map(([categoryName, { products: prods }]) => ({
      categoryName,
      products: prods.map((p) => ({
        name: p.name,
        categoryName: p.categoryName ?? "Uncategorized",
        price: p.price,
        isOpenPrice: p.isOpenPrice ?? false,
        minPrice: p.minPrice,
        maxPrice: p.maxPrice,
        isVatable: p.isVatable,
        isActive: p.isActive,
        modifierGroups: (modifierMap.get(p._id) ?? []).map((g) => ({
          groupName: g.groupName,
          selectionType: g.selectionType,
          minSelections: g.minSelections,
          maxSelections: g.maxSelections,
          options: g.options.map((o) => ({
            name: o.name,
            priceAdjustment: o.priceAdjustment,
          })),
        })),
      })),
    }));

  // Build filter label
  const categoryLabel =
    categoryFilter === "all"
      ? "All Categories"
      : pdfCategories.length === 1
        ? pdfCategories[0].categoryName
        : `${pdfCategories.length} categories`;
  const statusLabel =
    statusFilter === "all"
      ? "Active & Inactive"
      : statusFilter === "active"
        ? "Active only"
        : "Inactive only";
  const searchLabel = searchQuery ? ` · Search: "${searchQuery}"` : "";

  return {
    storeName: store.name,
    categories: pdfCategories,
    totalProducts: filteredProducts.length,
    totalCategories: pdfCategories.length,
    filterLabel: `${categoryLabel} · ${statusLabel}${searchLabel}`,
  };
}, [filteredProducts, store, categories, modifierAssignments, categoryFilter, statusFilter, searchQuery]);
```

- [ ] **Step 2: Add the download button to the page header**

Replace the header section in the return JSX. The button goes next to "Add Product":

```tsx
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-3xl font-bold tracking-tight">Products</h1>
    <p className="text-gray-500">Manage your product catalog</p>
  </div>
  <div className="flex items-center gap-2">
    {catalogPdfData && (
      <DownloadProductCatalogButton
        data={catalogPdfData}
        disabled={!filteredProducts?.length}
      />
    )}
    <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
      <Plus className="mr-2 h-4 w-4" />
      Add Product
    </Button>
  </div>
</div>
```

- [ ] **Step 3: Verify types and lint**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck --filter=web && pnpm check`
Expected: No errors

- [ ] **Step 4: Manual test**

1. Start dev server: `pnpm dev`
2. Navigate to the products admin page
3. Click "Download PDF" — verify a PDF downloads with products grouped by category
4. Apply a category filter, click download again — verify only that category appears
5. Apply status filter to "Inactive", download — verify inactive products shown
6. Verify modifier groups appear under products that have them

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(admin\)/products/page.tsx
git commit -m "feat(web): add product catalog PDF download to products page"
```
