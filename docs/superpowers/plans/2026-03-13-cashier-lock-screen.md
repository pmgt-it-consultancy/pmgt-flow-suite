# Cashier Lock Screen Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a screen lock feature to the native POS app with manual lock, idle auto-lock with warning, PIN unlock, and manager override.

**Architecture:** Navigation-based lock screen pushed onto React Navigation stack. Lock state persisted via Zustand + AsyncStorage. Idle detection via touch event listener + AppState monitoring. Backend actions handle atomic PIN verification + audit logging.

**Tech Stack:** React Native, React Navigation (native stack), Zustand, AsyncStorage, Convex (backend), bcryptjs, Tamagui

**Spec:** `docs/superpowers/specs/2026-03-13-cashier-lock-screen-design.md`

---

## File Structure

### Backend (packages/backend/convex/)
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `screenLock.ts` | Mutations: `screenLock`, `setAutoLockTimeout`. Query: `getAutoLockTimeout`, `getUserHasPin`. Internal mutations: `logScreenUnlock`, `logScreenUnlockOverride`. (NO `"use node"`) |
| Create | `screenLockActions.ts` | `"use node"` actions: `screenUnlock`, `screenUnlockOverride` (PIN verification via bcrypt + audit logging via internal mutations) |
| Create | `screenLock.test.ts` | Tests for screenLock queries and mutations |

### Native App (apps/native/src/)
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `features/lock/stores/useLockStore.ts` | Zustand store: `isLocked`, `lockedAt`, `lockedUserId`, `lockedUserName`, `lockedUserRole`, `showIdleWarning`, `failedAttempts`, `cooldownUntil` |
| Create | `features/lock/hooks/useIdleTimer.ts` | Custom hook: tracks last activity, AppState transitions, shows warning at T-30s, triggers lock at timeout, fires audit mutation |
| Create | `features/lock/screens/LockScreen.tsx` | Lock screen UI: clock, user info, PIN pad, unlock button, manager override |
| Create | `features/lock/components/IdleWarningBanner.tsx` | Amber warning overlay with synchronized countdown |
| Create | `features/lock/components/NumericPinPad.tsx` | Reusable numeric keypad (0-9 + backspace) with PIN dots display |
| Create | `features/lock/components/ManagerOverrideModal.tsx` | Manager selection + PIN entry modal that delegates verification to `screenUnlockOverride` (no double-verify) |
| Create | `features/lock/index.ts` | Barrel export for LockScreen |
| Modify | `navigation/Navigation.tsx` | Add `LockScreen` to stack and `RootStackParamList`, navigate on lock state change |
| Modify | `features/home/components/HomeHeader.tsx` | Add lock icon button (conditionally shown when user has PIN) |
| Modify | `features/home/screens/HomeScreen.tsx` | Pass `onLock` and `showLockButton` to HomeHeader |
| Modify | `features/settings/screens/SettingsScreen.tsx` | Add "Auto-Lock After" setting row with picker modal |
| Modify | `App.tsx` | Integrate idle timer touch detection, lock-on-launch from persisted state, warning banner |

---

## Chunk 1: Backend — Lock Mutations, Actions & Settings Query

### Task 1: Create screenLock.ts (mutations and queries — no "use node")

**Files:**
- Create: `packages/backend/convex/screenLock.ts`

- [ ] **Step 1: Create screenLock.ts with the screenLock mutation, internal mutations, queries**

```typescript
// packages/backend/convex/screenLock.ts
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

// ===== PUBLIC MUTATION: Log screen lock event =====
export const screenLock = mutation({
  args: {
    storeId: v.id("stores"),
    trigger: v.union(v.literal("manual"), v.literal("idle_timeout")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "screen_locked",
      entityType: "screen_lock",
      entityId: user._id,
      details: JSON.stringify({
        trigger: args.trigger,
        userId: user._id,
      }),
      userId: user._id,
      createdAt: Date.now(),
    });

    return null;
  },
});

// ===== INTERNAL MUTATIONS: Called by actions after PIN verification =====
export const logScreenUnlock = internalMutation({
  args: {
    storeId: v.id("stores"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "screen_unlocked",
      entityType: "screen_lock",
      entityId: args.userId,
      details: JSON.stringify({
        userId: args.userId,
        method: "pin",
      }),
      userId: args.userId,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const logScreenUnlockOverride = internalMutation({
  args: {
    storeId: v.id("stores"),
    lockedUserId: v.id("users"),
    managerId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "screen_unlock_override",
      entityType: "screen_lock",
      entityId: args.lockedUserId,
      details: JSON.stringify({
        lockedUserId: args.lockedUserId,
        overrideManagerId: args.managerId,
        method: "manager_pin",
      }),
      userId: args.managerId,
      createdAt: Date.now(),
    });
    return null;
  },
});

// ===== QUERIES =====
export const getAutoLockTimeout = query({
  args: {
    storeId: v.id("stores"),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("settings")
      .withIndex("by_store_key", (q) =>
        q.eq("storeId", args.storeId).eq("key", "autoLockTimeout"),
      )
      .unique();

    if (!setting) return 5; // Default: 5 minutes
    const value = Number.parseInt(setting.value, 10);
    return Number.isNaN(value) ? 5 : value;
  },
});

export const getUserHasPin = query({
  args: {
    userId: v.id("users"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return false;
    return !!user.pin;
  },
});

// ===== MUTATION: Set auto-lock timeout (requires auth) =====
export const setAutoLockTimeout = mutation({
  args: {
    storeId: v.id("stores"),
    minutes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user has a manager+ role by checking role permissions
    if (!user.roleId) throw new Error("No role assigned");
    const role = await ctx.db.get(user.roleId);
    if (!role) throw new Error("Role not found");
    if (!role.permissions.includes("system.settings") && role.scopeLevel === "branch" && role.name === "Staff") {
      throw new Error("Insufficient permissions to change settings");
    }

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_store_key", (q) =>
        q.eq("storeId", args.storeId).eq("key", "autoLockTimeout"),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.minutes.toString(),
        updatedAt: Date.now(),
        updatedBy: user._id,
      });
    } else {
      await ctx.db.insert("settings", {
        storeId: args.storeId,
        key: "autoLockTimeout",
        value: args.minutes.toString(),
        updatedAt: Date.now(),
        updatedBy: user._id,
      });
    }

    return null;
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/convex/screenLock.ts
git commit -m "feat(backend): add screen lock mutations, queries, and settings"
```

