import { useAuthToken } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { useAuth } from "../features/auth";
import { syncManager } from "./SyncManager";
import { setAuthTokenFn } from "./syncEndpoints";

/**
 * Wires the SyncManager into the live auth state. Mount once, inside the
 * ConvexAuthProvider + AuthProvider tree. Has no DOM output — pure
 * side-effect.
 *
 * Behavior:
 *   - When the user signs in (token becomes non-null), starts the sync
 *     loop. The token getter reads from a ref so it always returns the
 *     current value, even after refresh-rotation.
 *   - When the user signs out (token becomes null), stops the sync loop.
 *
 * Auth providers wrapping this component:
 *   ConvexClientProvider → ConvexAuthProvider → AuthProvider → here
 */
export function SyncBootstrap() {
  const token = useAuthToken();
  const { isAuthenticated } = useAuth();

  // Keep latest token in a ref so the sync manager always sees current
  // value across refresh-token rotations without re-registering callbacks.
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  // Set the token getter once — it reads from the ref each call.
  useEffect(() => {
    setAuthTokenFn(async () => tokenRef.current);
  }, []);

  // Start/stop the sync loop based on auth state.
  useEffect(() => {
    if (isAuthenticated && token) {
      void syncManager.start();
      return () => {
        syncManager.stop();
      };
    }
  }, [isAuthenticated, token]);

  return null;
}
