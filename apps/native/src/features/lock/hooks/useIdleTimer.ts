import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "../../auth/context";
import { useLockStore } from "../stores/useLockStore";

const WARNING_BEFORE_LOCK_MS = 30_000;

export function useIdleTimer() {
  const { user } = useAuth();
  const isLocked = useLockStore((state) => state.isLocked);
  const lock = useLockStore((state) => state.lock);
  const setShowIdleWarning = useLockStore((state) => state.setShowIdleWarning);
  const screenLockMutation = useMutation(api.screenLock.screenLock);

  const storeId = user?.storeId;
  const timeoutMinutes = useQuery(
    api.screenLock.getAutoLockTimeout,
    storeId ? { storeId } : "skip",
  );
  const userHasPin = useQuery(
    api.screenLock.getUserHasPin,
    user?._id ? { userId: user._id } : "skip",
  );

  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundTimestampRef = useRef<number | null>(null);
  const currentRouteRef = useRef<string | null>(null);

  const timeoutMs =
    typeof timeoutMinutes === "number" && timeoutMinutes > 0 ? timeoutMinutes * 60 * 1000 : null;

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }

    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  }, []);

  const triggerLock = useCallback(
    (trigger: "manual" | "idle_timeout") => {
      if (!user || isLocked || !userHasPin) {
        return;
      }

      setShowIdleWarning(false);
      lock({
        userId: user._id,
        userName: user.name ?? "User",
        userRole: user.role?.name ?? "Staff",
      });

      if (storeId) {
        screenLockMutation({ storeId, trigger }).catch(() => {});
      }
    },
    [isLocked, lock, screenLockMutation, setShowIdleWarning, storeId, user, userHasPin],
  );

  const startTimers = useCallback(() => {
    clearTimers();

    if (!timeoutMs || isLocked || !userHasPin) {
      return;
    }

    if (currentRouteRef.current === "CheckoutScreen") {
      return;
    }

    const warningDelay = timeoutMs - WARNING_BEFORE_LOCK_MS;

    if (warningDelay > 0) {
      warningTimerRef.current = setTimeout(() => {
        setShowIdleWarning(true);
      }, warningDelay);
    }

    lockTimerRef.current = setTimeout(() => {
      triggerLock("idle_timeout");
    }, timeoutMs);
  }, [clearTimers, isLocked, setShowIdleWarning, timeoutMs, triggerLock, userHasPin]);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowIdleWarning(false);
    startTimers();
  }, [setShowIdleWarning, startTimers]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        backgroundTimestampRef.current = Date.now();
        clearTimers();
        return;
      }

      if (state !== "active") {
        return;
      }

      const backgroundAt = backgroundTimestampRef.current;
      backgroundTimestampRef.current = null;

      if (!backgroundAt || !timeoutMs || isLocked || !userHasPin) {
        if (!isLocked && timeoutMs && userHasPin) {
          startTimers();
        }
        return;
      }

      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= timeoutMs) {
        triggerLock("idle_timeout");
        return;
      }

      startTimers();
    });

    return () => subscription.remove();
  }, [clearTimers, isLocked, startTimers, timeoutMs, triggerLock, userHasPin]);

  useEffect(() => {
    if (!isLocked && timeoutMs && userHasPin) {
      startTimers();
    }

    return clearTimers;
  }, [clearTimers, isLocked, startTimers, timeoutMs, userHasPin]);

  return {
    resetActivity,
    setCurrentRoute: (route: string | null) => {
      currentRouteRef.current = route;

      if (route === "CheckoutScreen") {
        clearTimers();
        setShowIdleWarning(false);
        return;
      }

      if (!isLocked && timeoutMs && userHasPin) {
        startTimers();
      }
    },
  };
}
