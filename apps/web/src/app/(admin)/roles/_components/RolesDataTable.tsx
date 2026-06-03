"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Copy, MoreHorizontal, Pencil, Shield } from "lucide-react";
import { useMemo } from "react";
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

type ScopeLevel = "system" | "parent" | "branch";

interface RoleData {
  _id: Id<"roles">;
  name: string;
  scopeLevel: ScopeLevel;
  isSystem: boolean;
  permissions: string[];
}

interface RolesDataTableProps {
  roles: RoleData[];
  totalRoles: number;
  loading: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  scopeFilter: "all" | ScopeLevel;
  onScopeFilterChange: (value: "all" | ScopeLevel) => void;
  typeFilter: "all" | "seeded" | "custom";
  onTypeFilterChange: (value: "all" | "seeded" | "custom") => void;
  permissionFilter: "all" | "broad" | "limited";
  onPermissionFilterChange: (value: "all" | "broad" | "limited") => void;
  sortBy: "name" | "scope" | "permissions";
  onSortByChange: (value: "name" | "scope" | "permissions") => void;
  onResetFilters: () => void;
  onEdit: (role: RoleData) => void;
  onDuplicate: (role: RoleData) => void;
}

const scopeLabels: Record<ScopeLevel, string> = {
  system: "System",
  parent: "Parent",
  branch: "Branch",
};

export function RolesDataTable({
  roles,
  totalRoles,
  loading,
  searchQuery,
  onSearchChange,
  scopeFilter,
  onScopeFilterChange,
  typeFilter,
  onTypeFilterChange,
  permissionFilter,
  onPermissionFilterChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  onEdit,
  onDuplicate,
}: RolesDataTableProps) {
  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      scopeFilter !== "all",
      typeFilter !== "all",
      permissionFilter !== "all",
      sortBy !== "name",
    ].filter(Boolean).length;
  }, [searchQuery, scopeFilter, typeFilter, permissionFilter, sortBy]);

  return (
    <div className="flex flex-col gap-6">
      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search role, scope, or permission..."
        onSearchChange={onSearchChange}
        activeFilterCount={activeFilterCount}
        onReset={onResetFilters}
        resultLabel={`${roles.length} of ${totalRoles} roles`}
      >
        <Select
          value={scopeFilter}
          onValueChange={(value) => onScopeFilterChange(value as "all" | ScopeLevel)}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scopes</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="parent">Parent</SelectItem>
            <SelectItem value="branch">Branch</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(value) => onTypeFilterChange(value as "all" | "seeded" | "custom")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="seeded">Seeded</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={permissionFilter}
          onValueChange={(value) => onPermissionFilterChange(value as "all" | "broad" | "limited")}
        >
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Permission Sets</SelectItem>
            <SelectItem value="broad">Broad Access</SelectItem>
            <SelectItem value="limited">Limited Access</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) => onSortByChange(value as "name" | "scope" | "permissions")}
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="scope">Scope</SelectItem>
            <SelectItem value="permissions">Permissions</SelectItem>
          </SelectContent>
        </Select>
      </AdminDataControls>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Roles</CardTitle>
          <CardDescription>{roles.length} role(s) available</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : roles.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-gray-500">
              <Shield className="mb-2 h-8 w-8" />
              <p>{searchQuery ? "No roles matched your search." : "No roles found."}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role._id}>
                    <TableCell>
                      <div className="font-medium">{role.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{scopeLabels[role.scopeLevel]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={role.isSystem ? "default" : "secondary"}>
                        {role.isSystem ? "Seeded" : "Custom"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{role.permissions.length} permissions</Badge>
                        {role.permissions.slice(0, 3).map((permission) => (
                          <Badge
                            key={permission}
                            variant="secondary"
                            className="font-mono text-[11px]"
                          >
                            {permission}
                          </Badge>
                        ))}
                        {role.permissions.length > 3 && (
                          <Badge variant="secondary">+{role.permissions.length - 3} more</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(role)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDuplicate(role)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
