import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useConvexAuth, useQuery } from "convex/react";
import { createContext, type ReactNode, useCallback, useContext } from "react";

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
  signIn: (
    email: string,
    password: string,
    flow?: "signIn" | "signUp",
  ) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function parseAuthError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Authentication failed. Please try again.";
  }

  const message = error.message;

  // Handle specific Convex Auth error codes
  if (message.includes("InvalidSecret")) {
    return "Invalid email or password.";
  }
  if (message.includes("InvalidAccountId") || message.includes("account not found")) {
    return "No account found with this email.";
  }
  if (message.includes("TooManyFailedAttempts")) {
    return "Too many failed attempts. Please try again later.";
  }
  if (message.includes("EmailNotVerified")) {
    return "Please verify your email before signing in.";
  }

  // Generic fallback
  return "Authentication failed. Please check your credentials and try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoading: isAuthLoading, isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

  // Query current user when authenticated (Convex Auth handles auth context automatically)
  const currentUser = useQuery(api.sessions.getCurrentUser, isConvexAuthenticated ? {} : "skip");

  // Determine loading state
  const isLoading = isAuthLoading || (isConvexAuthenticated && currentUser === undefined);

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
        const errorMessage = parseAuthError(error);
        return { success: false, error: errorMessage };
      }
    },
    [convexSignIn],
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
    [currentUser],
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
