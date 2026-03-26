"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { ChevronRight, Copy, Grid3X3, Layers, MoreHorizontal, Pencil } from "lucide-react";
import { Fragment, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  selectedStoreId: Id<"stores"> | null;
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
  selectedStoreId,
  onEdit,
  onDuplicate,
  onEditTab,
}: TablesDataTableProps) {
  const [expandedTableIds, setExpandedTableIds] = useState<Set<Id<"tables">>>(new Set());

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
                    <TableCell>{table.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
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
        )}
      </CardContent>
    </Card>
  );
}