### Task 2: Create screenLockActions.ts (Node actions with bcrypt)

**Files:**
- Create: `packages/backend/convex/screenLockActions.ts`

- [ ] **Step 1: Create screenLockActions.ts with PIN verification actions**

```typescript
// packages/backend/convex/screenLockActions.ts
"use node";

import bcrypt from "bcryptjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const screenUnlock = action({
  args: {
    userId: v.id("users"),
    pin: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );
    if (!currentUserId) {
      return { success: false as const, error: "Authentication required" };
    }

    const userPin = await ctx.runQuery(
      internal.helpers.usersHelpers.getUserPinInternal,
      { userId: args.userId },
    );
    if (!userPin) {
      return { success: false as const, error: "PIN not set" };
    }

    const isValid = await bcrypt.compare(args.pin, userPin);
    if (!isValid) {
      return { success: false as const, error: "Invalid PIN" };
    }

    // Atomic: PIN verified → create audit log
    await ctx.runMutation(internal.screenLock.logScreenUnlock, {
      storeId: args.storeId,
      userId: args.userId,
    });

    return { success: true as const };
  },
});

export const screenUnlockOverride = action({
  args: {
    lockedUserId: v.id("users"),
    managerId: v.id("users"),
    managerPin: v.string(),
    storeId: v.id("stores"),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );
    if (!currentUserId) {
      return { success: false as const, error: "Authentication required" };
    }

    const managerPin = await ctx.runQuery(
      internal.helpers.usersHelpers.getUserPinInternal,
      { userId: args.managerId },
    );
    if (!managerPin) {
      return { success: false as const, error: "Manager PIN not set" };
    }

    const isValid = await bcrypt.compare(args.managerPin, managerPin);
    if (!isValid) {
      return { success: false as const, error: "Invalid manager PIN" };
    }

    // Atomic: PIN verified → create audit log
    await ctx.runMutation(internal.screenLock.logScreenUnlockOverride, {
      storeId: args.storeId,
      lockedUserId: args.lockedUserId,
      managerId: args.managerId,
    });

    return { success: true as const };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/convex/screenLockActions.ts
git commit -m "feat(backend): add screen unlock actions with PIN verification"
```

### Task 3: Write backend tests

**Files:**
- Create: `packages/backend/convex/screenLock.test.ts`

- [ ] **Step 1: Create tests for queries and data logic**

```typescript
// packages/backend/convex/screenLock.test.ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupTestData(t: ReturnType<typeof convexTest>) {
  const storeId = await t.run(async (ctx) => {
    return await ctx.db.insert("stores", {
      name: "Test Store",
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: "MIN-000001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
    });
  });

  const roleId = await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: "Manager",
      permissions: ["system.settings", "discounts.approve"],
      scopeLevel: "branch",
      isSystem: false,
    });
  });

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Test Cashier",
      email: "cashier@test.com",
      roleId,
      storeId,
      isActive: true,
      pin: "$2a$10$hashedpin", // Simulated bcrypt hash
    });
  });

  return { storeId, roleId, userId };
}

describe("getAutoLockTimeout", () => {
  it("returns default 5 when no setting exists", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await setupTestData(t);

    const timeout = await t.run(async (ctx) => {
      const setting = await ctx.db
        .query("settings")
        .withIndex("by_store_key", (q) =>
          q.eq("storeId", storeId).eq("key", "autoLockTimeout"),
        )
        .unique();
      if (!setting) return 5;
      return Number.parseInt(setting.value, 10);
    });

    expect(timeout).toBe(5);
  });

  it("returns stored value when setting exists", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        storeId,
        key: "autoLockTimeout",
        value: "10",
        updatedAt: Date.now(),
        updatedBy: userId,
      });
    });

    const timeout = await t.run(async (ctx) => {
      const setting = await ctx.db
        .query("settings")
        .withIndex("by_store_key", (q) =>
          q.eq("storeId", storeId).eq("key", "autoLockTimeout"),
        )
        .unique();
      if (!setting) return 5;
      return Number.parseInt(setting.value, 10);
    });

    expect(timeout).toBe(10);
  });

  it("returns 5 for non-numeric stored value", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        storeId,
        key: "autoLockTimeout",
        value: "invalid",
        updatedAt: Date.now(),
        updatedBy: userId,
      });
    });

    const timeout = await t.run(async (ctx) => {
      const setting = await ctx.db
        .query("settings")
        .withIndex("by_store_key", (q) =>
          q.eq("storeId", storeId).eq("key", "autoLockTimeout"),
        )
        .unique();
      if (!setting) return 5;
      const value = Number.parseInt(setting.value, 10);
      return Number.isNaN(value) ? 5 : value;
    });

    expect(timeout).toBe(5);
  });
});

describe("getUserHasPin", () => {
  it("returns true when user has a PIN", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupTestData(t);

    const hasPin = await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      return !!user?.pin;
    });

    expect(hasPin).toBe(true);
  });

  it("returns false when user has no PIN", async () => {
    const t = convexTest(schema, modules);
    const { storeId, roleId } = await setupTestData(t);

    const noPinUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "No PIN User",
        email: "nopin@test.com",
        roleId,
        storeId,
        isActive: true,
      });
    });

    const hasPin = await t.run(async (ctx) => {
      const user = await ctx.db.get(noPinUserId);
      return !!user?.pin;
    });

    expect(hasPin).toBe(false);
  });
});

describe("screenLock audit logging", () => {
  it("creates correct audit log entry for manual lock", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId } = await setupTestData(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("auditLogs", {
        storeId,
        action: "screen_locked",
        entityType: "screen_lock",
        entityId: userId,
        details: JSON.stringify({ trigger: "manual", userId }),
        userId,
        createdAt: Date.now(),
      });
    });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_store", (q) => q.eq("storeId", storeId))
        .collect();
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("screen_locked");
    expect(logs[0].entityType).toBe("screen_lock");
    const details = JSON.parse(logs[0].details);
    expect(details.trigger).toBe("manual");
  });

  it("creates correct audit log entry for screen unlock override", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, roleId } = await setupTestData(t);

    const managerId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Manager",
        email: "manager@test.com",
        roleId,
        storeId,
        isActive: true,
        pin: "$2a$10$managerhashedpin",
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("auditLogs", {
        storeId,
        action: "screen_unlock_override",
        entityType: "screen_lock",
        entityId: userId,
        details: JSON.stringify({
          lockedUserId: userId,
          overrideManagerId: managerId,
          method: "manager_pin",
        }),
        userId: managerId,
        createdAt: Date.now(),
      });
    });

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_store", (q) => q.eq("storeId", storeId))
        .collect();
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("screen_unlock_override");
    const details = JSON.parse(logs[0].details);
    expect(details.overrideManagerId).toBe(managerId);
    expect(details.lockedUserId).toBe(userId);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/backend && pnpm vitest run screenLock.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/screenLock.test.ts
git commit -m "test(backend): add screen lock backend tests"
```

