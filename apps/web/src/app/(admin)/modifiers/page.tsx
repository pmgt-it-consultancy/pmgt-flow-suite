"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import { ModifierGroupFormDialog, ModifiersDataTable } from "./_components";
import { type ModifierGroupFormValues, modifierGroupDefaults } from "./_schemas";

export default function ModifiersPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"modifierGroups"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<ModifierGroupFormValues | undefined>();
  const [originalOptionIds, setOriginalOptionIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [selectionFilter, setSelectionFilter] = useState<"all" | "single" | "multi">("all");
  const [optionFilter, setOptionFilter] = useState<"all" | "empty" | "configured">("all");
  const [sortBy, setSortBy] = useState<"menu" | "name" | "options">("menu");

  // Used to load group data before opening the dialog (for edit and duplicate)
  const [loadingGroupId, setLoadingGroupId] = useState<Id<"modifierGroups"> | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // Queries
  const groups = useQuery(
    api.modifierGroups.list,
    isAuthenticated && selectedStoreId
      ? { storeId: selectedStoreId, includeInactive: true }
      : "skip",
  );
  const reorderGroups = useMutation(api.modifierGroups.reorder);

  const filteredGroups = useMemo(() => {
    const filtered = groups?.filter((group) => {
      if (statusFilter !== "all" && group.isActive !== (statusFilter === "active")) return false;
      if (selectionFilter !== "all" && group.selectionType !== selectionFilter) return false;
      if (optionFilter === "empty" && group.optionCount > 0) return false;
      if (optionFilter === "configured" && group.optionCount === 0) return false;
      if (searchQuery && !group.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });

    return filtered?.toSorted((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "options":
          return b.optionCount - a.optionCount || a.name.localeCompare(b.name);
        default:
          return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
      }
    });
  }, [groups, statusFilter, selectionFilter, optionFilter, searchQuery, sortBy]);

  // Query for the group being loaded (to populate form with options)
  const loadingGroup = useQuery(
    api.modifierGroups.get,
    loadingGroupId ? { modifierGroupId: loadingGroupId } : "skip",
  );

  // When loadingGroup data arrives and dialog isn't yet open, populate and open it
  if (loadingGroupId && loadingGroup && !isFormOpen) {
    const availableOptions = loadingGroup.options.filter((o) => o.isAvailable);

    if (isDuplicating) {
      // Duplicate: copy fields but strip option IDs and clear editing ID
      setFormInitialValues({
        name: `${loadingGroup.name} (Copy)`,
        selectionType: loadingGroup.selectionType,
        minSelections: loadingGroup.minSelections,
        maxSelections: loadingGroup.maxSelections,
        isActive: true,
        options:
          availableOptions.length > 0
            ? availableOptions.map((o) => ({
                name: o.name,
                priceAdjustment: o.priceAdjustment,
                isDefault: o.isDefault,
              }))
            : [{ name: "", priceAdjustment: 0, isDefault: false }],
      });
      setEditingId(null);
      setOriginalOptionIds([]);
    } else {
      // Edit: include option IDs for diffing
      setFormInitialValues({
        name: loadingGroup.name,
        selectionType: loadingGroup.selectionType,
        minSelections: loadingGroup.minSelections,
        maxSelections: loadingGroup.maxSelections,
        isActive: loadingGroup.isActive,
        options:
          availableOptions.length > 0
            ? availableOptions.map((o) => ({
                id: o._id,
                name: o.name,
                priceAdjustment: o.priceAdjustment,
                isDefault: o.isDefault,
              }))
            : [{ name: "", priceAdjustment: 0, isDefault: false }],
      });
      setEditingId(loadingGroupId);
      setOriginalOptionIds(availableOptions.map((o) => o._id));
    }

    setLoadingGroupId(null);
    setIsDuplicating(false);
    setIsFormOpen(true);
  }

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setLoadingGroupId(null);
    setIsDuplicating(false);
    setFormInitialValues(modifierGroupDefaults);
    setOriginalOptionIds([]);
    setIsFormOpen(true);
  }, []);

  const handleOpenEdit = useCallback((group: { _id: Id<"modifierGroups"> }) => {
    setLoadingGroupId(group._id);
    setIsDuplicating(false);
  }, []);

  const handleOpenDuplicate = useCallback((group: { _id: Id<"modifierGroups"> }) => {
    setLoadingGroupId(group._id);
    setIsDuplicating(true);
  }, []);

  const handleFormOpenChange = useCallback((open: boolean) => {
    setIsFormOpen(open);
    if (!open) {
      setEditingId(null);
      setLoadingGroupId(null);
      setIsDuplicating(false);
      setOriginalOptionIds([]);
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Modifiers</h1>
          <p className="text-gray-500">Manage modifier groups and options</p>
        </div>
        <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Modifier Group
        </Button>
      </div>

      {/* Groups Table */}
      <ModifiersDataTable
        groups={groups}
        filteredGroups={filteredGroups}
        selectedStoreId={selectedStoreId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        selectionFilter={selectionFilter}
        onSelectionFilterChange={setSelectionFilter}
        optionFilter={optionFilter}
        onOptionFilterChange={setOptionFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        onResetFilters={() => {
          setSearchQuery("");
          setStatusFilter("active");
          setSelectionFilter("all");
          setOptionFilter("all");
          setSortBy("menu");
        }}
        onReorder={async (modifierGroupIds) => {
          await reorderGroups({ modifierGroupIds });
        }}
        onEdit={handleOpenEdit}
        onDuplicate={handleOpenDuplicate}
      />

      {/* Create/Edit Group Dialog */}
      <ModifierGroupFormDialog
        open={isFormOpen}
        onOpenChange={handleFormOpenChange}
        editingId={editingId}
        initialValues={formInitialValues}
        originalOptionIds={originalOptionIds}
        onSaveAndCreateAnother={() => modifierGroupDefaults}
      />
    </div>
  );
}
