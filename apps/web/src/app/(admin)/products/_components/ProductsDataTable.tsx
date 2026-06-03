"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  MoreHorizontal,
  Package,
  Pencil,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatCurrency } from "@/lib/format";
import { AdminDataControls } from "../../_shared/AdminDataControls";
import { SortableTableRow } from "../../_shared/SortableTableRow";

interface CategoryData {
  _id: Id<"categories">;
  name: string;
  parentId?: Id<"categories">;
}

interface ProductData {
  _id: Id<"products">;
  storeId: Id<"stores">;
  name: string;
  categoryId: Id<"categories">;
  categoryName: string;
  price: number;
  isVatable: boolean;
  isActive: boolean;
  isOpenPrice?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  hasModifiers: boolean;
}

interface ProductsDataTableProps {
  products: ProductData[] | undefined;
  filteredProducts: ProductData[] | undefined;
  categories: CategoryData[] | undefined;
  selectedStoreId: Id<"stores"> | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categoryFilter: Id<"categories"> | "all";
  onCategoryFilterChange: (value: Id<"categories"> | "all") => void;
  statusFilter: "all" | "active" | "inactive";
  onStatusFilterChange: (value: "all" | "active" | "inactive") => void;
  priceFilter: "all" | "fixed" | "open";
  onPriceFilterChange: (value: "all" | "fixed" | "open") => void;
  vatFilter: "all" | "vat" | "non-vat";
  onVatFilterChange: (value: "all" | "vat" | "non-vat") => void;
  modifierFilter: "all" | "with" | "without";
  onModifierFilterChange: (value: "all" | "with" | "without") => void;
  sortBy: "menu" | "name" | "category" | "price" | "updated";
  onSortByChange: (value: "menu" | "name" | "category" | "price" | "updated") => void;
  onResetFilters: () => void;
  onReorder: (productIds: Id<"products">[]) => Promise<void>;
  onEdit: (product: ProductData) => void;
  onDuplicate: (product: ProductData) => void;
}

