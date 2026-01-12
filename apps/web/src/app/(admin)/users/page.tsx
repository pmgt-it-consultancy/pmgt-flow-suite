"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Key, Pencil, Plus, Search, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";

interface UserFormData {
  email: string;
  password: string;
  name: string;
  roleId: Id<"roles"> | undefined;
  storeId: Id<"stores"> | undefined;
  isActive: boolean;
}

const initialFormData: UserFormData = {
  email: "",
  password: "",
  name: "",
  roleId: undefined,
  storeId: undefined,
  isActive: true,
};

export default function UsersPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Id<"users"> | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<Id<"users"> | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Queries
  const stores = useQuery(api.stores.list, isAuthenticated ? {} : "skip");
  const roles = useQuery(api.roles.list, isAuthenticated ? {} : "skip");
  const users = useQuery(
    api.helpers.usersHelpers.list,
    isAuthenticated ? { storeId: selectedStoreId ?? undefined } : "skip",
  );

  // Mutations & Actions
  const createUser = useAction(api.users.create);
  const updateUser = useMutation(api.helpers.usersHelpers.update);
  const resetPassword = useAction(api.users.resetPassword);

  // Filter users by search query
  const filteredUsers = users?.filter(
    (u) =>
      (u.name?.toLowerCase() ?? "").includes(searchQuery.toLowerCase()) ||
      (u.email?.toLowerCase() ?? "").includes(searchQuery.toLowerCase()),
  );

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormData({
      ...initialFormData,
      storeId: selectedStoreId ?? undefined,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (userItem: NonNullable<typeof users>[number]) => {
    setEditingUser(userItem._id);
    setFormData({
      email: userItem.email ?? "",
      password: "", // Don't show existing password
      name: userItem.name ?? "",
      roleId: userItem.roleId,
      storeId: userItem.storeId,
      isActive: userItem.isActive,
    });
    setIsDialogOpen(true);
  };

  const handleOpenResetPassword = (userId: Id<"users">) => {
    setResetPasswordUserId(userId);
    setNewPassword("");
    setIsResetPasswordDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated || !formData.roleId) return;

    setIsSubmitting(true);
    try {
      if (editingUser) {
        await updateUser({
          userId: editingUser,
          name: formData.name,
          roleId: formData.roleId,
          storeId: formData.storeId,
          isActive: formData.isActive,
        });
        toast.success("User updated successfully");
      } else {
        if (!formData.password || !formData.email) {
          toast.error("Email and password are required for new users");
          setIsSubmitting(false);
          return;
        }
        const result = await createUser({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          roleId: formData.roleId,
          storeId: formData.storeId,
        });
        if (result.success) {
          toast.success("User created successfully");
        } else {
          toast.error(result.error);
          setIsSubmitting(false);
          return;
        }
      }
      setIsDialogOpen(false);
      setFormData(initialFormData);
      setEditingUser(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save user");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isAuthenticated || !resetPasswordUserId || !newPassword) return;

    setIsSubmitting(true);
    try {
      await resetPassword({
        userId: resetPasswordUserId,
        newPassword,
      });
      toast.success("Password reset successfully");
      setIsResetPasswordDialogOpen(false);
      setResetPasswordUserId(null);
      setNewPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset password");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-gray-500">Manage staff accounts and permissions</p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search users by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
                    <TableCell className="font-medium">{userItem.name ?? "—"}</TableCell>
                    <TableCell>{userItem.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          userItem.roleName === "Super Admin"
                            ? "default"
                            : userItem.roleName === "Admin"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {userItem.roleName}
                      </Badge>
                    </TableCell>
                    <TableCell>{userItem.storeName ?? "All Stores"}</TableCell>
                    <TableCell>
                      <Badge variant={userItem.isActive ? "default" : "destructive"}>
                        {userItem.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenResetPassword(userItem._id)}
                        title="Reset Password"
                      >
                        <Key className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(userItem)}
                        title="Edit User"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Create User"}</DialogTitle>
            <DialogDescription>
              {editingUser
                ? "Update the user details below."
                : "Fill in the details to create a new user."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter full name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Enter email address"
                disabled={!!editingUser}
              />
              {editingUser && (
                <p className="text-xs text-gray-500">Email cannot be changed after creation.</p>
              )}
            </div>

            {!editingUser && (
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Enter password"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={formData.roleId ?? ""}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    roleId: value as Id<"roles">,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles?.map((role) => (
                    <SelectItem key={role._id} value={role._id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="store">Assigned Store</Label>
              <Select
                value={formData.storeId ?? "none"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    storeId: value === "none" ? undefined : (value as Id<"stores">),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Store (System-wide)</SelectItem>
                  {stores?.map((store) => (
                    <SelectItem key={store._id} value={store._id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Super Admins typically have no assigned store.
              </p>
            </div>

            {editingUser && (
              <div className="grid gap-2">
                <Label htmlFor="isActive">Status</Label>
                <Select
                  value={formData.isActive ? "active" : "inactive"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      isActive: value === "active",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                !formData.name ||
                !formData.email ||
                !formData.roleId ||
                (!editingUser && !formData.password)
              }
            >
              {isSubmitting ? "Saving..." : editingUser ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={isResetPasswordDialogOpen} onOpenChange={setIsResetPasswordDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Enter a new password for this user.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsResetPasswordDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={isSubmitting || !newPassword}>
              {isSubmitting ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
