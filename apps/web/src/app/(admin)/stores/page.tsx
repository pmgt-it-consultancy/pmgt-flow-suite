"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [typeFilter, setTypeFilter] = useState<"all" | "parent" | "branch">("all");
  const [vatFilter, setVatFilter] = useState<"all" | "vat" | "non-vat">("all");
  const [contactFilter, setContactFilter] = useState<"all" | "with-contact" | "missing-contact">(
    "all",
  );
  const [sortBy, setSortBy] = useState<"name" | "type" | "vat" | "branches">("name");

  // Queries
  const stores = useQuery(api.stores.list, isAuthenticated ? {} : "skip");

  const filteredStores = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = stores?.filter((store) => {
      if (statusFilter !== "all" && store.isActive !== (statusFilter === "active")) return false;
      if (typeFilter !== "all" && Boolean(store.parentId) !== (typeFilter === "branch")) {
        return false;
      }
      if (vatFilter === "vat" && store.vatRate <= 0) return false;
      if (vatFilter === "non-vat" && store.vatRate > 0) return false;
      const hasContact = Boolean(store.contactNumber || store.telephone || store.email);
      if (contactFilter === "with-contact" && !hasContact) return false;
      if (contactFilter === "missing-contact" && hasContact) return false;
      if (query) {
        const haystack = [
          store.name,
          store.address1,
          store.address2,
          store.tin,
          store.min,
          store.email,
          store.contactNumber,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    return filtered?.toSorted((a, b) => {
      switch (sortBy) {
        case "type":
          return (
            Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) ||
            a.name.localeCompare(b.name)
          );
        case "vat":
          return b.vatRate - a.vatRate || a.name.localeCompare(b.name);
        case "branches":
          return b.branchCount - a.branchCount || a.name.localeCompare(b.name);
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [stores, searchQuery, statusFilter, typeFilter, vatFilter, contactFilter, sortBy]);

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
      <StoresTable
        stores={stores}
        filteredStores={filteredStores}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        vatFilter={vatFilter}
        onVatFilterChange={setVatFilter}
        contactFilter={contactFilter}
        onContactFilterChange={setContactFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        onResetFilters={() => {
          setSearchQuery("");
          setStatusFilter("active");
          setTypeFilter("all");
          setVatFilter("all");
          setContactFilter("all");
          setSortBy("name");
        }}
        onEdit={handleOpenEdit}
        onDuplicate={handleDuplicate}
      />

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