export function ProductsDataTable({
  products,
  filteredProducts,
  categories,
  selectedStoreId,
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  priceFilter,
  onPriceFilterChange,
  vatFilter,
  onVatFilterChange,
  modifierFilter,
  onModifierFilterChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  onReorder,
  onEdit,
  onDuplicate,
}: ProductsDataTableProps) {
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [orderedProducts, setOrderedProducts] = useState<ProductData[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setOrderedProducts(filteredProducts ?? []);
  }, [filteredProducts]);

  const canReorder =
    selectedStoreId &&
    categoryFilter !== "all" &&
    statusFilter === "active" &&
    priceFilter === "all" &&
    vatFilter === "all" &&
    modifierFilter === "all" &&
    sortBy === "menu" &&
    !searchQuery &&
    (filteredProducts?.length ?? 0) > 1;

  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      categoryFilter !== "all",
      statusFilter !== "active",
      priceFilter !== "all",
      vatFilter !== "all",
      modifierFilter !== "all",
      sortBy !== "menu",
    ].filter(Boolean).length;
  }, [searchQuery, categoryFilter, statusFilter, priceFilter, vatFilter, modifierFilter, sortBy]);

  const handleReorder = async (nextProducts: ProductData[]) => {
    setOrderedProducts(nextProducts);
    setIsSavingOrder(true);
    try {
      await onReorder(nextProducts.map((product) => product._id));
      toast.success("Product order updated");
    } catch (error) {
      setOrderedProducts(filteredProducts ?? []);
      toast.error(error instanceof Error ? error.message : "Failed to update product order");
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedProducts.findIndex((product) => product._id === active.id);
    const newIndex = orderedProducts.findIndex((product) => product._id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    void handleReorder(arrayMove(orderedProducts, oldIndex, newIndex));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= orderedProducts.length) return;
    void handleReorder(arrayMove(orderedProducts, index, newIndex));
  };

  return (
    <>
      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search product or category..."
        onSearchChange={onSearchChange}
        activeFilterCount={activeFilterCount}
        onReset={onResetFilters}
        resultLabel={`${filteredProducts?.length ?? 0} of ${products?.length ?? 0} products`}
      >
        <Select
          value={categoryFilter}
          onValueChange={(value) => onCategoryFilterChange(value as Id<"categories"> | "all")}
        >
          <SelectTrigger className="h-11 w-full md:w-[220px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories?.map((category) => (
              <SelectItem key={category._id} value={category._id}>
                {category.parentId ? "\u2514 " : ""}
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as "all" | "active" | "inactive")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All Statuses</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={priceFilter}
          onValueChange={(value) => onPriceFilterChange(value as "all" | "fixed" | "open")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Prices</SelectItem>
            <SelectItem value="fixed">Fixed Price</SelectItem>
            <SelectItem value="open">Open Price</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={vatFilter}
          onValueChange={(value) => onVatFilterChange(value as "all" | "vat" | "non-vat")}
        >
          <SelectTrigger className="h-11 w-full md:w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All VAT</SelectItem>
            <SelectItem value="vat">VAT</SelectItem>
            <SelectItem value="non-vat">Non-VAT</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={modifierFilter}
          onValueChange={(value) => onModifierFilterChange(value as "all" | "with" | "without")}
        >
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modifiers</SelectItem>
            <SelectItem value="with">With Modifiers</SelectItem>
            <SelectItem value="without">No Modifiers</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) =>
            onSortByChange(value as "menu" | "name" | "category" | "price" | "updated")
          }
        >
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="menu">Menu Order</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="category">Category</SelectItem>
            <SelectItem value="price">Price</SelectItem>
            <SelectItem value="updated">Recently Updated</SelectItem>
          </SelectContent>
        </Select>
      </AdminDataControls>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Product Catalog</CardTitle>
              <CardDescription>
                {isReorderMode
                  ? "Drag products or use move buttons to update menu order."
                  : "Filter, inspect, duplicate, and edit catalog items."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={isReorderMode ? "default" : "outline"}
                size="sm"
                disabled={!canReorder || isSavingOrder}
                onClick={() => setIsReorderMode((value) => !value)}
              >
                <GripVertical className="mr-2 h-4 w-4" />
                {isSavingOrder ? "Saving order..." : isReorderMode ? "Done Reordering" : "Reorder"}
              </Button>
            </div>
          </div>
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
                {searchQuery || categoryFilter !== "all" || statusFilter !== "all"
                  ? "No products match your filters."
                  : "No products found. Create your first product."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {!canReorder && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Reorder is available after selecting one category, using Menu Order, and clearing
                  search/extra filters.
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedProducts.map((product) => product._id)}
                  strategy={verticalListSortingStrategy}
                  disabled={!isReorderMode || !canReorder}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isReorderMode && <TableHead className="w-[112px]">Move</TableHead>}
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>VAT</TableHead>
                        <TableHead>Modifiers</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedProducts.map((product, index) => (
                        <SortableTableRow key={product._id} id={product._id}>
                          {({ attributes, listeners }) => (
                            <>
                              {isReorderMode && (
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 cursor-grab"
                                      aria-label={`Drag ${product.name}`}
                                      {...attributes}
                                      {...listeners}
                                    >
                                      <GripVertical className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9"
                                      disabled={index === 0 || isSavingOrder}
                                      aria-label={`Move ${product.name} up`}
                                      onClick={() => handleMove(index, -1)}
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9"
                                      disabled={
                                        index === orderedProducts.length - 1 || isSavingOrder
                                      }
                                      aria-label={`Move ${product.name} down`}
                                      onClick={() => handleMove(index, 1)}
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                              <TableCell className="font-medium">{product.name}</TableCell>
                              <TableCell>{product.categoryName}</TableCell>
                              <TableCell className="text-right">
                                {product.isOpenPrice ? (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-300 bg-emerald-50 text-emerald-700"
                                  >
                                    Open ({formatCurrency(product.minPrice ?? 0)} &ndash;{" "}
                                    {formatCurrency(product.maxPrice ?? 0)})
                                  </Badge>
                                ) : (
                                  formatCurrency(product.price)
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant={product.isVatable ? "default" : "secondary"}>
                                  {product.isVatable ? "VAT" : "Non-VAT"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={product.hasModifiers ? "outline" : "secondary"}>
                                  {product.hasModifiers ? "Assigned" : "None"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={product.isActive ? "default" : "destructive"}>
                                  {product.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Actions for ${product.name}`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => onEdit(product)}>
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onDuplicate(product)}>
                                      <Copy className="mr-2 h-4 w-4" />
                                      Duplicate
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </>
                          )}
                        </SortableTableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SortableContext>
              </DndContext>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
