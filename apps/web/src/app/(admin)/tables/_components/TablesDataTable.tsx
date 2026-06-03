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
  ChevronRight,
  Copy,
  Grid3X3,
  GripVertical,
  Layers,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { AdminDataControls } from "../../_shared/AdminDataControls";
import { SortableTableRow } from "../../_shared/SortableTableRow";

interface OrderData {
  _id: Id<"orders">;
  orderNumber?: string;
  tabNumber: number;
  tabName: string;
  itemCount: number;
  netSales: number;
  pax?: number;
  createdAt: number;
}

interface TableData {
  _id: Id<"tables">;
  name: string;
  capacity?: number;
  status: "available" | "occupied";
  sortOrder: number;
  orders: OrderData[];
  totalTabs: number;
  totalItemCount: number;
  totalNetSales: number;
}

interface TablesDataTableProps {
  tablesWithOrders: TableData[] | undefined;
  filteredTables: TableData[] | undefined;
  selectedStoreId: Id<"stores"> | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: "all" | "available" | "occupied";
  onStatusFilterChange: (value: "all" | "available" | "occupied") => void;
  capacityFilter: "all" | "small" | "medium" | "large";
  onCapacityFilterChange: (value: "all" | "small" | "medium" | "large") => void;
  activityFilter: "all" | "with-tabs" | "empty";
  onActivityFilterChange: (value: "all" | "with-tabs" | "empty") => void;
  sortBy: "floor" | "name" | "capacity" | "tabs" | "sales";
  onSortByChange: (value: "floor" | "name" | "capacity" | "tabs" | "sales") => void;
  onResetFilters: () => void;
  onReorder: (tableIds: Id<"tables">[]) => Promise<void>;
  onEdit: (table: TableData) => void;
  onDuplicate: (table: TableData) => void;
  onEditTab: (tab: { orderId: Id<"orders">; tabName: string; tabNumber: number }) => void;
}