---

## Chunk 2: Native App — Lock Store & Idle Timer

### Task 4: Create useLockStore (Zustand + AsyncStorage)

**Files:**
- Create: `apps/native/src/features/lock/stores/useLockStore.ts`

- [ ] **Step 1: Create the lock feature directory structure**

```bash
mkdir -p apps/native/src/features/lock/stores
mkdir -p apps/native/src/features/lock/hooks
mkdir -p apps/native/src/features/lock/screens
mkdir -p apps/native/src/features/lock/components
```

- [ ] **Step 2: Create useLockStore**

```typescript
// apps/native/src/features/lock/stores/useLockStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const MAX_FAILED_ATTEMPTS = 5;
const COOLDOWN_DURATION_MS = 30_000; // 30 seconds

interface LockState {
  isLocked: boolean;
  lockedAt: number | null;
  lockedUserId: string | null;
  lockedUserName: string | null;
  lockedUserRole: string | null;
  showIdleWarning: boolean;
  warningStartedAt: number | null;
  failedAttempts: number;
  cooldownUntil: number | null;
}

interface LockActions {
  lock: (user: {
    userId: string;
    userName: string;
    userRole: string;
  }) => void;
  unlock: () => void;
  setShowIdleWarning: (show: boolean) => void;
  recordFailedAttempt: () => boolean; // returns true if cooldown triggered
  resetFailedAttempts: () => void;
  isCoolingDown: () => boolean;
}

export const useLockStore = create<LockState & LockActions>()(
  persist(
    (set, get) => ({
      // State
      isLocked: false,
      lockedAt: null,
      lockedUserId: null,
      lockedUserName: null,
      lockedUserRole: null,
      showIdleWarning: false,
      warningStartedAt: null,
      failedAttempts: 0,
      cooldownUntil: null,

      // Actions
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

      resetFailedAttempts: () =>
        set({ failedAttempts: 0, cooldownUntil: null }),

      isCoolingDown: () => {
        const { cooldownUntil } = get();
        if (!cooldownUntil) return false;
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
      }),
    },
  ),
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/lock/stores/useLockStore.ts
git commit -m "feat(native): add useLockStore with AsyncStorage persistence"
```

### Task 5: Create useIdleTimer hook

**Files:**
- Create: `apps/native/src/features/lock/hooks/useIdleTimer.ts`

- [ ] **Step 1: Create the useIdleTimer hook**

Key design notes:
- Uses `useMutation` (not `useAction`) for `screenLock` — it's a mutation in `screenLock.ts`
- Calls the backend `screenLock` mutation in `triggerLock` for audit logging
- Checks if user has PIN before locking — if no PIN, skips lock (user is prompted via settings)
- Suppresses on `CheckoutScreen`

```typescript
// apps/native/src/features/lock/hooks/useIdleTimer.ts
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "../../auth/context";
import { useLockStore } from "../stores/useLockStore";

const WARNING_BEFORE_LOCK_MS = 30_000; // 30 seconds before lock

export function useIdleTimer() {
  const { user } = useAuth();
  const isLocked = useLockStore((s) => s.isLocked);
  const lock = useLockStore((s) => s.lock);
  const setShowIdleWarning = useLockStore((s) => s.setShowIdleWarning);
  const screenLockMutation = useMutation(api.screenLock.screenLock);

  const storeId = user?.storeId;
  const timeoutMinutes = useQuery(
    api.screenLock.getAutoLockTimeout,
    storeId ? { storeId } : "skip",
  );

  // Check if user has a PIN (needed to determine if we should lock)
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
    timeoutMinutes && timeoutMinutes > 0
      ? timeoutMinutes * 60 * 1000
      : null;

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
      if (!user || isLocked) return;

      // Don't lock if user has no PIN — they'd be stuck
      if (!userHasPin) return;

      setShowIdleWarning(false);
      lock({
        userId: user._id,
        userName: user.name ?? "User",
        userRole: user.role?.name ?? "Staff",
      });

      // Fire audit log (non-blocking)
      if (storeId) {
        screenLockMutation({ storeId, trigger }).catch(() => {});
      }
    },
    [user, isLocked, userHasPin, lock, setShowIdleWarning, screenLockMutation, storeId],
  );

  const startTimers = useCallback(() => {
    clearTimers();
    if (!timeoutMs || isLocked || !userHasPin) return;
    if (currentRouteRef.current === "CheckoutScreen") return;

    const warningDelay = timeoutMs - WARNING_BEFORE_LOCK_MS;

    if (warningDelay > 0) {
      warningTimerRef.current = setTimeout(() => {
        setShowIdleWarning(true);
      }, warningDelay);
    }

    lockTimerRef.current = setTimeout(() => {
      triggerLock("idle_timeout");
    }, timeoutMs);
  }, [timeoutMs, isLocked, userHasPin, clearTimers, setShowIdleWarning, triggerLock]);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowIdleWarning(false);
    startTimers();
  }, [setShowIdleWarning, startTimers]);

  // AppState monitoring
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        backgroundTimestampRef.current = Date.now();
        clearTimers();
      } else if (state === "active") {
        const bgTime = backgroundTimestampRef.current;
        backgroundTimestampRef.current = null;

        if (bgTime && timeoutMs && !isLocked && userHasPin) {
          const elapsed = Date.now() - lastActivityRef.current;
          if (elapsed >= timeoutMs) {
            triggerLock("idle_timeout");
          } else {
            startTimers();
          }
        }
      }
    });
    return () => sub.remove();
  }, [timeoutMs, isLocked, userHasPin, clearTimers, startTimers, triggerLock]);

  // Start timers when timeout/lock/pin state changes
  useEffect(() => {
    if (!isLocked && timeoutMs && userHasPin) {
      startTimers();
    }
    return clearTimers;
  }, [isLocked, timeoutMs, userHasPin, startTimers, clearTimers]);

  return {
    resetActivity,
    setCurrentRoute: (route: string | null) => {
      currentRouteRef.current = route;
      if (route === "CheckoutScreen") {
        clearTimers();
      } else if (!isLocked && timeoutMs && userHasPin) {
        startTimers();
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/features/lock/hooks/useIdleTimer.ts
git commit -m "feat(native): add useIdleTimer hook with AppState, PIN check, and checkout suppression"
```

