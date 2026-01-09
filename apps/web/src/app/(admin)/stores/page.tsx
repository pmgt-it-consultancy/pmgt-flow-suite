"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useSessionToken } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Store, Building, Trash2 } from "lucide-react";

interface StoreFormData {
  name: string;
  parentId: Id<"stores"> | undefined;
  address1: string;
  address2: string;
  tin: string;
  min: string;
  vatRate: number;
  isActive: boolean;
}

const initialFormData: StoreFormData = {
  name: "",
  parentId: undefined,
  address1: "",
  address2: "",
  tin: "",
  min: "",
  vatRate: 12,
  isActive: true,
};

export default function StoresPage() {
  const token = useSessionToken();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Id<"stores"> | null>(null);
  const [formData, setFormData] = useState<StoreFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Queries
  const stores = useQuery(api.stores.list, token ? { token } : "skip");

  // Mutations
  const createStore = useMutation(api.stores.create);
  const updateStore = useMutation(api.stores.update);

  // Get parent stores (for branch creation)
  const parentStores = stores?.filter((s) => !s.parentId) ?? [];

  const handleOpenCreate = () => {
    setEditingStore(null);
    setFormData(initialFormData);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (store: NonNullable<typeof stores>[number]) => {
    setEditingStore(store._id);
    setFormData({
      name: store.name,
      parentId: store.parentId,
      address1: store.address1,
      address2: store.address2 ?? "",
      tin: store.tin,
      min: store.min,
      vatRate: store.vatRate,
      isActive: store.isActive,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!token) return;

    setIsSubmitting(true);
    try {
      if (editingStore) {
        await updateStore({
          token,
          storeId: editingStore,
          name: formData.name,
          address1: formData.address1,
          address2: formData.address2 || undefined,
          tin: formData.tin,
          min: formData.min,
          vatRate: formData.vatRate,
          isActive: formData.isActive,
        });
        toast.success("Store updated successfully");
      } else {
        await createStore({
          token,
          name: formData.name,
          parentId: formData.parentId,
          address1: formData.address1,
          address2: formData.address2 || undefined,
          tin: formData.tin,
          min: formData.min,
          vatRate: formData.vatRate,
        });
        toast.success("Store created successfully");
      }
      setIsDialogOpen(false);
      setFormData(initialFormData);
      setEditingStore(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save store"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stores</h1>
          <p className="text-gray-500">
            Manage your stores and branches
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Store
        </Button>
      </div>

      {/* Stores Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Stores</CardTitle>
          <CardDescription>
            {stores?.length ?? 0} store(s) in total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!stores ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : stores.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Store className="h-8 w-8 mb-2" />
              <p>No stores found. Create your first store.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>TIN</TableHead>
                  <TableHead>VAT Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((store) => (
                  <TableRow key={store._id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {store.parentId ? (
                          <Building className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Store className="h-4 w-4 text-primary" />
                        )}
                        {store.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={store.parentId ? "secondary" : "default"}>
                        {store.parentId ? "Branch" : "Parent"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {store.address1}
                    </TableCell>
                    <TableCell>{store.tin}</TableCell>
                    <TableCell>{store.vatRate}%</TableCell>
                    <TableCell>
                      <Badge
                        variant={store.isActive ? "default" : "destructive"}
                      >
                        {store.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(store)}
                      >
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingStore ? "Edit Store" : "Create Store"}
            </DialogTitle>
            <DialogDescription>
              {editingStore
                ? "Update the store details below."
                : "Fill in the details to create a new store."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Store Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Enter store name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="parent">Parent Store (Optional)</Label>
              <Select
                value={formData.parentId ?? "none"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    parentId: value === "none" ? undefined : (value as Id<"stores">),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select parent store" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Parent (Main Store)</SelectItem>
                  {parentStores
                    .filter((s) => s._id !== editingStore)
                    .map((store) => (
                      <SelectItem key={store._id} value={store._id}>
                        {store.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Select a parent store to create this as a branch.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address1">Address Line 1</Label>
              <Input
                id="address1"
                value={formData.address1}
                onChange={(e) =>
                  setFormData({ ...formData, address1: e.target.value })
                }
                placeholder="Street address"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address2">Address Line 2 (Optional)</Label>
              <Input
                id="address2"
                value={formData.address2}
                onChange={(e) =>
                  setFormData({ ...formData, address2: e.target.value })
                }
                placeholder="Building, floor, etc."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tin">TIN (Tax ID)</Label>
                <Input
                  id="tin"
                  value={formData.tin}
                  onChange={(e) =>
                    setFormData({ ...formData, tin: e.target.value })
                  }
                  placeholder="000-000-000-000"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="min">MIN (Machine ID)</Label>
                <Input
                  id="min"
                  value={formData.min}
                  onChange={(e) =>
                    setFormData({ ...formData, min: e.target.value })
                  }
                  placeholder="Machine ID Number"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="vatRate">VAT Rate (%)</Label>
                <Input
                  id="vatRate"
                  type="number"
                  value={formData.vatRate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      vatRate: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              {editingStore && (
                <div className="grid gap-2">
                  <Label htmlFor="isActive">Status</Label>
                  <Select
                    value={formData.isActive ? "active" : "inactive"}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        isActive: value === "active",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !formData.name || !formData.address1 || !formData.tin || !formData.min}
            >
              {isSubmitting ? "Saving..." : editingStore ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
