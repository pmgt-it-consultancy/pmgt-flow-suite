"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Grid3X3, Pencil, Plus } from "lucide-react";
import { useState } from "react";
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

  // Queries
  const tables = useQuery(
    api.tables.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  // Mutations
  const createTable = useMutation(api.tables.create);
  const updateTable = useMutation(api.tables.update);

  const handleOpenCreate = () => {
    setEditingTable(null);
    // Calculate next sort order
    const maxSortOrder = tables?.reduce((max, t) => Math.max(max, t.sortOrder), -1) ?? -1;
    setFormData({
      ...initialFormData,
      sortOrder: maxSortOrder + 1,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (table: NonNullable<typeof tables>[number]) => {
    setEditingTable(table._id);
    setFormData({
      name: table.name,
      capacity: table.capacity ?? 4,
      sortOrder: table.sortOrder ?? 0,
      isActive: table.isActive,
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
          <CardDescription>{tables?.length ?? 0} table(s) in total</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Grid3X3 className="h-8 w-8 mb-2" />
              <p>Please select a store to view tables.</p>
            </div>
          ) : !tables ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Grid3X3 className="h-8 w-8 mb-2" />
              <p>No tables found. Create your first table.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sort Order</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tables.map((table) => (
                  <TableRow key={table._id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Grid3X3 className="h-4 w-4 text-primary" />
                        {table.name}
                      </div>
                    </TableCell>
                    <TableCell>{table.capacity} seats</TableCell>
                    <TableCell>{getStatusBadge(table.status)}</TableCell>
                    <TableCell>{table.sortOrder}</TableCell>
                    <TableCell>
                      <Badge variant={table.isActive ? "default" : "destructive"}>
                        {table.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(table)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
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
    </div>
  );
}