---

## Chunk 3: Native App — Lock Screen UI Components

### Task 6: Create NumericPinPad component

**Files:**
- Create: `apps/native/src/features/lock/components/NumericPinPad.tsx`

- [ ] **Step 1: Create the NumericPinPad component**

```typescript
// apps/native/src/features/lock/components/NumericPinPad.tsx
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface NumericPinPadProps {
  pin: string;
  maxLength?: number;
  onPinChange: (pin: string) => void;
  disabled?: boolean;
}

export const NumericPinPad = ({
  pin,
  maxLength = 6,
  onPinChange,
  disabled = false,
}: NumericPinPadProps) => {
  const handlePress = (digit: string) => {
    if (disabled || pin.length >= maxLength) return;
    onPinChange(pin + digit);
  };

  const handleBackspace = () => {
    if (disabled || pin.length === 0) return;
    onPinChange(pin.slice(0, -1));
  };

  const renderKey = (value: string | "backspace" | "empty", key: string) => {
    if (value === "empty") {
      return <View key={key} style={{ width: 64, height: 56 }} />;
    }

    if (value === "backspace") {
      return (
        <TouchableOpacity
          key={key}
          onPress={handleBackspace}
          disabled={disabled}
          style={{
            width: 64,
            height: 56,
            borderRadius: 12,
            backgroundColor: "#FEE2E2",
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Ionicons name="backspace-outline" size={22} color="#EF4444" />
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        key={key}
        onPress={() => handlePress(value)}
        disabled={disabled}
        style={{
          width: 64,
          height: 56,
          borderRadius: 12,
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: "#E5E7EB",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "500", color: "#111827" }}>
          {value}
        </Text>
      </TouchableOpacity>
    );
  };

  const keys: (string | "backspace" | "empty")[][] = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["empty", "0", "backspace"],
  ];

  return (
    <YStack alignItems="center" gap={10}>
      {/* PIN dots */}
      <XStack gap={12} marginBottom={24}>
        {Array.from({ length: maxLength }).map((_, i) => (
          <View
            key={`dot-${i}`}
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: i < pin.length ? "#0D87E1" : "transparent",
              borderWidth: i < pin.length ? 0 : 2,
              borderColor: "#D1D5DB",
            }}
          />
        ))}
      </XStack>

      {/* Keypad */}
      {keys.map((row, rowIndex) => (
        <XStack key={`row-${rowIndex}`} gap={10}>
          {row.map((value, colIndex) =>
            renderKey(value, `key-${rowIndex}-${colIndex}`),
          )}
        </XStack>
      ))}
    </YStack>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/features/lock/components/NumericPinPad.tsx
git commit -m "feat(native): add NumericPinPad component"
```

### Task 7: Create IdleWarningBanner component

**Files:**
- Create: `apps/native/src/features/lock/components/IdleWarningBanner.tsx`

- [ ] **Step 1: Create the IdleWarningBanner component**

Note: Uses `lockTime` timestamp (when the lock will happen) to compute a synchronized countdown, rather than a local decrementing counter.

```typescript
// apps/native/src/features/lock/components/IdleWarningBanner.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface IdleWarningBannerProps {
  visible: boolean;
  onDismiss: () => void;
  lockTime: number; // Timestamp when lock will happen
}

export const IdleWarningBanner = ({
  visible,
  onDismiss,
  lockTime,
}: IdleWarningBannerProps) => {
  const [seconds, setSeconds] = useState(30);

  useEffect(() => {
    if (!visible) return;

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((lockTime - Date.now()) / 1000));
      setSeconds(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [visible, lockTime]);

  if (!visible) return null;

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <YStack
        backgroundColor="#FEF3C7"
        borderWidth={2}
        borderColor="#F59E0B"
        borderRadius={16}
        padding={24}
        alignItems="center"
        width="85%"
        style={{ elevation: 8 }}
      >
        <YStack
          width={48}
          height={48}
          borderRadius={24}
          backgroundColor="#FDE68A"
          alignItems="center"
          justifyContent="center"
          marginBottom={12}
        >
          <Ionicons name="alert-circle-outline" size={24} color="#D97706" />
        </YStack>

        <Text
          style={{
            fontSize: 18,
            fontWeight: "700",
            color: "#92400E",
            marginBottom: 4,
          }}
        >
          Screen will lock in {seconds}s
        </Text>

        <Text
          style={{
            fontSize: 13,
            color: "#A16207",
            marginBottom: 16,
          }}
        >
          Tap anywhere to stay active
        </Text>

        <Pressable
          onPress={onDismiss}
          style={{
            backgroundColor: "#F59E0B",
            borderRadius: 10,
            paddingVertical: 12,
            paddingHorizontal: 32,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 15 }}>
            Stay Active
          </Text>
        </Pressable>
      </YStack>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/features/lock/components/IdleWarningBanner.tsx
git commit -m "feat(native): add IdleWarningBanner component with synchronized countdown"
```

