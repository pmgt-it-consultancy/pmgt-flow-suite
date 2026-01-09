"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";

// Types
interface User {
  _id: Id<"users">;
  username: string;
  name: string;
  roleId: Id<"roles">;
  storeId?: Id<"stores">;
  permissions: string[];
  roleName: string;
  storeName?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token storage key
const TOKEN_KEY = "pos_session_token";

// Get token from localStorage
function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

// Set token in localStorage
function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

// Remove token from localStorage
function removeToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setTokenState] = useState<string | null>(null);

  // Convex actions
  const loginAction = useAction(api.auth.login);
  const logoutAction = useAction(api.auth.logout);

  // Validate session query - only runs when we have a token
  const sessionValidation = useQuery(
    api.sessions.validateSession,
    token ? { token } : "skip"
  );

  // Initialize token from localStorage
  useEffect(() => {
    const storedToken = getToken();
    if (storedToken) {
      setTokenState(storedToken);
    } else {
      setIsLoading(false);
    }
  }, []);

  // Update user when session validation returns
  useEffect(() => {
    if (sessionValidation === undefined && token) {
      // Still loading
      return;
    }

    if (!sessionValidation || !sessionValidation.valid) {
      // Invalid session
      setUser(null);
      setIsLoading(false);
      if (token) {
        removeToken();
        setTokenState(null);
      }
    } else {
      // Valid session
      setUser({
        _id: sessionValidation.user._id,
        username: sessionValidation.user.username,
        name: sessionValidation.user.name,
        roleId: sessionValidation.user.roleId,
        storeId: sessionValidation.user.storeId,
        permissions: sessionValidation.role.permissions,
        roleName: sessionValidation.role.name,
        storeName: undefined, // Will be fetched separately if needed
      });
      setIsLoading(false);
    }
  }, [sessionValidation, token]);

  // Login function
  const login = useCallback(
    async (
      username: string,
      password: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const result = await loginAction({ username, password });

        if (result.success && "token" in result) {
          setToken(result.token);
          setTokenState(result.token);
          return { success: true };
        } else if (!result.success && "error" in result) {
          return { success: false, error: result.error };
        } else {
          return { success: false, error: "Login failed" };
        }
      } catch (error) {
        console.error("Login error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Login failed",
        };
      }
    },
    [loginAction]
  );

  // Logout function
  const logout = useCallback(async () => {
    try {
      if (token) {
        await logoutAction({ token });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      removeToken();
      setTokenState(null);
      setUser(null);
    }
  }, [logoutAction, token]);

  // Permission check functions
  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      return user.permissions.includes(permission);
    },
    [user]
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]): boolean => {
      if (!user) return false;
      return permissions.some((p) => user.permissions.includes(p));
    },
    [user]
  );

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
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

// Hook to get the current session token
export function useSessionToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(getToken());
  }, []);

  return token;
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
