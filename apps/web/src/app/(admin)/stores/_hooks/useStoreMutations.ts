"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { useStoreFormStore } from "../_stores/useStoreFormStore";

export function useStoreMutations() {
  const createStore = useMutation(api.stores.create);
  const updateStore = useMutation(api.stores.update);

  const { editingStoreId, formData, setIsSubmitting, closeDialog } = useStoreFormStore();

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      if (editingStoreId) {
        await updateStore({
          storeId: editingStoreId,
          name: formData.name,
          address1: formData.address1,
          address2: formData.address2 || undefined,
          tin: formData.tin,
          min: formData.min,
          vatRate: formData.vatRate,
          contactNumber: formData.contactNumber || undefined,
          telephone: formData.telephone || undefined,
          email: formData.email || undefined,
          website: formData.website || undefined,
          socials: formData.socials.length > 0 ? formData.socials : undefined,
          footer: formData.footer || undefined,
          isActive: formData.isActive,
        });
        toast.success("Store updated successfully");
      } else {
        await createStore({
          name: formData.name,
          parentId: formData.parentId,
          address1: formData.address1,
          address2: formData.address2 || undefined,
          tin: formData.tin,
          min: formData.min || undefined,
          vatRate: formData.vatRate,
          contactNumber: formData.contactNumber || undefined,
          telephone: formData.telephone || undefined,
          email: formData.email || undefined,
          website: formData.website || undefined,
          socials: formData.socials.length > 0 ? formData.socials : undefined,
          footer: formData.footer || undefined,
        });
        toast.success("Store created successfully");
      }
      closeDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save store");
    } finally {
      setIsSubmitting(false);
    }
  }, [editingStoreId, formData, createStore, updateStore, setIsSubmitting, closeDialog]);

  return { handleSubmit };
}
