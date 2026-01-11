"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
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
import {
  FileText,
  Search,
  Ban,
  Percent,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

type ActionType = "void_item" | "void_order" | "discount_applied" | "order_completed" | "all";

export default function AuditLogsPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [actionFilter, setActionFilter] = useState<ActionType>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Queries
  const logs = useQuery(
    api.auditLogs.list,
    isAuthenticated && selectedStoreId
      ? {
          storeId: selectedStoreId,
          action: actionFilter === "all" ? undefined : actionFilter,
          limit: 100,
        }
      : "skip"
  );

  // Filter logs by search query
  const filteredLogs = logs?.filter((log) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.userName.toLowerCase().includes(query) ||
      log.details.toLowerCase().includes(query) ||
      log.entityId.toLowerCase().includes(query)
    );
  });

  const getActionIcon = (action: string) => {
    switch (action) {
      case "void_item":
      case "void_order":
        return <Ban className="h-4 w-4 text-red-500" />;
      case "discount_applied":
        return <Percent className="h-4 w-4 text-green-500" />;
      case "order_completed":
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case "void_item":
        return <Badge variant="destructive">Void Item</Badge>;
      case "void_order":
        return <Badge variant="destructive">Void Order</Badge>;
      case "discount_applied":
        return <Badge variant="secondary">Discount</Badge>;
      case "order_completed":
        return <Badge variant="default">Completed</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-gray-500">
            View activity logs for compliance and accountability
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="action" className="whitespace-nowrap">
                Action:
              </Label>
              <Select
                value={actionFilter}
                onValueChange={(value) => setActionFilter(value as ActionType)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="void_item">Void Item</SelectItem>
                  <SelectItem value="void_order">Void Order</SelectItem>
                  <SelectItem value="discount_applied">Discount Applied</SelectItem>
                  <SelectItem value="order_completed">Order Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search by user, details, or reference..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs List */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
          <CardDescription>
            {filteredLogs?.length ?? 0} log entries found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <FileText className="h-8 w-8 mb-2" />
              <p>Please select a store to view audit logs.</p>
            </div>
          ) : !logs ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredLogs?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <FileText className="h-8 w-8 mb-2" />
              <p>No audit logs found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs?.map((log) => (
                  <TableRow key={log._id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">{log.userName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getActionIcon(log.action)}
                        {getActionBadge(log.action)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-gray-500">
                        {log.entityType}: {log.entityId.slice(0, 8)}...
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={log.details}>
                      {log.details}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
