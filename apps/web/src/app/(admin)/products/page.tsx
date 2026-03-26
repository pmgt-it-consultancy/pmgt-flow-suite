"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import { ProductFormDialog, ProductsDataTable } from "./_components";
import { type ProductFormValues, productDefaults } from "./_schemas";

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

  // Queries
  const store = useQuery(
    api.stores.get,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const categories = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const products = useQuery(
    api.products.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  // Filtered products
  const filteredProducts = useMemo(
    () =>
      products?.filter((p) => {
        if (statusFilter !== "all" && p.isActive !== (statusFilter === "active")) return false;
        if (categoryFilter !== "all" && p.categoryId !== categoryFilter) return false;
        if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
      }),
    [products, statusFilter, categoryFilter, searchQuery],
  );

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
        <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Product
        </Button>
      </div>

      {/* Products Table with Filters */}
      <ProductsDataTable
        products={products}
        filteredProducts={filteredProducts}
        categories={categories}
        selectedStoreId={selectedStoreId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
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