### Task 8: Create ManagerOverrideModal component

**Files:**
- Create: `apps/native/src/features/lock/components/ManagerOverrideModal.tsx`

- [ ] **Step 1: Create the ManagerOverrideModal**

This is a custom modal that does NOT verify the PIN itself — it collects the manager selection and PIN, then delegates to the caller. This avoids the double-verification issue with `ManagerPinModal` (which internally verifies via `users.verifyPin`).

```typescript
// apps/native/src/features/lock/components/ManagerOverrideModal.tsx
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import React, { useCallback, useState } from "react";
import { ScrollView, TextInput as RNTextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { Button, Modal, Text } from "../../shared/components/ui";

interface ManagerOverrideModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (managerId: Id<"users">, pin: string) => void;
  isVerifying?: boolean;
}

export const ManagerOverrideModal = ({
  visible,
  onClose,
  onSubmit,
  isVerifying = false,
}: ManagerOverrideModalProps) => {
  const { user } = useAuth();
  const [selectedManagerId, setSelectedManagerId] = useState<Id<"users"> | null>(null);
  const [pin, setPin] = useState("");

  const managers = useQuery(
    api.helpers.usersHelpers.listManagers,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const handleClose = useCallback(() => {
    setSelectedManagerId(null);
    setPin("");
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    if (!selectedManagerId || !pin) return;
    onSubmit(selectedManagerId, pin);
    setPin("");
    setSelectedManagerId(null);
  }, [selectedManagerId, pin, onSubmit]);

  return (
    <Modal
      visible={visible}
      title="Manager Override"
      onClose={handleClose}
      onRequestClose={handleClose}
      position="center"
    >
      <YStack padding={20} gap={16}>
        <Text style={{ fontSize: 14, color: "#6B7280" }}>
          A manager can unlock this screen with their PIN
        </Text>

        {/* Manager selection */}
        <YStack gap={8}>
          <Text style={{ fontSize: 14, fontWeight: "600" }}>Select Manager</Text>
          <ScrollView style={{ maxHeight: 200 }}>
            {managers?.map((manager) => (
              <TouchableOpacity
                key={manager._id}
                onPress={() => setSelectedManagerId(manager._id)}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 10,
                  backgroundColor:
                    selectedManagerId === manager._id ? "#DBEAFE" : "#F9FAFB",
                  borderWidth: 1,
                  borderColor:
                    selectedManagerId === manager._id ? "#0D87E1" : "#E5E7EB",
                  marginBottom: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <YStack>
                  <Text style={{ fontSize: 15, fontWeight: "600" }}>
                    {manager.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: "#6B7280" }}>
                    {manager.roleName}
                  </Text>
                </YStack>
                {selectedManagerId === manager._id && (
                  <Ionicons name="checkmark-circle" size={20} color="#0D87E1" />
                )}
              </TouchableOpacity>
            ))}
            {managers?.length === 0 && (
              <Text style={{ fontSize: 14, color: "#6B7280", textAlign: "center", padding: 20 }}>
                No managers with PINs available. Contact your administrator.
              </Text>
            )}
          </ScrollView>
        </YStack>

        {/* PIN input */}
        {selectedManagerId && (
          <YStack gap={8}>
            <Text style={{ fontSize: 14, fontWeight: "600" }}>Enter PIN</Text>
            <RNTextInput
              value={pin}
              onChangeText={setPin}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              placeholder="Enter manager PIN"
              style={{
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 10,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16,
                backgroundColor: "#F9FAFB",
              }}
            />
          </YStack>
        )}

        {/* Submit button */}
        <Button
          variant="primary"
          size="lg"
          onPress={handleSubmit}
          disabled={!selectedManagerId || !pin || isVerifying}
        >
          {isVerifying ? "Verifying..." : "Unlock"}
        </Button>
      </YStack>
    </Modal>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/features/lock/components/ManagerOverrideModal.tsx
git commit -m "feat(native): add ManagerOverrideModal for lock screen"
```

### Task 9: Create LockScreen

**Files:**
- Create: `apps/native/src/features/lock/screens/LockScreen.tsx`
- Create: `apps/native/src/features/lock/index.ts`

- [ ] **Step 1: Create the LockScreen**

Key notes:
- Uses `useRef(new Animated.Value(0)).current` for shake animation (not `useAnimatedValue`)
- Uses unicode `\u2022` for bullet character (not HTML `&bull;`)
- Uses `ManagerOverrideModal` (not `ManagerPinModal`) to avoid double verification
- Has explicit "Unlock" button (no auto-submit on PIN length)

