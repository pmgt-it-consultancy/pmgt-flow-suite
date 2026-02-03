"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, Grid3X3, Layers, Pencil, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/stores/useAdminStore";

interface TableFormData {
  name: string;
  capacity: number;
  sortOrder: number;
  isActive: boolean;
}

const initialFormData: TableFormData = {
  name: "",
  capacity: 4,
  sortOrder: 0,
  isActive: true,
};

export default function TablesPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Id<"tables"> | null>(null);
  const [formData, setFormData] = useState<TableFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Multi-tab state
  const [expandedTableIds, setExpandedTableIds] = useState<Set<Id<"tables">>>(new Set());
  const [editingTab, setEditingTab] = useState<{
    orderId: Id<"orders">;
    tabName: string;
    tabNumber: number;
  } | null>(null);
  const [newTabName, setNewTabName] = useState("");

  // Queries - use listWithOrders for multi-tab support
  const tablesWithOrders = useQuery(
    api.tables.listWithOrders,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  // Mutations
  const createTable = useMutation(api.tables.create);
  const updateTable = useMutation(api.tables.update);
  const updateTabName = useMutation(api.orders.updateTabName);

  const handleOpenCreate = () => {
    setEditingTable(null);
    // Calculate next sort order
    const maxSortOrder = tablesWithOrders?.reduce((max, t) => Math.max(max, t.sortOrder), -1) ?? -1;
    setFormData({
      ...initialFormData,
      sortOrder: maxSortOrder + 1,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (table: NonNullable<typeof tablesWithOrders>[number]) => {
    setEditingTable(table._id);
    setFormData({
      name: table.name,
      capacity: table.capacity ?? 4,
      sortOrder: table.sortOrder ?? 0,
      isActive: true, // listWithOrders only returns active tables
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated || !selectedStoreId) return;

    setIsSubmitting(true);
    try {
      if (editingTable) {
        await updateTable({
          tableId: editingTable,
          name: formData.name,
          capacity: formData.capacity,
          sortOrder: formData.sortOrder,
          isActive: formData.isActive,
        });
        toast.success("Table updated successfully");
      } else {
        await createTable({
          storeId: selectedStoreId,
          name: formData.name,
          capacity: formData.capacity,
          sortOrder: formData.sortOrder,
        });
        toast.success("Table created successfully");
      }
      setIsDialogOpen(false);
      setFormData(initialFormData);
      setEditingTable(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save table");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleExpand = (tableId: Id<"tables">) => {
    setExpandedTableIds((prev) => {
      const next = new Set(prev);
      if (next.has(tableId)) {
        next.delete(tableId);
      } else {
        next.add(tableId);
      }
      return next;
    });
  };

  const handleOpenEditTab = (order: { _id: Id<"orders">; tabName: string; tabNumber: number }) => {
    setEditingTab({
      orderId: order._id,
      tabName: order.tabName,
      tabNumber: order.tabNumber,
    });
    setNewTabName(order.tabName);
  };

  const handleSaveTabName = async () => {
    if (!editingTab) return;

    try {
      await updateTabName({
        orderId: editingTab.orderId,
        tabName: newTabName.trim() || `Tab ${editingTab.tabNumber}`,
      });
      toast.success("Tab name updated");
      setEditingTab(null);
      setNewTabName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tab name");
    }
  };

  const handleResetTabName = () => {
    if (!editingTab) return;
    setNewTabName(`Tab ${editingTab.tabNumber}`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "available":
        return <Badge variant="default">Available</Badge>;
      case "occupied":
        return <Badge variant="secondary">Occupied</Badge>;
      case "reserved":
        return <Badge variant="outline">Reserved</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  return (
    <div className="space-y-6">
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
      <Card>
        <CardHeader>
          <CardTitle>All Tables</CardTitle>
          <CardDescription>{tablesWithOrders?.length ?? 0} table(s) in total</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Grid3X3 className="h-8 w-8 mb-2" />
              <p>Please select a store to view tables.</p>
            </div>
          ) : !tablesWithOrders ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : tablesWithOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Grid3X3 className="h-8 w-8 mb-2" />
              <p>No tables found. Create your first table.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tabs</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Sort Order</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tablesWithOrders.map((table) => (
                  <Fragment key={table._id}>
                    {/* Main table row */}
                    <TableRow
                      className={cn(
                        table.totalTabs > 0 && "cursor-pointer hover:bg-gray-50",
                        expandedTableIds.has(table._id) && "bg-gray-50",
                      )}
                      onClick={() => table.totalTabs > 0 && toggleExpand(table._id)}
                    >
                      <TableCell className="w-8">
                        {table.totalTabs > 0 && (
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 text-gray-400 transition-transform",
                              expandedTableIds.has(table._id) && "rotate-90",
                            )}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Grid3X3 className="h-4 w-4 text-primary" />
                          {table.name}
                        </div>
                      </TableCell>
                      <TableCell>{table.capacity} seats</TableCell>
                      <TableCell>{getStatusBadge(table.status)}</TableCell>
                      <TableCell>
                        {table.totalTabs > 0 ? (
                          <div className="flex items-center gap-1">
                            <Layers className="h-3 w-3 text-gray-400" />
                            {table.totalTabs}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {table.totalItemCount > 0 ? (
                          table.totalItemCount
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {table.totalNetSales > 0 ? (
                          formatCurrency(table.totalNetSales)
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>{table.sortOrder}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(table);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>

                    {/* Expanded tab rows */}
                    {expandedTableIds.has(table._id) &&
                      table.orders.map((order) => (
                        <TableRow key={order._id} className="bg-gray-50">
                          <TableCell />
                          <TableCell className="pl-10">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{order.tabName}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditTab(order);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-gray-500">{order.orderNumber}</span>
                          </TableCell>
                          <TableCell>
                            {order.pax && (
                              <span className="text-xs text-gray-500">{order.pax} pax</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              Tab {order.tabNumber}
                            </Badge>
                          </TableCell>
                          <TableCell>{order.itemCount}</TableCell>
                          <TableCell>{formatCurrency(order.netSales)}</TableCell>
                          <TableCell>
                            <span className="text-xs text-gray-500">
                              {formatDate(order.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Table Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTable ? "Edit Table" : "Create Table"}</DialogTitle>
            <DialogDescription>
              {editingTable
                ? "Update the table details below."
                : "Fill in the details to create a new table."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Table Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Table 1, Booth A"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="capacity">Capacity (seats)</Label>
                <Input
                  id="capacity"
                  type="number"
                  min={1}
                  value={formData.capacity}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      capacity: parseInt(e.target.value, 10) || 1,
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sortOrder">Sort Order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  min={0}
                  value={formData.sortOrder}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      sortOrder: parseInt(e.target.value, 10) || 0,
                    })
                  }
                />
              </div>
            </div>

            {editingTable && (
              <div className="flex items-center justify-between">
                <Label htmlFor="isActive">Active</Label>
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked: boolean) =>
                    setFormData({ ...formData, isActive: checked })
                  }
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || !formData.name}>
              {isSubmitting ? "Saving..." : editingTable ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tab Name Dialog */}
      <Dialog open={!!editingTab} onOpenChange={(open) => !open && setEditingTab(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Tab Name</DialogTitle>
            <DialogDescription>Rename this tab for easier identification.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tabName">Tab Name</Label>
              <Input
                id="tabName"
                value={newTabName}
                onChange={(e) => setNewTabName(e.target.value)}
                placeholder={`Tab ${editingTab?.tabNumber ?? 1}`}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleResetTabName} className="mr-auto">
              Reset to Default
            </Button>
            <Button variant="outline" onClick={() => setEditingTab(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTabName}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
