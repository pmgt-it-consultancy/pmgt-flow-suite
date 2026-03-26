"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Copy, MoreHorizontal, Pencil, Search, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  loading: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
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
  loading,
  searchQuery,
  onSearchChange,
  onEdit,
  onDuplicate,
}: RolesDataTableProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search roles by name, scope, or permission..."
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

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
