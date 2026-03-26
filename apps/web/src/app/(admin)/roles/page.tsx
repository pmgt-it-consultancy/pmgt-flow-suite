"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { PERMISSIONS } from "@packages/backend/convex/lib/permissions";
import { useQuery } from "convex/react";
import { Plus, Shield } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { RoleFormDialog, RolesDataTable } from "./_components";
import { type RoleFormValues, roleDefaults } from "./_schemas";

export default function RolesPage() {
  const { isAuthenticated, hasPermission, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"roles"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<RoleFormValues | undefined>();

  // Queries
  const roles = useQuery(api.roles.list, isAuthenticated ? {} : "skip");

  // Compute permission categories
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

  // Filter roles by search
  const filteredRoles = useMemo(() => {
    if (!roles) return [];

    const query = searchQuery.toLowerCase().trim();
    if (!query) return roles;

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

  const handleOpenCreate = useCallback(() => {
    setEditingId(null);
    setFormInitialValues(roleDefaults);
    setIsFormOpen(true);
  }, []);

  const handleOpenEdit = useCallback(
    (role: {
      _id: Id<"roles">;
      name: string;
      scopeLevel: "system" | "parent" | "branch";
      permissions: string[];
    }) => {
      setEditingId(role._id);
      setFormInitialValues({
        name: role.name,
        scopeLevel: role.scopeLevel,
        permissions: [...role.permissions],
      });
      setIsFormOpen(true);
    },
    [],
  );

  const handleDuplicate = useCallback(
    (role: { name: string; scopeLevel: "system" | "parent" | "branch"; permissions: string[] }) => {
      setEditingId(null);
      setFormInitialValues({
        name: `${role.name} (Copy)`,
        scopeLevel: role.scopeLevel,
        permissions: [...role.permissions],
      });
      setIsFormOpen(true);
    },
    [],
  );

  if (!canManageRoles) {
    return (
      <Card>
        <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4">
          <Shield className="h-10 w-10 text-gray-400" />
          <div className="flex flex-col gap-1 text-center">
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
    <div className="flex flex-col gap-6">
      {/* Page Header */}
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

      {/* Roles List */}
      <RolesDataTable
        roles={filteredRoles}
        loading={roles === undefined}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onEdit={handleOpenEdit}
        onDuplicate={handleDuplicate}
      />

      {/* Create/Edit Role Dialog */}
      <RoleFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
        initialValues={formInitialValues}
        onSaveAndCreateAnother={() => roleDefaults}
        user={user}
        permissionCategories={permissionCategories}
      />
    </div>
  );
}
