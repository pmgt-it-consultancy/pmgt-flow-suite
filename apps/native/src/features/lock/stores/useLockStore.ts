import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const MAX_FAILED_ATTEMPTS = 5;
const COOLDOWN_DURATION_MS = 30_000;

interface LockState {
  isLocked: boolean;
  lockedAt: number | null;
  lockedUserId: string | null;
  lockedUserName: string | null;
  lockedUserRole: string | null;
  lastRouteName: string | null;
  lastRouteParams: Record<string, unknown> | null;
  showIdleWarning: boolean;
  warningStartedAt: number | null;
  failedAttempts: number;
  cooldownUntil: number | null;
}

interface LockActions {
  lock: (user: { userId: string; userName: string; userRole: string }) => void;
  unlock: () => void;
  setLastRoute: (routeName: string | null, params?: Record<string, unknown> | null) => void;
  setShowIdleWarning: (show: boolean) => void;
  recordFailedAttempt: () => boolean;
  resetFailedAttempts: () => void;
  isCoolingDown: () => boolean;
}

export const useLockStore = create<LockState & LockActions>()(
  persist(
    (set, get) => ({
      isLocked: false,
      lockedAt: null,
      lockedUserId: null,
      lockedUserName: null,
      lockedUserRole: null,
      lastRouteName: null,
      lastRouteParams: null,
      showIdleWarning: false,
      warningStartedAt: null,
      failedAttempts: 0,
      cooldownUntil: null,

      lock: (user) =>
        set({
          isLocked: true,
          lockedAt: Date.now(),
          lockedUserId: user.userId,
          lockedUserName: user.userName,
          lockedUserRole: user.userRole,
          showIdleWarning: false,
          warningStartedAt: null,
          failedAttempts: 0,
          cooldownUntil: null,
        }),

      unlock: () =>
        set({
          isLocked: false,
          lockedAt: null,
          lockedUserId: null,
          lockedUserName: null,
          lockedUserRole: null,
          showIdleWarning: false,
          warningStartedAt: null,
          failedAttempts: 0,
          cooldownUntil: null,
        }),

      setLastRoute: (routeName, params = null) =>
        set({
          lastRouteName: routeName,
          lastRouteParams: params,
        }),

      setShowIdleWarning: (show) =>
        set({
          showIdleWarning: show,
          warningStartedAt: show ? Date.now() : null,
        }),

      recordFailedAttempt: () => {
        const attempts = get().failedAttempts + 1;
        if (attempts >= MAX_FAILED_ATTEMPTS) {
          set({
            failedAttempts: 0,
            cooldownUntil: Date.now() + COOLDOWN_DURATION_MS,
          });
          return true;
        }

        set({ failedAttempts: attempts });
        return false;
      },

      resetFailedAttempts: () => set({ failedAttempts: 0, cooldownUntil: null }),

      isCoolingDown: () => {
        const { cooldownUntil } = get();
        if (!cooldownUntil) {
          return false;
        }

        if (Date.now() >= cooldownUntil) {
          set({ cooldownUntil: null });
          return false;
        }

        return true;
      },
    }),
    {
      name: "lock-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isLocked: state.isLocked,
        lockedAt: state.lockedAt,
        lockedUserId: state.lockedUserId,
        lockedUserName: state.lockedUserName,
        lockedUserRole: state.lockedUserRole,
        lastRouteName: state.lastRouteName,
        lastRouteParams: state.lastRouteParams,
      }),
    },
  ),
);
