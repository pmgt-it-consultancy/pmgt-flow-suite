"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import { CategoriesDataTable, CategoryFormDialog } from "./_components";
import { type CategoryFormValues, categoryDefaults } from "./_schemas";

export default function CategoriesPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"categories"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<CategoryFormValues | undefined>();

  // Queries
  const categories = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  // Calculate next sort order from current data
  const getNextSortOrder = useCallback(() => {
    return (categories?.reduce((max, c) => Math.max(max, c.sortOrder), -1) ?? -1) + 1;
  }, [categories]);

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
        selectedStoreId={selectedStoreId}
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
