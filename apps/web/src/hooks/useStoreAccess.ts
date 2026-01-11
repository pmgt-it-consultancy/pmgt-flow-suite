"use client";

import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAuth } from "./useAuth";

export interface AccessibleStore {
  _id: Id<"stores">;
  name: string;
  parentId?: Id<"stores">;
  isActive: boolean;
}

interface StoreAccessResult {
  /** Stores the user has access to (already filtered by backend based on role) */
  accessibleStores: AccessibleStore[];
  /** Whether the user can change the selected store (false for Manager/Staff) */
  canChangeStore: boolean;
  /** The user's default store (their assigned storeId) */
  defaultStoreId: Id<"stores"> | null;
  /** Loading state */
  isLoading: boolean;
}

/**
 * Hook to get role-based store access information.
 *
 * - Super Admin (system): Access to all stores, can change
 * - Admin (parent): Access to parent store + branches, can change
 * - Manager/Staff (branch): Access to single store, cannot change
 */
export function useStoreAccess(): StoreAccessResult {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  // Query stores - backend already filters based on user role
  const stores = useQuery(
    api.stores.list,
    isAuthenticated ? {} : "skip"
  );

  const isLoading = authLoading || (isAuthenticated && stores === undefined);

  // Map stores to simplified format
  const accessibleStores: AccessibleStore[] = (stores ?? []).map((store) => ({
    _id: store._id,
    name: store.name,
    parentId: store.parentId,
    isActive: store.isActive,
  }));

  // Determine if user can change store based on scope level
  // system (Super Admin) and parent (Admin) can change
  // branch (Manager/Staff) cannot change
  const canChangeStore = user?.scopeLevel !== "branch";

  // Default store is the user's assigned store
  const defaultStoreId = user?.storeId ?? null;

  return {
    accessibleStores,
    canChangeStore,
    defaultStoreId,
    isLoading,
  };
}
