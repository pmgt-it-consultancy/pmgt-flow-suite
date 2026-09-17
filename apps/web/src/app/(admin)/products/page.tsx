"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import { DownloadProductCatalogButton, ProductFormDialog, ProductsDataTable } from "./_components";
import { type ProductFormValues, productDefaults } from "./_schemas";

const PRODUCTS_PAGE_SIZE = 50;

interface ProductFilters {
  statusFilter: "all" | "active" | "inactive";
  categoryFilter: Id<"categories"> | "all";
  priceFilter: "all" | "fixed" | "open";
  vatFilter: "all" | "vat" | "non-vat";
  modifierFilter: "all" | "with" | "without";
  searchQuery: string;
}

function matchesProductFilters(
  product: {
    isActive: boolean;
    categoryId: Id<"categories">;
    isOpenPrice?: boolean;
    isVatable: boolean;
    hasModifiers: boolean;
    name: string;
    categoryName: string;
  },
  filters: ProductFilters,
): boolean {
  const { statusFilter, categoryFilter, priceFilter, vatFilter, modifierFilter, searchQuery } =
    filters;
  if (statusFilter !== "all" && product.isActive !== (statusFilter === "active")) return false;
  if (categoryFilter !== "all" && product.categoryId !== categoryFilter) return false;
  if (priceFilter !== "all" && (product.isOpenPrice ? "open" : "fixed") !== priceFilter) {
    return false;
  }
  if (vatFilter !== "all" && product.isVatable !== (vatFilter === "vat")) return false;
  if (modifierFilter !== "all" && product.hasModifiers !== (modifierFilter === "with")) {
    return false;
  }
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    const matchesName = product.name.toLowerCase().includes(query);
    const matchesCategory = product.categoryName.toLowerCase().includes(query);
    if (!matchesName && !matchesCategory) return false;
  }
  return true;
}

