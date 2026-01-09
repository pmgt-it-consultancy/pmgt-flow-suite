import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { useAction, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";

const TOKEN_KEY = "pos_session_token";

interface User {
  _id: Id<"users">;
  username: string;
  name: string;
  roleId: Id<"roles">;
  storeId?: Id<"stores">;
  role: {
    name: string;
    permissions: string[];
    scopeLevel: "system" | "parent" | "branch";
  };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  const loginAction = useAction(api.auth.login);
  const logoutAction = useAction(api.auth.logout);

  // Query current user when token is available
  const currentUser = useQuery(
    api.sessions.getCurrentUser,
    token ? { token } : "skip"
  );

  // Load stored token on mount
  useEffect(() => {
    const loadToken = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (storedToken) {
          setToken(storedToken);
        }
      } catch (error) {
        console.error("Error loading token:", error);
      } finally {
        setIsInitialized(true);
      }
    };
    loadToken();
  }, []);

  // Update loading state based on query state
  useEffect(() => {
    if (!isInitialized) return;

    if (!token) {
      setIsLoading(false);
      return;
    }

    // If token exists but query hasn't returned yet, still loading
    if (currentUser === undefined) {
      setIsLoading(true);
      return;
    }

    // If user is null (invalid session), clear token
    if (currentUser === null) {
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(console.error);
      setToken(null);
    }

    setIsLoading(false);
  }, [token, currentUser, isInitialized]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);
      const result = await loginAction({ username, password });

      if (result.success === true) {
        await SecureStore.setItemAsync(TOKEN_KEY, result.token);
        setToken(result.token);
        return { success: true };
      } else {
        // TypeScript needs explicit check for success === false to narrow the type
        return { success: false, error: "error" in result ? result.error : "Login failed" };
      }
    } catch (error) {
      console.error("Login error:", error);
      return { success: false, error: "An unexpected error occurred" };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await logoutAction({ token });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setToken(null);
    }
  };

  const hasPermission = (permission: string): boolean => {
    if (!currentUser || !currentUser.role) return false;
    return currentUser.role.permissions.includes(permission);
  };

  const value: AuthContextType = {
    user: currentUser ?? null,
    token,
    isLoading,
    isAuthenticated: !!currentUser,
    login,
    logout,
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

export function useSessionToken() {
  const { token } = useAuth();
  return token;
}
