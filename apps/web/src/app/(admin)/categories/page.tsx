"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import { CategoriesDataTable, CategoryFormDialog } from "./_components";
import { type CategoryFormValues, categoryDefaults } from "./_schemas";

const CATEGORIES_PAGE_SIZE = 50;

export default function CategoriesPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"categories"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<CategoryFormValues | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [typeFilter, setTypeFilter] = useState<"all" | "main" | "sub">("all");
  const [contentFilter, setContentFilter] = useState<"all" | "with-products" | "empty">("all");
  const [sortBy, setSortBy] = useState<"menu" | "name" | "products">("menu");
  const moveCategorySortOrder = useMutation(api.categories.moveSortOrder);

  // Queries
  const {
    results: categories,
    status: categoriesPageStatus,
    loadMore: loadMoreCategories,
  } = usePaginatedQuery(
    api.categories.listPaginated,
    isAuthenticated && selectedStoreId
      ? { storeId: selectedStoreId, includeInactive: statusFilter !== "active" }
      : "skip",
    { initialNumItems: CATEGORIES_PAGE_SIZE },
  );
  // Full, unpaginated category list — needed for parent-name lookups and for
  // computing a collision-free next sortOrder, neither of which can rely on
  // only what's currently loaded in the paginated table above.
  const allCategoriesForLookup = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId
      ? { storeId: selectedStoreId, includeInactive: true }
      : "skip",
  );

  const filteredCategories = useMemo(() => {
    const filtered = categories.filter((category) => {
      if (statusFilter !== "all" && category.isActive !== (statusFilter === "active")) {
        return false;
      }
      if (typeFilter !== "all" && Boolean(category.parentId) !== (typeFilter === "sub")) {
        return false;
      }
      if (contentFilter === "with-products" && category.productCount === 0) return false;
      if (contentFilter === "empty" && category.productCount > 0) return false;
      if (searchQuery && !category.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });

    return filtered.toSorted((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "products":
          return b.productCount - a.productCount || a.name.localeCompare(b.name);
        default:
          return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
      }
    });
  }, [categories, statusFilter, typeFilter, contentFilter, searchQuery, sortBy]);

  // Calculate next sort order from the full (unpaginated) category list
  const getNextSortOrder = useCallback(() => {
    return (allCategoriesForLookup?.reduce((max, c) => Math.max(max, c.sortOrder), -1) ?? -1) + 1;
  }, [allCategoriesForLookup]);

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setFormInitialValues({
      ...categoryDefaults,
      sortOrder: getNextSortOrder(),
    });
    setIsFormOpen(true);
  }, [getNextSortOrder]);

  const handleOpenEdit = useCallback(
    (category: {
      _id: Id<"categories">;
      name: string;
      parentId?: Id<"categories">;
      sortOrder: number;
      isActive: boolean;
    }) => {
      setEditingId(category._id);
      setFormInitialValues({
        name: category.name,
        parentId: category.parentId,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      });
      setIsFormOpen(true);
    },
    [],
  );

  const handleDuplicate = useCallback(
    (category: { name: string; parentId?: Id<"categories">; sortOrder: number }) => {
      setEditingId(null);
      setFormInitialValues({
        name: `${category.name} (Copy)`,
        parentId: category.parentId,
        sortOrder: getNextSortOrder(),
        isActive: true,
      });
      setIsFormOpen(true);
    },
    [getNextSortOrder],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
          <p className="text-gray-500">Manage product categories</p>
        </div>
        <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Category
        </Button>
      </div>

      {/* Categories Table */}
      <CategoriesDataTable
        categories={categories}
        pageStatus={categoriesPageStatus}
        pageSize={CATEGORIES_PAGE_SIZE}
        onLoadMore={loadMoreCategories}
        allCategories={allCategoriesForLookup}
        filteredCategories={filteredCategories}
        selectedStoreId={selectedStoreId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        contentFilter={contentFilter}
        onContentFilterChange={setContentFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        onResetFilters={() => {
          setSearchQuery("");
          setStatusFilter("active");
          setTypeFilter("all");
          setContentFilter("all");
          setSortBy("menu");
        }}
        onMoveSortOrder={async (args) => {
          await moveCategorySortOrder(args);
        }}
        onEdit={handleOpenEdit}
        onDuplicate={handleDuplicate}
      />

      {/* Create/Edit Category Dialog */}
      <CategoryFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
        initialValues={formInitialValues}
        onSaveAndCreateAnother={() => ({
          ...categoryDefaults,
          sortOrder: getNextSortOrder(),
        })}
      />
    </div>
  );
}
