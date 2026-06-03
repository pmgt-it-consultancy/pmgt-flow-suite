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
  Pencil,
  SlidersHorizontal,
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

interface GroupData {
  _id: Id<"modifierGroups">;
  storeId: Id<"stores">;
  name: string;
  selectionType: "single" | "multi";
  minSelections: number;
  maxSelections?: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  optionCount: number;
}

interface ModifiersDataTableProps {
  groups: GroupData[] | undefined;
  filteredGroups: GroupData[] | undefined;
  selectedStoreId: Id<"stores"> | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: "active" | "inactive" | "all";
  onStatusFilterChange: (value: "active" | "inactive" | "all") => void;
  selectionFilter: "all" | "single" | "multi";
  onSelectionFilterChange: (value: "all" | "single" | "multi") => void;
  optionFilter: "all" | "empty" | "configured";
  onOptionFilterChange: (value: "all" | "empty" | "configured") => void;
  sortBy: "menu" | "name" | "options";
  onSortByChange: (value: "menu" | "name" | "options") => void;
  onResetFilters: () => void;
  onReorder: (modifierGroupIds: Id<"modifierGroups">[]) => Promise<void>;
  onEdit: (group: GroupData) => void;
  onDuplicate: (group: GroupData) => void;
}

export function ModifiersDataTable({
  groups,
  filteredGroups,
  selectedStoreId,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  selectionFilter,
  onSelectionFilterChange,
  optionFilter,
  onOptionFilterChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  onReorder,
  onEdit,
  onDuplicate,
}: ModifiersDataTableProps) {
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [orderedGroups, setOrderedGroups] = useState<GroupData[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setOrderedGroups(filteredGroups ?? []);
  }, [filteredGroups]);

  const canReorder =
    selectedStoreId &&
    statusFilter === "active" &&
    selectionFilter === "all" &&
    optionFilter === "all" &&
    sortBy === "menu" &&
    !searchQuery &&
    (filteredGroups?.length ?? 0) > 1;

  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      statusFilter !== "active",
      selectionFilter !== "all",
      optionFilter !== "all",
      sortBy !== "menu",
    ].filter(Boolean).length;
  }, [searchQuery, statusFilter, selectionFilter, optionFilter, sortBy]);

  const handleReorder = async (nextGroups: GroupData[]) => {
    setOrderedGroups(nextGroups);
    setIsSavingOrder(true);
    try {
      await onReorder(nextGroups.map((group) => group._id));
      toast.success("Modifier group order updated");
    } catch (error) {
      setOrderedGroups(filteredGroups ?? []);
      toast.error(error instanceof Error ? error.message : "Failed to update modifier order");
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedGroups.findIndex((group) => group._id === active.id);
    const newIndex = orderedGroups.findIndex((group) => group._id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    void handleReorder(arrayMove(orderedGroups, oldIndex, newIndex));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= orderedGroups.length) return;
    void handleReorder(arrayMove(orderedGroups, index, newIndex));
  };

  return (
    <>
      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search modifier groups..."
        onSearchChange={onSearchChange}
        activeFilterCount={activeFilterCount}
        onReset={onResetFilters}
        resultLabel={`${filteredGroups?.length ?? 0} of ${groups?.length ?? 0} groups`}
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
          value={selectionFilter}
          onValueChange={(value) => onSelectionFilterChange(value as "all" | "single" | "multi")}
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Selection</SelectItem>
            <SelectItem value="single">Single</SelectItem>
            <SelectItem value="multi">Multi</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={optionFilter}
          onValueChange={(value) => onOptionFilterChange(value as "all" | "empty" | "configured")}
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Options</SelectItem>
            <SelectItem value="configured">Configured</SelectItem>
            <SelectItem value="empty">No Options</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) => onSortByChange(value as "menu" | "name" | "options")}
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="menu">Menu Order</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="options">Option Count</SelectItem>
          </SelectContent>
        </Select>
      </AdminDataControls>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Modifier Groups</CardTitle>
              <CardDescription>
                {isReorderMode
                  ? "Drag groups or use move buttons to update modifier order."
                  : "Filter by selection rules, option coverage, and status."}
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
              <SlidersHorizontal className="h-8 w-8 mb-2" />
              <p>Please select a store to view modifiers.</p>
            </div>
          ) : !groups ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredGroups?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <SlidersHorizontal className="h-8 w-8 mb-2" />
              <p>
                {activeFilterCount > 0
                  ? "No modifier groups match your filters."
                  : "No modifier groups found. Create your first group."}
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
                  items={orderedGroups.map((group) => group._id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isReorderMode && <TableHead className="w-[112px]">Move</TableHead>}
                        <TableHead>Name</TableHead>
                        <TableHead>Selection</TableHead>
                        <TableHead>Min/Max</TableHead>
                        <TableHead>Options</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedGroups.map((group, index) => (
                        <SortableTableRow key={group._id} id={group._id}>
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
                                      aria-label={`Drag ${group.name}`}
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
                                      aria-label={`Move ${group.name} up`}
                                      onClick={() => handleMove(index, -1)}
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9"
                                      disabled={index === orderedGroups.length - 1 || isSavingOrder}
                                      aria-label={`Move ${group.name} down`}
                                      onClick={() => handleMove(index, 1)}
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                              <TableCell className="font-medium">{group.name}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    group.selectionType === "single" ? "secondary" : "default"
                                  }
                                >
                                  {group.selectionType === "single" ? "Single" : "Multi"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {group.minSelections}&ndash;{group.maxSelections ?? "\u221E"}
                              </TableCell>
                              <TableCell>{group.optionCount}</TableCell>
                              <TableCell>
                                <Badge variant={group.isActive ? "default" : "destructive"}>
                                  {group.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Actions for ${group.name}`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => onEdit(group)}>
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onDuplicate(group)}>
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
