"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { PERMISSIONS } from "@packages/backend/convex/lib/permissions";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus, Search, Shield, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";

type ScopeLevel = "system" | "parent" | "branch";

interface RoleFormData {
  name: string;
  scopeLevel: ScopeLevel;
  permissions: string[];
}

const initialFormData: RoleFormData = {
  name: "",
  scopeLevel: "branch",
  permissions: [],
};

const scopeLabels: Record<ScopeLevel, string> = {
  system: "System",
  parent: "Parent",
  branch: "Branch",
};

const categoryLabels: Record<string, string> = {
  orders: "Orders",
  checkout: "Checkout",
  discounts: "Discounts",
  tables: "Tables",
  products: "Products",
  categories: "Categories",
  modifiers: "Modifiers",
  reports: "Reports",
  users: "Users",
  stores: "Stores",
  system: "System",
};

export default function RolesPage() {
  const { isAuthenticated, hasPermission, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<Id<"roles"> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<RoleFormData>(initialFormData);

  const roles = useQuery(api.roles.list, isAuthenticated ? {} : "skip");
  const createRole = useMutation(api.roles.create);
  const updateRole = useMutation(api.roles.update);

  const permissionCategories = useMemo(() => {
    return Object.entries(PERMISSIONS).reduce<Record<string, Array<[string, string]>>>(
      (acc, [permission, description]) => {
        const category = permission.split(".")[0] ?? "other";
        acc[category] ??= [];
        acc[category].push([permission, description]);
        return acc;
      },
      {},
    );
  }, []);

  const filteredRoles = useMemo(() => {
    if (!roles) {
      return [];
    }

    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      return roles;
    }

    return roles.filter((role) => {
      const haystack = [
        role.name,
        role.scopeLevel,
        role.isSystem ? "system" : "custom",
        ...role.permissions,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [roles, searchQuery]);

  const canManageRoles = hasPermission("system.roles");

  const resetForm = () => {
    setEditingRoleId(null);
    setFormData(initialFormData);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (role: NonNullable<typeof roles>[number]) => {
    setEditingRoleId(role._id);
    setFormData({
      name: role.name,
      scopeLevel: role.scopeLevel,
      permissions: [...role.permissions],
    });
    setIsDialogOpen(true);
  };

  const togglePermission = (permission: string, checked: boolean) => {
    setFormData((current) => ({
      ...current,
      permissions: checked
        ? Array.from(new Set([...current.permissions, permission]))
        : current.permissions.filter((value) => value !== permission),
    }));
  };

  const handleSubmit = async () => {
    if (!canManageRoles) {
      toast.error("You do not have permission to manage roles.");
      return;
    }

    if (!formData.name.trim()) {
      toast.error("Role name is required.");
      return;
    }

    if (formData.permissions.length === 0) {
      toast.error("Select at least one permission.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingRoleId) {
        await updateRole({
          roleId: editingRoleId,
          name: formData.name.trim(),
          scopeLevel: formData.scopeLevel,
          permissions: formData.permissions,
        });
        toast.success("Role updated successfully");
      } else {
        await createRole({
          name: formData.name.trim(),
          scopeLevel: formData.scopeLevel,
          permissions: formData.permissions,
        });
        toast.success("Role created successfully");
      }

      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save role");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canManageRoles) {
    return (
      <Card>
        <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4">
          <Shield className="h-10 w-10 text-gray-400" />
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold">Role Management</h1>
            <p className="text-sm text-gray-500">
              You need the <code>system.roles</code> permission to manage roles.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
          <p className="text-gray-500">
            Add custom roles and edit existing seeded roles for {user?.roleName ?? "your team"}.
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Role
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search roles by name, scope, or permission..."
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Roles</CardTitle>
          <CardDescription>{filteredRoles?.length ?? 0} role(s) available</CardDescription>
        </CardHeader>
        <CardContent>
          {!roles ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : filteredRoles.length === 0 ? (
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
                {filteredRoles.map((role) => (
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
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(role)}>
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

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRoleId ? "Edit Role" : "Create Role"}</DialogTitle>
            <DialogDescription>
              {editingRoleId
                ? "Update the role name, scope, and permissions."
                : "Create a new role with a custom permission set."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="role-name">Role Name</Label>
                <Input
                  id="role-name"
                  value={formData.name}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="e.g. Cashier Lead"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="role-scope">Scope Level</Label>
                <Select
                  value={formData.scopeLevel}
                  onValueChange={(value) =>
                    setFormData((current) => ({
                      ...current,
                      scopeLevel: value as ScopeLevel,
                    }))
                  }
                >
                  <SelectTrigger id="role-scope">
                    <SelectValue placeholder="Select scope" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="branch">Branch</SelectItem>
                    <SelectItem value="parent">Parent</SelectItem>
                    {user?.scopeLevel === "system" && (
                      <SelectItem value="system">System</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <div>
                  <h3 className="font-semibold">Permissions</h3>
                  <p className="text-sm text-gray-500">
                    Enable the capabilities this role should have in the POS system.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {Object.entries(permissionCategories).map(([category, permissions]) => (
                  <Card key={category}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">
                        {categoryLabels[category] ?? category}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {permissions.map(([permission, description]) => {
                        const checked = formData.permissions.includes(permission);
                        return (
                          <div
                            key={permission}
                            className="flex items-start justify-between gap-4 rounded-lg border p-3"
                          >
                            <div className="space-y-1">
                              <p className="font-mono text-xs font-medium">{permission}</p>
                              <p className="text-sm text-gray-500">{description}</p>
                            </div>
                            <Switch
                              checked={checked}
                              onCheckedChange={(value) => togglePermission(permission, value)}
                            />
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : editingRoleId ? "Save Changes" : "Create Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
