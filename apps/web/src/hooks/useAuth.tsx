"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useConvexAuth, useQuery } from "convex/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect } from "react";

// Types
type ScopeLevel = "system" | "parent" | "branch";

interface User {
  _id: Id<"users">;
  email?: string;
  name?: string;
  roleId?: Id<"roles">;
  storeId?: Id<"stores">;
  permissions: string[];
  roleName: string;
  scopeLevel: ScopeLevel;
  storeName?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (
    email: string,
    password: string,
    flow?: "signIn" | "signUp",
  ) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoading: isAuthLoading, isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  // Query current user when authenticated (Convex Auth handles auth context automatically)
  const currentUser = useQuery(api.sessions.getCurrentUser, isConvexAuthenticated ? {} : "skip");

  // Determine loading state
  const isLoading = isAuthLoading || (isConvexAuthenticated && currentUser === undefined);

  // Build user object with permissions from role
  const user: User | null = currentUser?.role
    ? {
        _id: currentUser._id,
        email: currentUser.email,
        name: currentUser.name,
        roleId: currentUser.roleId,
        storeId: currentUser.storeId,
        permissions: currentUser.role.permissions,
        roleName: currentUser.role.name,
        scopeLevel: currentUser.role.scopeLevel,
        storeName: undefined, // Fetched separately if needed
      }
    : null;

  // Sign in function using Convex Auth Password provider
  const signIn = useCallback(
    async (
      email: string,
      password: string,
      flow: "signIn" | "signUp" = "signIn",
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        await convexSignIn("password", { email, password, flow });
        return { success: true };
      } catch (error) {
        console.error("Sign in error:", error);
        const errorMessage = error instanceof Error ? error.message : "Authentication failed";
        return { success: false, error: errorMessage };
      }
    },
    [convexSignIn],
  );

  // Sign out function
  const signOut = useCallback(async () => {
    try {
      await convexSignOut();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  }, [convexSignOut]);

  // Permission check functions
  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      return user.permissions.includes(permission);
    },
    [user],
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]): boolean => {
      if (!user) return false;
      return permissions.some((p) => user.permissions.includes(p));
    },
    [user],
  );

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: isConvexAuthenticated && !!user,
    signIn,
    signOut,
    hasPermission,
    hasAnyPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Hook to require authentication (redirect if not authenticated)
export function useRequireAuth(redirectTo = "/login") {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.href = redirectTo;
    }
  }, [isAuthenticated, isLoading, redirectTo]);

  return { isAuthenticated, isLoading };
}

// Hook to require a specific permission
export function useRequirePermission(permission: string, redirectTo = "/dashboard") {
  const { hasPermission, isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated && !hasPermission(permission)) {
      window.location.href = redirectTo;
    }
  }, [hasPermission, isLoading, isAuthenticated, permission, redirectTo]);

  return { hasPermission: hasPermission(permission), isLoading };
}