```typescript
// apps/native/src/features/lock/screens/LockScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction } from "convex/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, TouchableOpacity } from "react-native";
import { YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { Text } from "../../shared/components/ui";
import { ManagerOverrideModal } from "../components/ManagerOverrideModal";
import { NumericPinPad } from "../components/NumericPinPad";
import { useLockStore } from "../stores/useLockStore";

interface LockScreenProps {
  navigation: any;
}

export const LockScreen = ({ navigation }: LockScreenProps) => {
  const { user } = useAuth();
  const lockedUserName = useLockStore((s) => s.lockedUserName);
  const lockedUserRole = useLockStore((s) => s.lockedUserRole);
  const lockedAt = useLockStore((s) => s.lockedAt);
  const lockedUserId = useLockStore((s) => s.lockedUserId);
  const unlock = useLockStore((s) => s.unlock);
  const recordFailedAttempt = useLockStore((s) => s.recordFailedAttempt);
  const isCoolingDown = useLockStore((s) => s.isCoolingDown);
  const cooldownUntil = useLockStore((s) => s.cooldownUntil);

  const [pin, setPin] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isOverrideVerifying, setIsOverrideVerifying] = useState(false);
  const [showManagerModal, setShowManagerModal] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const screenUnlock = useAction(api.screenLockActions.screenUnlock);
  const screenUnlockOverride = useAction(api.screenLockActions.screenUnlockOverride);

  // Update clock every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Cooldown countdown
  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownSeconds(0);
      return;
    }

    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining <= 0) {
        useLockStore.getState().resetFailedAttempts();
      }
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const shakePin = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handleUnlock = useCallback(async () => {
    if (!pin || !lockedUserId || !user?.storeId || isVerifying) return;
    if (isCoolingDown()) return;

    setIsVerifying(true);
    try {
      const result = await screenUnlock({
        userId: lockedUserId as Id<"users">,
        pin,
        storeId: user.storeId,
      });

      if (result.success) {
        unlock();
        navigation.goBack();
      } else {
        shakePin();
        setPin("");
        const cooled = recordFailedAttempt();
        if (cooled) {
          Alert.alert("Too Many Attempts", "Please wait 30 seconds before trying again.");
        }
      }
    } catch {
      Alert.alert("Error", "Failed to verify PIN. Please try again.");
      setPin("");
    } finally {
      setIsVerifying(false);
    }
  }, [pin, lockedUserId, user?.storeId, isVerifying, screenUnlock, unlock, navigation, shakePin, recordFailedAttempt, isCoolingDown]);

  const handleManagerOverride = useCallback(
    async (managerId: Id<"users">, managerPin: string) => {
      if (!lockedUserId || !user?.storeId) return;

      setIsOverrideVerifying(true);
      try {
        const result = await screenUnlockOverride({
          lockedUserId: lockedUserId as Id<"users">,
          managerId,
          managerPin,
          storeId: user.storeId,
        });

        if (result.success) {
          setShowManagerModal(false);
          unlock();
          navigation.goBack();
        } else {
          Alert.alert("Invalid PIN", result.error || "Manager PIN is incorrect");
        }
      } catch {
        Alert.alert("Error", "Failed to verify manager PIN.");
      } finally {
        setIsOverrideVerifying(false);
      }
    },
    [lockedUserId, user?.storeId, screenUnlockOverride, unlock, navigation],
  );

  const lockedSince = lockedAt
    ? new Date(lockedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  const timeString = currentTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateString = currentTime.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const cooling = isCoolingDown();

  return (
    <YStack flex={1} backgroundColor="#F9FAFB" alignItems="center" justifyContent="center" paddingHorizontal={20}>
      {/* Clock */}
      <Text style={{ fontSize: 48, fontWeight: "700", color: "#111827", letterSpacing: -1 }}>
        {timeString}
      </Text>
      <Text style={{ fontSize: 14, color: "#6B7280", marginTop: 4 }}>{dateString}</Text>

      {/* Lock icon */}
      <YStack
        width={64}
        height={64}
        borderRadius={32}
        backgroundColor="#DBEAFE"
        alignItems="center"
        justifyContent="center"
        marginTop={32}
        marginBottom={16}
      >
        <Ionicons name="lock-closed" size={28} color="#0D87E1" />
      </YStack>

      {/* User info */}
      <Text style={{ fontSize: 18, fontWeight: "600", color: "#111827" }}>
        {lockedUserName ?? "User"}
      </Text>
      <Text style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>
        {lockedUserRole ?? "Staff"} {"\u2022"} Locked since {lockedSince}
      </Text>

      {/* PIN pad with shake animation */}
      <Animated.View style={{ marginTop: 24, transform: [{ translateX: shakeAnim }] }}>
        <NumericPinPad pin={pin} onPinChange={setPin} disabled={isVerifying || cooling} />
      </Animated.View>

      {/* Cooldown message */}
      {cooling && cooldownSeconds > 0 && (
        <Text style={{ fontSize: 14, color: "#EF4444", fontWeight: "600", marginTop: 12 }}>
          Try again in {cooldownSeconds}s
        </Text>
      )}

      {/* Unlock button */}
      <TouchableOpacity
        onPress={handleUnlock}
        disabled={!pin || isVerifying || cooling}
        style={{
          marginTop: 20,
          backgroundColor: !pin || isVerifying || cooling ? "#9CA3AF" : "#0D87E1",
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 48,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 16 }}>
          {isVerifying ? "Verifying..." : "Unlock"}
        </Text>
      </TouchableOpacity>

      {/* Manager override */}
      <TouchableOpacity onPress={() => setShowManagerModal(true)} style={{ marginTop: 16 }}>
        <Text style={{ fontSize: 13, color: "#0D87E1" }}>Manager Override</Text>
      </TouchableOpacity>

      {/* Manager Override Modal */}
      <ManagerOverrideModal
        visible={showManagerModal}
        onClose={() => setShowManagerModal(false)}
        onSubmit={handleManagerOverride}
        isVerifying={isOverrideVerifying}
      />
    </YStack>
  );
};
```

- [ ] **Step 2: Create barrel export**

```typescript
// apps/native/src/features/lock/index.ts
export { LockScreen } from "./screens/LockScreen";
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/lock/
git commit -m "feat(native): add LockScreen with PIN pad, manager override, and cooldown"
```

---

## Chunk 4: Native App — Integration (Navigation, Header, App.tsx, Settings)

### Task 10: Add LockScreen to navigation and auto-navigate on lock

**Files:**
- Modify: `apps/native/src/navigation/Navigation.tsx`

- [ ] **Step 1: Add LockScreen to RootStackParamList and Stack.Navigator**

In `apps/native/src/navigation/Navigation.tsx`:

1. Add import at top:

```typescript
import { LockScreen } from "../features/lock";
import { useLockStore } from "../features/lock/stores/useLockStore";
```

