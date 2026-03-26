"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { StoreFormDialog, StoresTable } from "./_components";
import { type StoreFormValues, storeDefaults } from "./_schemas";

export default function StoresPage() {
  const { isAuthenticated } = useAuth();

  // Local dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"stores"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<StoreFormValues | undefined>(
    undefined,
  );

  // Queries
  const stores = useQuery(api.stores.list, isAuthenticated ? {} : "skip");

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setFormInitialValues(undefined);
    setIsFormOpen(true);
  }, []);

  const handleOpenEdit = useCallback((storeId: Id<"stores">, data: StoreFormValues) => {
    setEditingId(storeId);
    setFormInitialValues(data);
    setIsFormOpen(true);
  }, []);

  const handleDuplicate = useCallback((data: StoreFormValues) => {
    setEditingId(null);
    setFormInitialValues(data);
    setIsFormOpen(true);
  }, []);

  const handleSaveAndCreateAnother = useCallback((): StoreFormValues => {
    return { ...storeDefaults };
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stores</h1>
          <p className="text-gray-500">Manage your stores and branches</p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Store
        </Button>
      </div>

      {/* Stores Table */}
      <StoresTable stores={stores} onEdit={handleOpenEdit} onDuplicate={handleDuplicate} />

      {/* Create/Edit Dialog */}
      <StoreFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
        initialValues={formInitialValues}
        onSaveAndCreateAnother={handleSaveAndCreateAnother}
      />
    </div>
  );
}
