"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { StoreFormValues } from "../_schemas";

export function useStoreMutations() {
  const createStore = useMutation(api.stores.create);
  const updateStore = useMutation(api.stores.update);

  const handleCreate = useCallback(
    async (values: StoreFormValues) => {
      await createStore({
        name: values.name,
        parentId: (values.parentId as Id<"stores">) || undefined,
        address1: values.address1,
        address2: values.address2 || undefined,
        tin: values.tin,
        min: values.min || undefined,
        vatRate: values.vatRate,
        contactNumber: values.contactNumber || undefined,
        telephone: values.telephone || undefined,
        email: values.email || undefined,
        website: values.website || undefined,
        socials: values.socials.length > 0 ? values.socials : undefined,
        footer: values.footer || undefined,
        schedule: values.schedule,
      });
      toast.success("Store created successfully");
    },
    [createStore],
  );

  const handleUpdate = useCallback(
    async (values: StoreFormValues, storeId: Id<"stores">) => {
      await updateStore({
        storeId,
        name: values.name,
        address1: values.address1,
        address2: values.address2 || undefined,
        tin: values.tin,
        min: values.min || undefined,
        vatRate: values.vatRate,
        contactNumber: values.contactNumber || undefined,
        telephone: values.telephone || undefined,
        email: values.email || undefined,
        website: values.website || undefined,
        socials: values.socials.length > 0 ? values.socials : undefined,
        footer: values.footer || undefined,
        isActive: values.isActive,
        schedule: values.schedule,
      });
      toast.success("Store updated successfully");
    },
    [updateStore],
  );

  return { handleCreate, handleUpdate };
}
