"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { ProductFormValues } from "../_schemas";

export function useProductMutations() {
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);

  const handleCreate = useCallback(
    async (values: ProductFormValues, storeId: Id<"stores">) => {
      await createProduct({
        storeId,
        categoryId: values.categoryId as Id<"categories">,
        name: values.name,
        price: values.isOpenPrice ? 0 : values.price,
        isVatable: values.isVatable,
        sortOrder: values.sortOrder,
        isOpenPrice: values.isOpenPrice,
        minPrice: values.isOpenPrice ? values.minPrice : undefined,
        maxPrice: values.isOpenPrice ? values.maxPrice : undefined,
      });
      toast.success("Product created successfully");
    },
    [createProduct],
  );

  const handleUpdate = useCallback(
    async (values: ProductFormValues, productId: Id<"products">) => {
      await updateProduct({
        productId,
        categoryId: values.categoryId as Id<"categories">,
        name: values.name,
        price: values.isOpenPrice ? 0 : values.price,
        isVatable: values.isVatable,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
        isOpenPrice: values.isOpenPrice,
        minPrice: values.isOpenPrice ? values.minPrice : undefined,
        maxPrice: values.isOpenPrice ? values.maxPrice : undefined,
      });
      toast.success("Product updated successfully");
    },
    [updateProduct],
  );

  return { handleCreate, handleUpdate };
}
