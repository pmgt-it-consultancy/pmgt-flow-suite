"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { StoreFormDialog, StoresTable } from "./_components";
import { useStoreMutations } from "./_hooks";
import { useStoreFormStore } from "./_stores/useStoreFormStore";

export default function StoresPage() {
  const { isAuthenticated } = useAuth();

  // Zustand store actions
  const { openCreateDialog, openEditDialog } = useStoreFormStore();

  // Mutations hook
  const { handleSubmit } = useStoreMutations();

  // Queries
  const stores = useQuery(api.stores.list, isAuthenticated ? {} : "skip");

  // Get parent stores (for branch creation dropdown)
  const parentStores = stores?.filter((s) => !s.parentId) ?? [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stores</h1>
          <p className="text-gray-500">Manage your stores and branches</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Add Store
        </Button>
      </div>

      {/* Stores Table */}
      <StoresTable stores={stores} onEdit={openEditDialog} />

      {/* Create/Edit Dialog */}
      <StoreFormDialog parentStores={parentStores} onSubmit={handleSubmit} />
    </div>
  );
}
