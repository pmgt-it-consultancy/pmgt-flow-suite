"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Copy, Key, Lock, MoreHorizontal, Pencil, Search, Users } from "lucide-react";
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
  onEdit,
  onDuplicate,
  onResetPassword,
  onManagePin,
}: UsersDataTableProps) {
  return (
    <>
      {/* Search Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search users by name or email..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

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
                  ? "No users match your search."
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
