"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import {
  PinManagementDialog,
  ResetPasswordDialog,
  type UserData,
  UserFormDialog,
  UsersDataTable,
} from "./_components";
import { type UserFormValues, userDefaults } from "./_schemas";

export default function UsersPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // User form dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"users"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<UserFormValues | undefined>(undefined);

  // Reset password dialog state
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<Id<"users"> | null>(null);

  // PIN management dialog state
  const [isPinOpen, setIsPinOpen] = useState(false);
  const [pinUserId, setPinUserId] = useState<Id<"users"> | null>(null);
  const [pinUserName, setPinUserName] = useState("");
  const [pinUserHasPin, setPinUserHasPin] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [pinFilter, setPinFilter] = useState<"all" | "has-pin" | "needs-pin">("all");
  const [storeFilter, setStoreFilter] = useState<"all" | "assigned" | "all-stores">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "email" | "role" | "store">("name");

  // Queries
  const users = useQuery(
    api.helpers.usersHelpers.list,
    isAuthenticated ? { storeId: selectedStoreId ?? undefined } : "skip",
  );

  const roleOptions = useMemo(() => {
    return Array.from(new Set(users?.map((u) => u.roleName).filter(Boolean) ?? [])).toSorted();
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = users?.filter((u) => {
      if (statusFilter !== "all" && u.isActive !== (statusFilter === "active")) return false;
      if (pinFilter === "has-pin" && !u.hasPin) return false;
      if (pinFilter === "needs-pin" && !u.pendingPinSetup) return false;
      if (storeFilter === "assigned" && !u.storeId) return false;
      if (storeFilter === "all-stores" && u.storeId) return false;
      if (roleFilter !== "all" && u.roleName !== roleFilter) return false;
      if (query) {
        const haystack = [u.name, u.email, u.roleName, u.storeName ?? "All Stores"]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    return filtered?.toSorted((a, b) => {
      switch (sortBy) {
        case "email":
          return (a.email ?? "").localeCompare(b.email ?? "");
        case "role":
          return a.roleName.localeCompare(b.roleName) || (a.name ?? "").localeCompare(b.name ?? "");
        case "store":
          return (a.storeName ?? "All Stores").localeCompare(b.storeName ?? "All Stores");
        default:
          return (a.name ?? "").localeCompare(b.name ?? "");
      }
    });
  }, [users, searchQuery, statusFilter, pinFilter, storeFilter, roleFilter, sortBy]);

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormInitialValues({
      ...userDefaults,
      storeId: selectedStoreId ?? undefined,
    });
    setIsFormOpen(true);
  };

  const handleEdit = (userItem: UserData) => {
    setEditingId(userItem._id);
    setFormInitialValues({
      email: userItem.email ?? "",
      password: "",
      name: userItem.name ?? "",
      roleId: userItem.roleId ?? "",
      storeId: userItem.storeId,
      isActive: userItem.isActive,
    });
    setIsFormOpen(true);
  };

  const handleDuplicate = (userItem: UserData) => {
    setEditingId(null);
    setFormInitialValues({
      name: `${userItem.name ?? ""} (Copy)`,
      email: "",
      password: "",
      roleId: userItem.roleId ?? "",
      storeId: userItem.storeId,
      isActive: true,
    });
    setIsFormOpen(true);
  };

  const handleSaveAndCreateAnother = (): UserFormValues => ({
    ...userDefaults,
    storeId: selectedStoreId ?? undefined,
  });

  const handleResetPassword = (userId: Id<"users">) => {
    setResetPasswordUserId(userId);
    setIsResetPasswordOpen(true);
  };

  const handleManagePin = (userItem: UserData) => {
    setPinUserId(userItem._id);
    setPinUserName(userItem.name ?? "Unknown");
    setPinUserHasPin(userItem.hasPin);
    setIsPinOpen(true);
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

      <UsersDataTable
        users={users}
        filteredUsers={filteredUsers}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        pinFilter={pinFilter}
        onPinFilterChange={setPinFilter}
        storeFilter={storeFilter}
        onStoreFilterChange={setStoreFilter}
        roleFilter={roleFilter}
        roleOptions={roleOptions}
        onRoleFilterChange={setRoleFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        onResetFilters={() => {
          setSearchQuery("");
          setStatusFilter("active");
          setPinFilter("all");
          setStoreFilter("all");
          setRoleFilter("all");
          setSortBy("name");
        }}
        onEdit={handleEdit}
        onDuplicate={handleDuplicate}
        onResetPassword={handleResetPassword}
        onManagePin={handleManagePin}
      />

      <UserFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
        initialValues={formInitialValues}
        onSaveAndCreateAnother={handleSaveAndCreateAnother}
      />

      <ResetPasswordDialog
        open={isResetPasswordOpen}
        onOpenChange={setIsResetPasswordOpen}
        userId={resetPasswordUserId}
      />

      <PinManagementDialog
        open={isPinOpen}
        onOpenChange={setIsPinOpen}
        userId={pinUserId}
        userName={pinUserName}
        hasPin={pinUserHasPin}
      />
    </div>
  );
}
