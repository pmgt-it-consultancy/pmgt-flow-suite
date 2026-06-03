"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Copy, Key, Lock, MoreHorizontal, Pencil, Users } from "lucide-react";
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

export interface UserData {
  _id: Id<"users">;
  name?: string;
  email?: string;
  roleId?: Id<"roles">;
  roleName: string;
  storeId?: Id<"stores">;
  storeName?: string;
  isActive: boolean;
  hasPin: boolean;
  pendingPinSetup: boolean;
}

interface UsersDataTableProps {
  users: UserData[] | undefined;
  filteredUsers: UserData[] | undefined;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: "active" | "inactive" | "all";
  onStatusFilterChange: (value: "active" | "inactive" | "all") => void;
  pinFilter: "all" | "has-pin" | "needs-pin";
  onPinFilterChange: (value: "all" | "has-pin" | "needs-pin") => void;
  storeFilter: "all" | "assigned" | "all-stores";
  onStoreFilterChange: (value: "all" | "assigned" | "all-stores") => void;
  roleFilter: string;
  roleOptions: string[];
  onRoleFilterChange: (value: string) => void;
  sortBy: "name" | "email" | "role" | "store";
  onSortByChange: (value: "name" | "email" | "role" | "store") => void;
  onResetFilters: () => void;
  onEdit: (user: UserData) => void;
  onDuplicate: (user: UserData) => void;
  onResetPassword: (userId: Id<"users">) => void;
  onManagePin: (user: UserData) => void;
}

export function UsersDataTable({
  users,
  filteredUsers,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  pinFilter,
  onPinFilterChange,
  storeFilter,
  onStoreFilterChange,
  roleFilter,
  roleOptions,
  onRoleFilterChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  onEdit,
  onDuplicate,
  onResetPassword,
  onManagePin,
}: UsersDataTableProps) {
  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      statusFilter !== "active",
      pinFilter !== "all",
      storeFilter !== "all",
      roleFilter !== "all",
      sortBy !== "name",
    ].filter(Boolean).length;
  }, [searchQuery, statusFilter, pinFilter, storeFilter, roleFilter, sortBy]);

  return (
    <>
      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search staff, email, role, or store..."
        onSearchChange={onSearchChange}
        activeFilterCount={activeFilterCount}
        onReset={onResetFilters}
        resultLabel={`${filteredUsers?.length ?? 0} of ${users?.length ?? 0} users`}
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
        <Select value={roleFilter} onValueChange={onRoleFilterChange}>
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {roleOptions.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={storeFilter}
          onValueChange={(value) => onStoreFilterChange(value as "all" | "assigned" | "all-stores")}
        >
          <SelectTrigger className="h-11 w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Store Access</SelectItem>
            <SelectItem value="assigned">Assigned Store</SelectItem>
            <SelectItem value="all-stores">All Stores</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={pinFilter}
          onValueChange={(value) => onPinFilterChange(value as "all" | "has-pin" | "needs-pin")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All PINs</SelectItem>
            <SelectItem value="has-pin">Has PIN</SelectItem>
            <SelectItem value="needs-pin">PIN Required</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) => onSortByChange(value as "name" | "email" | "role" | "store")}
        >
          <SelectTrigger className="h-11 w-full md:w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="role">Role</SelectItem>
            <SelectItem value="store">Store</SelectItem>
          </SelectContent>
        </Select>
      </AdminDataControls>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>{filteredUsers?.length ?? 0} user(s) found</CardDescription>
        </CardHeader>
        <CardContent>
          {!users ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredUsers?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Users className="h-8 w-8 mb-2" />
              <p>
                {searchQuery
                  ? "No users match your search or filters."
                  : "No users found. Create your first user."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers?.map((userItem) => (
                  <TableRow key={userItem._id}>
                    <TableCell className="font-medium">{userItem.name ?? "\u2014"}</TableCell>
                    <TableCell>{userItem.email ?? "\u2014"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          userItem.roleName === "Super Admin" || userItem.roleName === "Admin"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {userItem.roleName}
                      </Badge>
                    </TableCell>
                    <TableCell>{userItem.storeName ?? "All Stores"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={userItem.isActive ? "default" : "destructive"}>
                          {userItem.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {userItem.pendingPinSetup && (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-amber-800"
                          >
                            PIN required
                          </Badge>
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
                          <DropdownMenuItem onClick={() => onEdit(userItem)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDuplicate(userItem)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onResetPassword(userItem._id)}>
                            <Key className="mr-2 h-4 w-4" />
                            Reset Password
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onManagePin(userItem)}>
                            <Lock className="mr-2 h-4 w-4" />
                            Manage PIN
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
    </>
  );
}
