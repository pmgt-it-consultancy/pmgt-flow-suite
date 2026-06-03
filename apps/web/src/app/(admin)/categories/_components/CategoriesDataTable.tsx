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
  Folder,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Tag,
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
import { AdminDataControls } from "../../_shared/AdminDataControls";
import { SortableTableRow } from "../../_shared/SortableTableRow";

interface CategoryData {
  _id: Id<"categories">;
  name: string;
  parentId?: Id<"categories">;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  subcategoryCount: number;
}

interface CategoriesDataTableProps {
  categories: CategoryData[] | undefined;
  filteredCategories: CategoryData[] | undefined;
  selectedStoreId: Id<"stores"> | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: "active" | "inactive" | "all";
  onStatusFilterChange: (value: "active" | "inactive" | "all") => void;
  typeFilter: "all" | "main" | "sub";
  onTypeFilterChange: (value: "all" | "main" | "sub") => void;
  contentFilter: "all" | "with-products" | "empty";
  onContentFilterChange: (value: "all" | "with-products" | "empty") => void;
  sortBy: "menu" | "name" | "products";
  onSortByChange: (value: "menu" | "name" | "products") => void;
  onResetFilters: () => void;
  onReorder: (categoryIds: Id<"categories">[]) => Promise<void>;
  onEdit: (category: CategoryData) => void;
  onDuplicate: (category: CategoryData) => void;
}

export function CategoriesDataTable({
  categories,
  filteredCategories,
  selectedStoreId,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  contentFilter,
  onContentFilterChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  onReorder,
  onEdit,
  onDuplicate,
}: CategoriesDataTableProps) {
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [orderedCategories, setOrderedCategories] = useState<CategoryData[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setOrderedCategories(filteredCategories ?? []);
  }, [filteredCategories]);

  const canReorder =
    selectedStoreId &&
    statusFilter === "active" &&
    typeFilter === "all" &&
    contentFilter === "all" &&
    sortBy === "menu" &&
    !searchQuery &&
    (filteredCategories?.length ?? 0) > 1;

  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      statusFilter !== "active",
      typeFilter !== "all",
      contentFilter !== "all",
      sortBy !== "menu",
    ].filter(Boolean).length;
  }, [searchQuery, statusFilter, typeFilter, contentFilter, sortBy]);

  const parentNameById = useMemo(() => {
    return new Map(categories?.map((category) => [category._id, category.name]));
  }, [categories]);

  const handleReorder = async (nextCategories: CategoryData[]) => {
    setOrderedCategories(nextCategories);
    setIsSavingOrder(true);
    try {
      await onReorder(nextCategories.map((category) => category._id));
      toast.success("Category order updated");
    } catch (error) {
      setOrderedCategories(filteredCategories ?? []);
      toast.error(error instanceof Error ? error.message : "Failed to update category order");
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedCategories.findIndex((category) => category._id === active.id);
    const newIndex = orderedCategories.findIndex((category) => category._id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    void handleReorder(arrayMove(orderedCategories, oldIndex, newIndex));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= orderedCategories.length) return;
    void handleReorder(arrayMove(orderedCategories, index, newIndex));
  };

  return (
    <>
      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search categories..."
        onSearchChange={onSearchChange}
        activeFilterCount={activeFilterCount}
        onReset={onResetFilters}
        resultLabel={`${filteredCategories?.length ?? 0} of ${categories?.length ?? 0} categories`}
      >
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as "active" | "inactive" | "all")}
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
          value={typeFilter}
          onValueChange={(value) => onTypeFilterChange(value as "all" | "main" | "sub")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="main">Main</SelectItem>
            <SelectItem value="sub">Sub-category</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={contentFilter}
          onValueChange={(value) =>
            onContentFilterChange(value as "all" | "with-products" | "empty")
          }
        >
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Content</SelectItem>
            <SelectItem value="with-products">With Products</SelectItem>
            <SelectItem value="empty">Empty</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) => onSortByChange(value as "menu" | "name" | "products")}
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="menu">Menu Order</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="products">Product Count</SelectItem>
          </SelectContent>
        </Select>
      </AdminDataControls>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Category Structure</CardTitle>
              <CardDescription>
                {isReorderMode
                  ? "Drag categories or use move buttons to update menu order."
                  : "Review hierarchy, product coverage, and availability."}
              </CardDescription>
            </div>
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
          ) : filteredCategories?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Tag className="h-8 w-8 mb-2" />
              <p>
                {activeFilterCount > 0
                  ? "No categories match your filters."
                  : "No categories found. Create your first category."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {!canReorder && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Reorder is available in active Menu Order view with search and filters cleared.
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedCategories.map((category) => category._id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isReorderMode && <TableHead className="w-[112px]">Move</TableHead>}
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Parent</TableHead>
                        <TableHead>Products</TableHead>
                        <TableHead>Subcategories</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedCategories.map((category, index) => (
                        <SortableTableRow key={category._id} id={category._id}>
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
                                      aria-label={`Drag ${category.name}`}
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
                                      aria-label={`Move ${category.name} up`}
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
                                        index === orderedCategories.length - 1 || isSavingOrder
                                      }
                                      aria-label={`Move ${category.name} down`}
                                      onClick={() => handleMove(index, 1)}
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
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
                                  ? (parentNameById.get(category.parentId) ?? "-")
                                  : "-"}
                              </TableCell>
                              <TableCell>{category.productCount}</TableCell>
                              <TableCell>{category.subcategoryCount}</TableCell>
                              <TableCell>
                                <Badge variant={category.isActive ? "default" : "destructive"}>
                                  {category.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Actions for ${category.name}`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => onEdit(category)}>
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onDuplicate(category)}>
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
