"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import { TableFormDialog, TablesDataTable, TabNameDialog } from "./_components";
import { type TableFormValues, tableDefaults } from "./_schemas";

interface EditingTab {
  orderId: Id<"orders">;
  tabName: string;
  tabNumber: number;
}

export default function TablesPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<TableFormValues | undefined>();
  const [editingTab, setEditingTab] = useState<EditingTab | null>(null);

  // Queries
  const tablesWithOrders = useQuery(
    api.tables.listWithOrders,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  // Mutations
  const updateTabName = useMutation(api.orders.updateTabName);

  // Calculate next sort order from current data
  const getNextSortOrder = useCallback(() => {
    return (tablesWithOrders?.reduce((max, t) => Math.max(max, t.sortOrder), -1) ?? -1) + 1;
  }, [tablesWithOrders]);

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setFormInitialValues({
      ...tableDefaults,
      sortOrder: getNextSortOrder(),
    });
    setIsFormOpen(true);
  }, [getNextSortOrder]);

  const handleOpenEdit = useCallback(
    (table: { _id: Id<"tables">; name: string; capacity?: number; sortOrder: number }) => {
      setEditingId(table._id);
      setFormInitialValues({
        name: table.name,
        capacity: table.capacity ?? 4,
        sortOrder: table.sortOrder ?? 0,
        isActive: true, // listWithOrders only returns active tables
      });
      setIsFormOpen(true);
    },
    [],
  );

  const handleDuplicate = useCallback(
    (table: { name: string; capacity?: number }) => {
      setEditingId(null);
      setFormInitialValues({
        name: `${table.name} (Copy)`,
        capacity: table.capacity ?? 4,
        sortOrder: getNextSortOrder(),
        isActive: true,
      });
      setIsFormOpen(true);
    },
    [getNextSortOrder],
  );

  const handleSaveTabName = useCallback(
    async (newName: string) => {
      if (!editingTab) return;
      try {
        await updateTabName({
          orderId: editingTab.orderId,
          tabName: newName,
        });
        toast.success("Tab name updated");
        setEditingTab(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update tab name");
      }
    },
    [editingTab, updateTabName],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tables</h1>
          <p className="text-gray-500">Manage restaurant tables for dine-in orders</p>
        </div>
        <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Table
        </Button>
      </div>

      {/* Tables List */}
      <TablesDataTable
        tablesWithOrders={tablesWithOrders}
        selectedStoreId={selectedStoreId}
        onEdit={handleOpenEdit}
        onDuplicate={handleDuplicate}
        onEditTab={setEditingTab}
      />

      {/* Create/Edit Table Dialog */}
      <TableFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
        initialValues={formInitialValues}
        onSaveAndCreateAnother={() => ({
          ...tableDefaults,
          sortOrder: getNextSortOrder(),
        })}
      />

      {/* Edit Tab Name Dialog */}
      <TabNameDialog
        editingTab={editingTab}
        onClose={() => setEditingTab(null)}
        onSave={handleSaveTabName}
      />
    </div>
  );
}