export default function ProductsPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"products"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<ProductFormValues | undefined>();

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Id<"categories"> | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [priceFilter, setPriceFilter] = useState<"all" | "fixed" | "open">("all");
  const [vatFilter, setVatFilter] = useState<"all" | "vat" | "non-vat">("all");
  const [modifierFilter, setModifierFilter] = useState<"all" | "with" | "without">("all");
  const [sortBy, setSortBy] = useState<"menu" | "name" | "category" | "price" | "updated">("menu");
  const includeInactiveProducts = statusFilter !== "active";
  const moveProductSortOrder = useMutation(api.products.moveSortOrder);

  // Queries
  const store = useQuery(
    api.stores.get,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const categories = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const {
    results: products,
    status: productsPageStatus,
    loadMore: loadMoreProducts,
  } = usePaginatedQuery(
    api.products.listPaginated,
    isAuthenticated && selectedStoreId
      ? {
          storeId: selectedStoreId,
          categoryId: categoryFilter === "all" ? undefined : categoryFilter,
          includeInactive: includeInactiveProducts,
        }
      : "skip",
    { initialNumItems: PRODUCTS_PAGE_SIZE },
  );
  // Full, unpaginated catalog — the PDF export must include every matching
  // product, not just what's currently loaded in the paginated table below.
  const allProductsForExport = useQuery(
    api.products.list,
    isAuthenticated && selectedStoreId
      ? { storeId: selectedStoreId, includeInactive: includeInactiveProducts }
      : "skip",
  );
  const modifierAssignments = useQuery(
    api.modifierAssignments.getForStore,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const productFilters: ProductFilters = useMemo(
    () => ({
      statusFilter,
      categoryFilter,
      priceFilter,
      vatFilter,
      modifierFilter,
      searchQuery,
    }),
    [statusFilter, categoryFilter, priceFilter, vatFilter, modifierFilter, searchQuery],
  );

  // Filtered products (drives the on-screen, paginated table)
  const filteredProducts = useMemo(() => {
    const filtered = products.filter((p) => matchesProductFilters(p, productFilters));

    return filtered.toSorted((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "category":
          return (
            a.categoryName.localeCompare(b.categoryName) ||
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name)
          );
        case "price":
          return a.price - b.price || a.name.localeCompare(b.name);
        case "updated":
          return b.updatedAt - a.updatedAt;
        default:
          return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
      }
    });
  }, [products, productFilters, sortBy]);

  // Filtered products for the PDF export — sourced from the full catalog so
  // the export never silently omits products the table hasn't loaded yet.
  const filteredProductsForExport = useMemo(() => {
    return allProductsForExport?.filter((p) => matchesProductFilters(p, productFilters));
  }, [allProductsForExport, productFilters]);

  const catalogPdfData = useMemo(() => {
    if (!filteredProductsForExport || !store) return null;

    // Build modifier lookup: productId -> groups
    const modifierMap = new Map<
      string,
      NonNullable<typeof modifierAssignments>[number]["groups"]
    >();
    if (modifierAssignments) {
      for (const entry of modifierAssignments) {
        modifierMap.set(entry.productId, entry.groups);
      }
    }

    // Build category lookup for parent/child grouping
    const categoryLookup = new Map<
      string,
      { name: string; parentId?: string; sortOrder: number }
    >();
    if (categories) {
      for (const cat of categories) {
        categoryLookup.set(cat._id, {
          name: cat.name,
          parentId: cat.parentId,
          sortOrder: cat.sortOrder,
        });
      }
    }

    // Group products by category, showing "ParentCategory > SubCategory" for subcategories
    const grouped = new Map<
      string,
      {
        sortKey: string;
        products: NonNullable<typeof filteredProductsForExport>;
      }
    >();
    for (const product of filteredProductsForExport) {
      const catInfo = categoryLookup.get(product.categoryId);
      let displayName = product.categoryName ?? "Uncategorized";
      let sortKey = displayName;
      if (catInfo?.parentId) {
        const parentInfo = categoryLookup.get(catInfo.parentId);
        if (parentInfo) {
          displayName = `${parentInfo.name} > ${catInfo.name}`;
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
      totalProducts: filteredProductsForExport.length,
      totalCategories: pdfCategories.length,
      filterLabel: `${categoryLabel} · ${statusLabel}${searchLabel}`,
    };
  }, [
    filteredProductsForExport,
    store,
    categories,
    modifierAssignments,
    categoryFilter,
    statusFilter,
    searchQuery,
  ]);

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    const defaultIsVatable = store ? store.vatRate > 0 : true;
    setFormInitialValues({
      ...productDefaults,
      isVatable: defaultIsVatable,
    });
    setIsFormOpen(true);
  }, [store]);

  const handleOpenEdit = useCallback(
    (product: {
      _id: Id<"products">;
      categoryId: Id<"categories">;
      name: string;
      isOpenPrice?: boolean;
      price: number;
      minPrice?: number;
      maxPrice?: number;
      sortOrder: number;
      isVatable: boolean;
      isActive: boolean;
    }) => {
      setEditingId(product._id);
      setFormInitialValues({
        categoryId: product.categoryId,
        name: product.name,
        isOpenPrice: product.isOpenPrice ?? false,
        price: product.price,
        minPrice: product.minPrice ?? 0,
        maxPrice: product.maxPrice ?? 0,
        sortOrder: product.sortOrder,
        isVatable: product.isVatable,
        isActive: product.isActive,
      });
      setIsFormOpen(true);
    },
    [],
  );

  const handleDuplicate = useCallback(
    (product: {
      categoryId: Id<"categories">;
      name: string;
      isOpenPrice?: boolean;
      price: number;
      minPrice?: number;
      maxPrice?: number;
      sortOrder: number;
      isVatable: boolean;
    }) => {
      setEditingId(null);
      const defaultIsVatable = store ? store.vatRate > 0 : true;
      setFormInitialValues({
        categoryId: product.categoryId,
        name: `${product.name} (Copy)`,
        isOpenPrice: product.isOpenPrice ?? false,
        price: product.price,
        minPrice: product.minPrice ?? 0,
        maxPrice: product.maxPrice ?? 0,
        sortOrder: product.sortOrder,
        isVatable: product.isVatable ?? defaultIsVatable,
        isActive: true,
      });
      setIsFormOpen(true);
    },
    [store],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-gray-500">Manage your product catalog</p>
        </div>
        <div className="flex items-center gap-2">
          {catalogPdfData && (
            <DownloadProductCatalogButton
              data={catalogPdfData}
              disabled={!filteredProductsForExport?.length}
            />
          )}
          <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Products Table with Filters */}
      <ProductsDataTable
        products={products}
        pageStatus={productsPageStatus}
        pageSize={PRODUCTS_PAGE_SIZE}
        onLoadMore={loadMoreProducts}
        filteredProducts={filteredProducts}
        categories={categories}
        selectedStoreId={selectedStoreId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priceFilter={priceFilter}
        onPriceFilterChange={setPriceFilter}
        vatFilter={vatFilter}
        onVatFilterChange={setVatFilter}
        modifierFilter={modifierFilter}
        onModifierFilterChange={setModifierFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        onResetFilters={() => {
          setSearchQuery("");
          setCategoryFilter("all");
          setStatusFilter("active");
          setPriceFilter("all");
          setVatFilter("all");
          setModifierFilter("all");
          setSortBy("menu");
        }}
        onMoveSortOrder={async (args) => {
          await moveProductSortOrder(args);
        }}
        onEdit={handleOpenEdit}
        onDuplicate={handleDuplicate}
      />

      {/* Create/Edit Product Dialog */}
      <ProductFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
        initialValues={formInitialValues}
        onSaveAndCreateAnother={() => {
          const defaultIsVatable = store ? store.vatRate > 0 : true;
          return {
            ...productDefaults,
            isVatable: defaultIsVatable,
          };
        }}
      />
    </div>
  );
}
