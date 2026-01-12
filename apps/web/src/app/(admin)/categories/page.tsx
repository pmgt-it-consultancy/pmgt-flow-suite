"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Folder, Pencil, Plus, Tag } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface CategoryFormData {
  name: string;
  storeId: Id<"stores"> | undefined;
  parentId: Id<"categories"> | undefined;
  sortOrder: number;
  isActive: boolean;
}

const initialFormData: CategoryFormData = {
  name: "",
  storeId: undefined,
  parentId: undefined,
  sortOrder: 0,
  isActive: true,
};

export default function CategoriesPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Id<"categories"> | null>(null);
  const [formData, setFormData] = useState<CategoryFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Queries
  const categories = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  // Mutations
  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);

  // Get parent categories (top-level only)
  const parentCategories = categories?.filter((c) => !c.parentId) ?? [];

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setFormData({
      ...initialFormData,
      storeId: selectedStoreId ?? undefined,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (category: NonNullable<typeof categories>[number]) => {
    setEditingCategory(category._id);
    setFormData({
      name: category.name,
      storeId: category.storeId,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated || !formData.storeId) return;

    setIsSubmitting(true);
    try {
      if (editingCategory) {
        await updateCategory({
          categoryId: editingCategory,
          name: formData.name,
          parentId: formData.parentId,
          sortOrder: formData.sortOrder,
          isActive: formData.isActive,
        });
        toast.success("Category updated successfully");
      } else {
        await createCategory({
          storeId: formData.storeId,
          name: formData.name,
          parentId: formData.parentId,
          sortOrder: formData.sortOrder,
        });
        toast.success("Category created successfully");
      }
      setIsDialogOpen(false);
      setFormData(initialFormData);
      setEditingCategory(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save category");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
          <p className="text-gray-500">Manage product categories</p>
        </div>
        <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Category
        </Button>
      </div>

      {/* Categories Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Categories</CardTitle>
          <CardDescription>{categories?.length ?? 0} category(ies) in total</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Tag className="h-8 w-8 mb-2" />
              <p>Please select a store to view categories.</p>
            </div>
          ) : !categories ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Tag className="h-8 w-8 mb-2" />
              <p>No categories found. Create your first category.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Sort Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category._id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {category.parentId ? (
                          <Tag className="h-4 w-4 text-gray-400" />
                        ) : (
                          <Folder className="h-4 w-4 text-primary" />
                        )}
                        {category.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={category.parentId ? "secondary" : "default"}>
                        {category.parentId ? "Sub-category" : "Main"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {category.parentId
                        ? (categories.find((c) => c._id === category.parentId)?.name ?? "-")
                        : "-"}
                    </TableCell>
                    <TableCell>{category.productCount}</TableCell>
                    <TableCell>{category.sortOrder}</TableCell>
                    <TableCell>
                      <Badge variant={category.isActive ? "default" : "destructive"}>
                        {category.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(category)}>
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
            <DialogTitle>{editingCategory ? "Edit Category" : "Create Category"}</DialogTitle>
            <DialogDescription>
              {editingCategory
                ? "Update the category details below."
                : "Fill in the details to create a new category."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Category Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter category name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="parent">Parent Category (Optional)</Label>
              <Select
                value={formData.parentId ?? "none"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    parentId: value === "none" ? undefined : (value as Id<"categories">),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select parent category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Parent (Main Category)</SelectItem>
                  {parentCategories
                    .filter((c) => c._id !== editingCategory)
                    .map((category) => (
                      <SelectItem key={category._id} value={category._id}>
                        {category.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sortOrder">Sort Order</Label>
              <Input
                id="sortOrder"
                type="number"
                value={formData.sortOrder}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    sortOrder: parseInt(e.target.value, 10) || 0,
                  })
                }
              />
              <p className="text-xs text-gray-500">Lower numbers appear first.</p>
            </div>

            {editingCategory && (
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
              disabled={isSubmitting || !formData.name || !formData.storeId}
            >
              {isSubmitting ? "Saving..." : editingCategory ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
