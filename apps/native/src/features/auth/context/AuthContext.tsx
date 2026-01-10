import React, { createContext, useContext, ReactNode, useCallback } from "react";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";

interface User {
  _id: Id<"users">;
  email?: string;
  name?: string;
  roleId?: Id<"roles">;
  storeId?: Id<"stores">;
  role: {
    _id: Id<"roles">;
    name: string;
    permissions: string[];
    scopeLevel: "system" | "parent" | "branch";
  } | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string, flow?: "signIn" | "signUp") => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoading: isAuthLoading, isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  // Query current user when authenticated (Convex Auth handles auth context automatically)
  const currentUser = useQuery(
    api.sessions.getCurrentUser,
    isConvexAuthenticated ? {} : "skip"
  );

  // Determine loading state
  const isLoading = isAuthLoading || (isConvexAuthenticated && currentUser === undefined);

  const signIn = useCallback(
    async (
      email: string,
      password: string,
      flow: "signIn" | "signUp" = "signIn"
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        await convexSignIn("password", { email, password, flow });
        return { success: true };
      } catch (error) {
        console.error("Sign in error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Authentication failed";
        return { success: false, error: errorMessage };
      }
    },
    [convexSignIn]
  );

  const signOut = useCallback(async () => {
    try {
      await convexSignOut();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  }, [convexSignOut]);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!currentUser || !currentUser.role) return false;
      return currentUser.role.permissions.includes(permission);
    },
    [currentUser]
  );

  const value: AuthContextType = {
    user: currentUser ?? null,
    isLoading,
    isAuthenticated: isConvexAuthenticated && !!currentUser,
    signIn,
    signOut,
    hasPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