function getStatusBadge(status: string) {
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
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function TablesDataTable({
  tablesWithOrders,
  filteredTables,
  selectedStoreId,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  capacityFilter,
  onCapacityFilterChange,
  activityFilter,
  onActivityFilterChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  onReorder,
  onEdit,
  onDuplicate,
  onEditTab,
}: TablesDataTableProps) {
  const [expandedTableIds, setExpandedTableIds] = useState<Set<Id<"tables">>>(new Set());
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [orderedTables, setOrderedTables] = useState<TableData[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setOrderedTables(filteredTables ?? []);
  }, [filteredTables]);

  const canReorder =
    selectedStoreId &&
    statusFilter === "all" &&
    capacityFilter === "all" &&
    activityFilter === "all" &&
    sortBy === "floor" &&
    !searchQuery &&
    (filteredTables?.length ?? 0) > 1;

  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      statusFilter !== "all",
      capacityFilter !== "all",
      activityFilter !== "all",
      sortBy !== "floor",
    ].filter(Boolean).length;
  }, [searchQuery, statusFilter, capacityFilter, activityFilter, sortBy]);

  const handleReorder = async (nextTables: TableData[]) => {
    setOrderedTables(nextTables);
    setIsSavingOrder(true);
    try {
      await onReorder(nextTables.map((table) => table._id));
      toast.success("Table order updated");
    } catch (error) {
      setOrderedTables(filteredTables ?? []);
      toast.error(error instanceof Error ? error.message : "Failed to update table order");
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedTables.findIndex((table) => table._id === active.id);
    const newIndex = orderedTables.findIndex((table) => table._id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    void handleReorder(arrayMove(orderedTables, oldIndex, newIndex));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= orderedTables.length) return;
    void handleReorder(arrayMove(orderedTables, index, newIndex));
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

  return (
    <>
      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search tables..."
        onSearchChange={onSearchChange}
        activeFilterCount={activeFilterCount}
        onReset={onResetFilters}
        resultLabel={`${filteredTables?.length ?? 0} of ${tablesWithOrders?.length ?? 0} tables`}
      >
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as "all" | "available" | "occupied")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="occupied">Occupied</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={capacityFilter}
          onValueChange={(value) =>
            onCapacityFilterChange(value as "all" | "small" | "medium" | "large")
          }
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Seats</SelectItem>
            <SelectItem value="small">1-2 Seats</SelectItem>
            <SelectItem value="medium">3-4 Seats</SelectItem>
            <SelectItem value="large">5+ Seats</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={activityFilter}
          onValueChange={(value) => onActivityFilterChange(value as "all" | "with-tabs" | "empty")}
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Activity</SelectItem>
            <SelectItem value="with-tabs">With Tabs</SelectItem>
            <SelectItem value="empty">No Tabs</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) =>
            onSortByChange(value as "floor" | "name" | "capacity" | "tabs" | "sales")
          }
        >
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="floor">Floor Order</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="capacity">Capacity</SelectItem>
            <SelectItem value="tabs">Tabs</SelectItem>
            <SelectItem value="sales">Sales</SelectItem>
          </SelectContent>
        </Select>
      </AdminDataControls>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Floor Tables</CardTitle>
              <CardDescription>
                {isReorderMode
                  ? "Drag tables or use move buttons to update floor order."
                  : "Inspect active tabs, occupancy, sales, and capacity."}
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
              <Grid3X3 className="h-8 w-8 mb-2" />
              <p>Please select a store to view tables.</p>
            </div>
          ) : !tablesWithOrders ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredTables?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Grid3X3 className="h-8 w-8 mb-2" />
              <p>
                {activeFilterCount > 0
                  ? "No tables match your filters."
                  : "No tables found. Create your first table."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {!canReorder && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Reorder is available in Floor Order view with search and filters cleared.
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTables.map((table) => table._id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isReorderMode && <TableHead className="w-[112px]">Move</TableHead>}
                        <TableHead className="w-8" />
                        <TableHead>Name</TableHead>
                        <TableHead>Capacity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tabs</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Sales</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedTables.map((table, index) => (
                        <Fragment key={table._id}>
                          {/* Main table row */}
                          <SortableTableRow
                            id={table._id}
                            className={cn(
                              table.totalTabs > 0 && "cursor-pointer hover:bg-gray-50",
                              expandedTableIds.has(table._id) && "bg-gray-50",
                            )}
                          >
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
                                        aria-label={`Drag ${table.name}`}
                                        onClick={(event) => event.stopPropagation()}
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
                                        aria-label={`Move ${table.name} up`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleMove(index, -1);
                                        }}
                                      >
                                        <ArrowUp className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9"
                                        disabled={
                                          index === orderedTables.length - 1 || isSavingOrder
                                        }
                                        aria-label={`Move ${table.name} down`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleMove(index, 1);
                                        }}
                                      >
                                        <ArrowDown className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                )}
                                <TableCell
                                  className="w-8"
                                  onClick={() => table.totalTabs > 0 && toggleExpand(table._id)}
                                >
                                  {table.totalTabs > 0 && (
                                    <ChevronRight
                                      className={cn(
                                        "h-4 w-4 text-gray-400 transition-transform",
                                        expandedTableIds.has(table._id) && "rotate-90",
                                      )}
                                    />
                                  )}
                                </TableCell>
                                <TableCell
                                  className="font-medium"
                                  onClick={() => table.totalTabs > 0 && toggleExpand(table._id)}
                                >
                                  <div className="flex items-center gap-2">
                                    <Grid3X3 className="h-4 w-4 text-primary" />
                                    {table.name}
                                  </div>
                                </TableCell>
                                <TableCell>{table.capacity ?? 4} seats</TableCell>
                                <TableCell>{getStatusBadge(table.status)}</TableCell>
                                <TableCell>
                                  {table.totalTabs > 0 ? (
                                    <div className="flex items-center gap-1">
                                      <Layers className="h-3 w-3 text-gray-400" />
                                      {table.totalTabs}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400">&mdash;</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {table.totalItemCount > 0 ? (
                                    table.totalItemCount
                                  ) : (
                                    <span className="text-gray-400">&mdash;</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {table.totalNetSales > 0 ? (
                                    formatCurrency(table.totalNetSales)
                                  ) : (
                                    <span className="text-gray-400">&mdash;</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label={`Actions for ${table.name}`}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onEdit(table);
                                        }}
                                      >
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDuplicate(table);
                                        }}
                                      >
                                        <Copy className="mr-2 h-4 w-4" />
                                        Duplicate
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </>
                            )}
                          </SortableTableRow>

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
                                        onEditTab({
                                          orderId: order._id,
                                          tabName: order.tabName,
                                          tabNumber: order.tabNumber,
                                        });
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
                </SortableContext>
              </DndContext>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