2. Add to `RootStackParamList` type (after `DayClosingScreen`):

```typescript
LockScreen: undefined;
```

3. Add `<Stack.Screen>` after `DayClosingScreen` entry:

```typescript
<Stack.Screen
  name="LockScreen"
  component={LockScreen}
  options={{ gestureEnabled: false, animation: "fade" }}
/>
```

4. Add lock state listener inside the `Navigation` component, after existing `useEffect` hooks:

```typescript
const isLocked = useLockStore((s) => s.isLocked);

// Navigate to LockScreen when locked (triggered by idle timer)
useEffect(() => {
  if (isLocked && isAuthenticated && navigationRef.current) {
    const currentRoute = navigationRef.current.getCurrentRoute();
    if (currentRoute?.name !== "LockScreen") {
      navigationRef.current.navigate("LockScreen");
    }
  }
}, [isLocked, isAuthenticated]);
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/navigation/Navigation.tsx
git commit -m "feat(native): register LockScreen in navigation and auto-navigate on lock"
```

### Task 11: Add lock button to HomeHeader

**Files:**
- Modify: `apps/native/src/features/home/components/HomeHeader.tsx`
- Modify: `apps/native/src/features/home/screens/HomeScreen.tsx`

- [ ] **Step 1: Add onLock prop and lock button to HomeHeader**

In `apps/native/src/features/home/components/HomeHeader.tsx`:

1. Add to `HomeHeaderProps` interface:

```typescript
onLock?: () => void;
showLockButton?: boolean;
```

2. Add destructured props:

```typescript
export const HomeHeader = ({
  userName,
  roleName,
  onLogout,
  onLock,
  showLockButton,
  onSettings,
  onOrderHistory,
  onDayClosing,
}: HomeHeaderProps) => {
```

3. Add lock button in the `XStack gap={6}` row, before the logout button (before line 95):

```typescript
{showLockButton && onLock && (
  <IconButton icon="lock-closed-outline" onPress={onLock} />
)}
```

- [ ] **Step 2: Pass onLock from HomeScreen**

In `apps/native/src/features/home/screens/HomeScreen.tsx`:

1. Add imports:

```typescript
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useLockStore } from "../../lock/stores/useLockStore";
```

2. Add in component body (after other hooks):

```typescript
const lockScreen = useLockStore((s) => s.lock);
const screenLockMutation = useMutation(api.screenLock.screenLock);

// Check if current user has a PIN set
const userHasPin = useQuery(
  api.screenLock.getUserHasPin,
  user?._id ? { userId: user._id } : "skip",
);

const handleLock = useCallback(async () => {
  if (!user?._id || !user?.storeId) return;

  if (!userHasPin) {
    Alert.alert(
      "PIN Required",
      "You need to set a PIN before you can lock the screen. Go to Settings to set one.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Go to Settings", onPress: () => navigation.navigate("SettingsScreen") },
      ],
    );
    return;
  }

  lockScreen({
    userId: user._id,
    userName: user.name ?? "User",
    userRole: user.role?.name ?? "Staff",
  });
  // Fire audit log (non-blocking)
  screenLockMutation({ storeId: user.storeId, trigger: "manual" }).catch(() => {});
  navigation.navigate("LockScreen");
}, [user, userHasPin, lockScreen, screenLockMutation, navigation]);
```

3. Update HomeHeader usage:

```tsx
<HomeHeader
  userName={user?.name ?? "User"}
  roleName={user?.role?.name}
  onLogout={handleLogout}
  onLock={handleLock}
  showLockButton={!!userHasPin}
  onSettings={() => navigation.navigate("SettingsScreen")}
  onOrderHistory={() => navigation.navigate("OrderHistoryScreen")}
  onDayClosing={...}
/>
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/home/components/HomeHeader.tsx apps/native/src/features/home/screens/HomeScreen.tsx
git commit -m "feat(native): add lock button to HomeScreen header with PIN check"
```

### Task 12: Integrate idle timer and lock-on-launch in App.tsx

**Files:**
- Modify: `apps/native/App.tsx`

- [ ] **Step 1: Add idle timer wrapper and lock-on-launch logic**

In `apps/native/App.tsx`, modify the `AppContent` component:

1. Add imports:

```typescript
import { useIdleTimer } from "./src/features/lock/hooks/useIdleTimer";
import { useLockStore } from "./src/features/lock/stores/useLockStore";
import { IdleWarningBanner } from "./src/features/lock/components/IdleWarningBanner";
```

2. Inside `AppContent`, add after existing hooks:

```typescript
const showIdleWarning = useLockStore((s) => s.showIdleWarning);
const warningStartedAt = useLockStore((s) => s.warningStartedAt);
const { resetActivity } = useIdleTimer();

// Wait for lock store to hydrate from AsyncStorage
const [storeHydrated, setStoreHydrated] = useState(false);

useEffect(() => {
  if (useLockStore.persist.hasHydrated()) {
    setStoreHydrated(true);
  }
  const unsub = useLockStore.persist.onFinishHydration(() => {
    setStoreHydrated(true);
  });
  return unsub;
}, []);
```

3. Modify the initial route resolution to account for lock state and hydration:

```typescript
if (!isLoading && storeHydrated && resolvedRoute.current === null) {
  if (isAuthenticated) {
    const locked = useLockStore.getState().isLocked;
    resolvedRoute.current = locked ? "LockScreen" : "HomeScreen";
  } else {
    resolvedRoute.current = "LoginScreen";
  }
}
```

4. Update splash dismiss condition:

```typescript
useEffect(() => {
  if (animationDone && !isLoading && storeHydrated) {
    setShowSplash(false);
  }
}, [animationDone, isLoading, storeHydrated]);
```

5. Wrap the `Navigation` component with a `View` for touch detection:

Replace the `<>` fragment wrapping `Navigation` with:

