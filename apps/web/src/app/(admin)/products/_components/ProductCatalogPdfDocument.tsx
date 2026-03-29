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
                  style={[product.isActive ? s.tdText : s.tdInactive, { flex: 3, paddingLeft: 4 }]}
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
