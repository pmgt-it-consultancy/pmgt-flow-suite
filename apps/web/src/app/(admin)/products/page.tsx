"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Package, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
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
import { formatCurrency } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";

interface ProductFormData {
  storeId: Id<"stores"> | undefined;
  categoryId: Id<"categories"> | undefined;
  name: string;
  price: number;
  isVatable: boolean;
  sortOrder: number;
  isActive: boolean;
  isOpenPrice: boolean;
  minPrice: number;
  maxPrice: number;
}

const initialFormData: ProductFormData = {
  storeId: undefined,
  categoryId: undefined,
  name: "",
  price: 0,
  isVatable: true,
  sortOrder: 0,
  isActive: true,
  isOpenPrice: false,
  minPrice: 0,
  maxPrice: 0,
};

export default function ProductsPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Id<"products"> | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModifierGroupId, setSelectedModifierGroupId] = useState<Id<"modifierGroups"> | "">(
    "",
  );

  // Queries
  const store = useQuery(
    api.stores.get,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const categories = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const products = useQuery(
    api.products.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const modifierGroups = useQuery(
    api.modifierGroups.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const productAssignments = useQuery(
    api.modifierAssignments.listForProduct,
    editingProduct ? { productId: editingProduct } : "skip",
  );

  // Mutations
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);
  const assignModifier = useMutation(api.modifierAssignments.assign);
  const unassignModifier = useMutation(api.modifierAssignments.unassign);

  // Filter products by search query
  const filteredProducts = products?.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleOpenCreate = () => {
    setEditingProduct(null);
    // Default isVatable based on store's VAT rate (non-vatable if store has 0% VAT)
    const defaultIsVatable = store ? store.vatRate > 0 : true;
    setFormData({
      ...initialFormData,
      storeId: selectedStoreId ?? undefined,
      isVatable: defaultIsVatable,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (product: NonNullable<typeof products>[number]) => {
    setEditingProduct(product._id);
    setFormData({
      storeId: product.storeId,
      categoryId: product.categoryId,
      name: product.name,
      price: product.price,
      isVatable: product.isVatable,
      sortOrder: product.sortOrder,
      isActive: product.isActive,
      isOpenPrice: product.isOpenPrice ?? false,
      minPrice: product.minPrice ?? 0,
      maxPrice: product.maxPrice ?? 0,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated || !formData.storeId || !formData.categoryId) return;

    setIsSubmitting(true);
    try {
      if (editingProduct) {
        await updateProduct({
          productId: editingProduct,
          categoryId: formData.categoryId,
          name: formData.name,
          price: formData.price,
          isVatable: formData.isVatable,
          sortOrder: formData.sortOrder,
          isActive: formData.isActive,
          isOpenPrice: formData.isOpenPrice,
          minPrice: formData.isOpenPrice ? formData.minPrice : undefined,
          maxPrice: formData.isOpenPrice ? formData.maxPrice : undefined,
        });
        toast.success("Product updated successfully");
      } else {
        await createProduct({
          storeId: formData.storeId,
          categoryId: formData.categoryId,
          name: formData.name,
          price: formData.price,
          isVatable: formData.isVatable,
          sortOrder: formData.sortOrder,
          isOpenPrice: formData.isOpenPrice,
          minPrice: formData.isOpenPrice ? formData.minPrice : undefined,
          maxPrice: formData.isOpenPrice ? formData.maxPrice : undefined,
        });
        toast.success("Product created successfully");
      }
      setIsDialogOpen(false);
      setFormData(initialFormData);
      setEditingProduct(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save product");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-gray-500">Manage your product catalog</p>
        </div>
        <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Product
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search products by name or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Products</CardTitle>
          <CardDescription>{filteredProducts?.length ?? 0} product(s) found</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Package className="h-8 w-8 mb-2" />
              <p>Please select a store to view products.</p>
            </div>
          ) : !products ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredProducts?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Package className="h-8 w-8 mb-2" />
              <p>
                {searchQuery
                  ? "No products match your search."
                  : "No products found. Create your first product."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>VAT</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts?.map((product) => (
                  <TableRow key={product._id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.categoryName}</TableCell>
                    <TableCell className="text-right">
                      {product.isOpenPrice ? (
                        <span className="text-sm text-emerald-600 font-medium">
                          Open Price ({formatCurrency(product.minPrice ?? 0)} –{" "}
                          {formatCurrency(product.maxPrice ?? 0)})
                        </span>
                      ) : (
                        formatCurrency(product.price)
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={product.isVatable ? "default" : "secondary"}>
                        {product.isVatable ? "VAT" : "Non-VAT"}
                      </Badge>
                    </TableCell>
                    <TableCell>{product.sortOrder}</TableCell>
                    <TableCell>
                      <Badge variant={product.isActive ? "default" : "destructive"}>
                        {product.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(product)}>
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
            <DialogTitle>{editingProduct ? "Edit Product" : "Create Product"}</DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Update the product details below."
                : "Fill in the details to create a new product."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={formData.categoryId ?? ""}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    categoryId: value as Id<"categories">,
                  })
                }
                disabled={!categories || categories.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((category) => (
                    <SelectItem key={category._id} value={category._id}>
                      {category.parentId ? "└ " : ""}
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(!categories || categories.length === 0) && (
                <p className="text-xs text-red-500">Please create a category first.</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">Product Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter product name"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isOpenPrice"
                  checked={formData.isOpenPrice}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      isOpenPrice: e.target.checked,
                      price: e.target.checked ? 0 : formData.price,
                    })
                  }
                />
                <Label htmlFor="isOpenPrice">Open Price (cashier enters price)</Label>
              </div>
            </div>

            {!formData.isOpenPrice && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="price">Price (VAT-inclusive)</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        price: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
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
                </div>
              </div>
            )}

            {formData.isOpenPrice && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="minPrice">Minimum Price</Label>
                  <Input
                    id="minPrice"
                    type="number"
                    step="0.01"
                    value={formData.minPrice}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        minPrice: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxPrice">Maximum Price</Label>
                  <Input
                    id="maxPrice"
                    type="number"
                    step="0.01"
                    value={formData.maxPrice}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        maxPrice: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
            )}

            {formData.isOpenPrice && (
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
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="isVatable">VAT Status</Label>
                <Select
                  value={formData.isVatable ? "vat" : "non-vat"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      isVatable: value === "vat",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vat">VAT-able (12%)</SelectItem>
                    <SelectItem value="non-vat">Non-VAT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editingProduct && (
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

            {/* Modifier Assignments (edit mode only) */}
            {editingProduct && (
              <div className="grid gap-2">
                <Label className="flex items-center gap-1">
                  <SlidersHorizontal className="h-4 w-4" />
                  Modifier Groups
                </Label>
                {productAssignments && productAssignments.length > 0 ? (
                  <div className="space-y-1">
                    {productAssignments.map((a) => (
                      <div
                        key={a._id}
                        className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm"
                      >
                        <span>{a.groupName}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={async () => {
                            try {
                              await unassignModifier({ assignmentId: a._id });
                              toast.success("Modifier removed");
                            } catch {
                              toast.error("Failed to remove modifier");
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No modifiers assigned.</p>
                )}
                <div className="flex gap-2">
                  <Select
                    value={selectedModifierGroupId as string}
                    onValueChange={(v) => setSelectedModifierGroupId(v as Id<"modifierGroups">)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Add modifier group..." />
                    </SelectTrigger>
                    <SelectContent>
                      {modifierGroups
                        ?.filter(
                          (g) => !productAssignments?.some((a) => a.modifierGroupId === g._id),
                        )
                        .map((g) => (
                          <SelectItem key={g._id} value={g._id}>
                            {g.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedModifierGroupId}
                    onClick={async () => {
                      if (!selectedModifierGroupId || !selectedStoreId || !editingProduct) return;
                      try {
                        await assignModifier({
                          storeId: selectedStoreId,
                          modifierGroupId: selectedModifierGroupId as Id<"modifierGroups">,
                          productId: editingProduct,
                        });
                        setSelectedModifierGroupId("");
                        toast.success("Modifier assigned");
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Failed to assign modifier",
                        );
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            )}

            {!formData.isOpenPrice && formData.price > 0 && (
              <div className="bg-gray-50 p-3 rounded-md text-sm">
                <p className="text-gray-600">
                  <strong>Net Price (before VAT):</strong>{" "}
                  {formatCurrency(formData.isVatable ? formData.price / 1.12 : formData.price)}
                </p>
                {formData.isVatable && (
                  <p className="text-gray-600">
                    <strong>VAT (12%):</strong>{" "}
                    {formatCurrency(formData.price - formData.price / 1.12)}
                  </p>
                )}
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
              disabled={
                isSubmitting ||
                !formData.name ||
                !formData.storeId ||
                !formData.categoryId ||
                (!formData.isOpenPrice && formData.price <= 0)
              }
            >
              {isSubmitting ? "Saving..." : editingProduct ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