```tsx
<View
  style={{ flex: 1 }}
  onStartShouldSetResponderCapture={() => {
    resetActivity();
    return false; // Don't steal the touch
  }}
>
  <Navigation initialRoute={resolvedRoute.current ?? "LoginScreen"} />
  {showIdleWarning && warningStartedAt && (
    <IdleWarningBanner
      visible={true}
      onDismiss={resetActivity}
      lockTime={warningStartedAt + 30_000}
    />
  )}
</View>
```

Note: Keep the `StatusBar` `View` wrapper outside this touch-detection `View`.

- [ ] **Step 2: Commit**

```bash
git add apps/native/App.tsx
git commit -m "feat(native): integrate idle timer, lock-on-launch, and warning banner in App.tsx"
```

### Task 13: Add auto-lock timeout setting to SettingsScreen

**Files:**
- Modify: `apps/native/src/features/settings/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add auto-lock timeout picker to settings**

In `apps/native/src/features/settings/screens/SettingsScreen.tsx`:

1. Add imports:

```typescript
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Modal as RNModal, Pressable, View } from "react-native";
import { useAuth } from "../../auth/context";
```

2. Add in component body after existing hooks:

```typescript
const { user } = useAuth();
const storeId = user?.storeId;

const autoLockTimeout = useQuery(
  api.screenLock.getAutoLockTimeout,
  storeId ? { storeId } : "skip",
);
const setAutoLockTimeoutMutation = useMutation(api.screenLock.setAutoLockTimeout);
const [showTimeoutPicker, setShowTimeoutPicker] = useState(false);

const timeoutOptions = [
  { label: "Disabled", value: 0 },
  { label: "1 minute", value: 1 },
  { label: "2 minutes", value: 2 },
  { label: "5 minutes", value: 5 },
  { label: "10 minutes", value: 10 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
];

const currentLabel =
  timeoutOptions.find((o) => o.value === autoLockTimeout)?.label ?? "5 minutes";

const handleSetTimeout = async (minutes: number) => {
  if (!storeId) return;
  await setAutoLockTimeoutMutation({ storeId, minutes });
  setShowTimeoutPicker(false);
};
```

3. Add a new setting row inside `<ScrollView>`, after the "Check for Updates" TouchableOpacity:

```tsx
{/* Auto-Lock Timeout */}
<TouchableOpacity
  style={{
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  }}
  onPress={() => setShowTimeoutPicker(true)}
>
  <YStack
    width={40}
    height={40}
    borderRadius={20}
    backgroundColor="#FEF3C7"
    alignItems="center"
    justifyContent="center"
  >
    <Ionicons name="timer-outline" size={20} color="#D97706" />
  </YStack>
  <YStack flex={1} marginLeft={12}>
    <Text style={{ fontSize: 16, fontWeight: "600" }}>Auto-Lock After</Text>
    <Text style={{ fontSize: 14, color: "#6B7280" }}>{currentLabel}</Text>
  </YStack>
  <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
</TouchableOpacity>
```

4. Add the picker modal before the closing `</YStack>` of the component:

```tsx
{/* Timeout Picker Modal */}
<RNModal visible={showTimeoutPicker} transparent animationType="fade" onRequestClose={() => setShowTimeoutPicker(false)}>
  <Pressable
    style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" }}
    onPress={() => setShowTimeoutPicker(false)}
  >
    <View style={{ backgroundColor: "#FFFFFF", borderRadius: 16, width: "80%", maxHeight: "60%", overflow: "hidden" }}>
      <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>Auto-Lock After</Text>
      </View>
      <ScrollView>
        {timeoutOptions.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: autoLockTimeout === option.value ? "#EFF6FF" : "#FFFFFF",
              borderBottomWidth: 1,
              borderBottomColor: "#F3F4F6",
            }}
            onPress={() => handleSetTimeout(option.value)}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: autoLockTimeout === option.value ? "600" : "400",
                color: autoLockTimeout === option.value ? "#0D87E1" : "#111827",
              }}
            >
              {option.label}
            </Text>
            {autoLockTimeout === option.value && (
              <Ionicons name="checkmark" size={20} color="#0D87E1" />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  </Pressable>
</RNModal>
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/features/settings/screens/SettingsScreen.tsx
git commit -m "feat(native): add auto-lock timeout setting with picker modal"
```

### Task 14: Final verification

- [ ] **Step 1: Run backend tests**

```bash
cd packages/backend && pnpm vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: No type errors. Fix any that appear.

- [ ] **Step 3: Run lint**

```bash
pnpm check
```

Expected: No lint/format errors. Fix any that appear.

- [ ] **Step 4: Manual testing checklist**

Test on the native app:

1. **Manual lock:** Tap lock icon on HomeScreen header → LockScreen appears → Enter correct PIN → Returns to HomeScreen
2. **Lock button visibility:** User without PIN → lock button is hidden. User with PIN → lock button visible.
3. **No PIN prompt:** If somehow auto-lock fires for user without PIN → nothing happens (idle timer skips).
4. **Wrong PIN:** Enter wrong PIN 5 times → Cooldown message "Try again in 30s" → Wait 30s → Can try again
5. **Manager override:** On LockScreen → Tap "Manager Override" → Select manager → Enter manager PIN → Unlocks (single verification, not double)
6. **Idle warning:** Set auto-lock to 1 min → Wait ~30s → Warning banner appears with countdown → Tap "Stay Active" → Warning dismisses, timer resets
7. **Idle lock:** Set auto-lock to 1 min → Wait full minute without touching → Screen locks automatically
8. **Background lock:** Set auto-lock to 1 min → Background app for > 1 min → Return → Screen is locked
9. **Persist on kill:** Lock screen → Force kill app → Reopen → Lock screen appears after splash
10. **Checkout suppression:** Start checkout flow → Wait past timeout → Screen should NOT lock
11. **Settings:** Settings → Auto-Lock After → Change to different value → Verify it persists across app restart
12. **Audit logs:** Check audit logs (web admin) → Verify `screen_locked`, `screen_unlocked`, `screen_unlock_override` entries appear

- [ ] **Step 5: Final commit (if any fixes from testing)**

```bash
git add -A
git commit -m "fix: address issues found during lock screen manual testing"
```
