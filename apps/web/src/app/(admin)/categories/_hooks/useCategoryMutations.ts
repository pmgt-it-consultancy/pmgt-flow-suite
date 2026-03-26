"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { CategoryFormValues } from "../_schemas";

export function useCategoryMutations() {
  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);

  const handleCreate = useCallback(
    async (values: CategoryFormValues, storeId: Id<"stores">) => {
      await createCategory({
        storeId,
        name: values.name,
        parentId: values.parentId ? (values.parentId as Id<"categories">) : undefined,
        sortOrder: values.sortOrder,
      });
      toast.success("Category created successfully");
    },
    [createCategory],
  );

  const handleUpdate = useCallback(
    async (values: CategoryFormValues, categoryId: Id<"categories">) => {
      await updateCategory({
        categoryId,
        name: values.name,
        parentId: values.parentId ? (values.parentId as Id<"categories">) : undefined,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
      });
      toast.success("Category updated successfully");
    },
    [updateCategory],
  );

  return { handleCreate, handleUpdate };
}
