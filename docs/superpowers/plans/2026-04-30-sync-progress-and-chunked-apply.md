# Sync Progress Tracking & Chunked Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-page sync progress through `SyncState` and break the WatermelonDB apply phase into one transaction per server page, so a Force Resync against a large store no longer freezes the UI.

**Architecture:** Replace the inner `pullAllPages` accumulator in `SyncManager.syncOnce()` with an outer loop that calls WatermelonDB's `synchronize()` once per server page. The loop preserves the existing server-side cursor mechanism (no backend change) and threads `cursors` + `serverNow` through closure variables, so per-page semantics match today's bulk pull exactly except that each page applies in its own SQLite transaction with an event-loop yield in between. `SyncState` gains a `progress` field carrying `phase`, `pageIndex`, and cumulative `rowsApplied`; both the header pill and Settings screen Force Resync row render it.

**Tech Stack:** TypeScript, React Native 0.81, Expo 54, WatermelonDB (`@nozbe/watermelondb` `synchronize`), Tamagui UI, Jest (`apps/native` test runner).

**Spec:** `docs/superpowers/specs/2026-04-30-sync-progress-and-chunked-apply-design.md`

**Spec deviation note:** The spec presented options (a) "keep server-side cursors, chunk only the apply" and (b) "advance `since` per page" as alternatives, with (a) as the safer fallback. This plan commits to (a) for two reasons: (1) the server's `pullPage` returns `timestamp = Date.now()` only on the first page and echoes the same value on subsequent pages (`packages/backend/convex/sync.ts:336`), so `since` is already designed to stay constant across pages within one pull; and (2) advancing `since` per page would silently drop rows tied on `updatedAt` across page boundaries (the server uses strict `gt`).

---

## File Structure

**Modified:**
- `apps/native/src/sync/types.ts` — extend `SyncState` with `SyncPhase`, `SyncProgress`, `progress` field.
- `apps/native/src/sync/SyncManager.ts` — replace `pullAllPages` with chunked synchronize loop; thread progress updates; reset progress on terminal states.
- `apps/native/src/sync/SyncStatusPill.tsx` — render page label when progress is present.
- `apps/native/src/features/settings/screens/SettingsScreen.tsx` — render live row counter + spinner on Force Resync row during sync; disable while syncing.

**Created:**
- `apps/native/src/sync/__tests__/countRows.test.ts` — unit test for the new `countRows` helper.

**Not touched:**
- Backend (`packages/backend/convex/sync.ts`, `syncEndpoints.ts`) — protocol unchanged.
- WatermelonDB schema — unchanged.

---

## Task 1: Extend `SyncState` with progress field

**Files:**
- Modify: `apps/native/src/sync/types.ts:1-9`

- [ ] **Step 1: Add `SyncPhase`, `SyncProgress`, and the `progress` field on `SyncState`**

Open `apps/native/src/sync/types.ts` and replace the top section (lines 1-9) with:

```ts
export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export type SyncPhase = "pull" | "apply" | "push";

export type SyncProgress = {
  /** Current phase of the sync run. */
  phase: SyncPhase;
  /** 1-based index of the page currently being fetched or applied. */
  pageIndex: number;
  /** Cumulative created+updated+deleted rows applied so far this run. */
  rowsApplied: number;
};

export type SyncState = {
  status: SyncStatus;
  lastPulledAt: number | null;
  lastPushedAt: number | null;
  pendingMutationCount: number;
  lastError: string | null;
  /** Live progress while `status === "syncing"`. Null in every other state. */
  progress: SyncProgress | null;
};
```

Leave the rest of the file (`WatermelonRow`, `ChangeBucket`, `TableCursor`, `CursorMap`, `PullResponse`, `PushPayload`, `PushRejection`, `PushResponse`) unchanged.

- [ ] **Step 2: Verify typecheck fails on consumers**

Run from repo root:

```bash
pnpm --filter native typecheck
```

Expected: errors in `SyncManager.ts` (`progress` missing in initial state) and possibly `SyncStatusPill.tsx`. This confirms TypeScript caught every consumer.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/sync/types.ts
git commit -m "feat(sync): add progress field to SyncState"
```

---

## Task 2: Add `countRows` helper with a unit test (TDD)

**Files:**
- Create: `apps/native/src/sync/__tests__/countRows.test.ts`
- Modify: `apps/native/src/sync/SyncManager.ts` (add export at top of file, body in next task)

- [ ] **Step 1: Write the failing test**

Create `apps/native/src/sync/__tests__/countRows.test.ts`:

```ts
import { countRows } from "../SyncManager";
import type { ChangeBucket } from "../types";

describe("countRows", () => {
  const empty: ChangeBucket = { created: [], updated: [], deleted: [] };

  it("returns 0 for an empty change set", () => {
    expect(countRows({})).toBe(0);
  });

  it("sums created + updated + deleted across one table", () => {
    const changes: Record<string, ChangeBucket> = {
      products: {
        created: [{ id: "a" }, { id: "b" }],
        updated: [{ id: "c" }],
        deleted: ["d", "e"],
      },
    };
    expect(countRows(changes)).toBe(5);
  });

  it("sums across multiple tables", () => {
    const changes: Record<string, ChangeBucket> = {
      products: { created: [{ id: "a" }], updated: [], deleted: [] },
      categories: { created: [], updated: [{ id: "b" }, { id: "c" }], deleted: ["d"] },
      orders: empty,
    };
    expect(countRows(changes)).toBe(4);
  });

  it("tolerates an undefined deleted array", () => {
    const changes: Record<string, ChangeBucket> = {
      products: {
        created: [{ id: "a" }],
        updated: [],
        deleted: undefined as unknown as string[],
      },
    };
    expect(countRows(changes)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/native && pnpm jest sync/__tests__/countRows.test.ts
```

Expected: FAIL with `Cannot find module '../SyncManager'` or `countRows is not exported`.

- [ ] **Step 3: Add the helper to `SyncManager.ts`**

Open `apps/native/src/sync/SyncManager.ts` and add this function near the bottom of the file, alongside `allEmpty` (around line 268), and add `export` to the front:

```ts
/**
 * Sum of created + updated + deleted rows across all tables in a single
 * /sync/pull page payload. Used to drive `SyncProgress.rowsApplied`.
 */
export function countRows(changes: Record<string, ChangeBucket>): number {
  let total = 0;
  for (const bucket of Object.values(changes)) {
    total += bucket.created.length + bucket.updated.length + (bucket.deleted?.length ?? 0);
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/native && pnpm jest sync/__tests__/countRows.test.ts
```

Expected: PASS, all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/sync/SyncManager.ts apps/native/src/sync/__tests__/countRows.test.ts
git commit -m "feat(sync): add countRows helper for progress tracking"
```

---

## Task 3: Replace `pullAllPages` with chunked synchronize loop

This task rewrites the heart of `SyncManager.syncOnce()`. Read the whole task before starting.

**Files:**
- Modify: `apps/native/src/sync/SyncManager.ts:14-37` (delete `pullAllPages`)
- Modify: `apps/native/src/sync/SyncManager.ts:62-69` (initial state — add `progress: null`)
- Modify: `apps/native/src/sync/SyncManager.ts:180-253` (rewrite `syncOnce`)

- [ ] **Step 1: Initialize `progress: null` in the default state**

Find the `state: SyncState = { ... }` initializer in `SyncManagerImpl` (around line 63) and add the `progress: null` field:

```ts
private state: SyncState = {
  status: "idle",
  lastPulledAt: null,
  lastPushedAt: null,
  pendingMutationCount: 0,
  lastError: null,
  progress: null,
};
```

- [ ] **Step 2: Add a `yieldToEventLoop` helper near the top of the file**

Insert below the `MAX_PULL_PAGES` constant (around line 14):

```ts
const MAX_PULL_PAGES = 50;

/** Hands control back to the event loop so the JS thread can render a frame
 *  between page applies. `setTimeout(0)` queues at the end of the macrotask
 *  queue; `Promise.resolve()` would not yield far enough. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
```

- [ ] **Step 3: Delete the `pullAllPages` function**

Remove lines 16-37 (the whole `async function pullAllPages(...)` definition). It's superseded by the inline loop in `syncOnce`.

- [ ] **Step 4: Rewrite `syncOnce` with the chunked loop**

Replace the entire body of `private async syncOnce()` (around lines 180-253) with:

```ts
private async syncOnce(): Promise<void> {
  if (this.inFlight) return;
  this.inFlight = true;
  this.setState({
    status: "syncing",
    progress: { phase: "pull", pageIndex: 1, rowsApplied: 0 },
  });

  let pageIndex = 1;
  let rowsApplied = 0;
  let cursors: CursorMap | undefined;
  let serverNow: number | undefined;
  let pushDone = false;

  try {
    while (true) {
      let pageComplete = false;
      let thisPageRows = 0;

      await synchronize({
        database: getDatabase(),
        pullChanges: async ({ lastPulledAt }) => {
          const page = await callPull(lastPulledAt ?? null, cursors, serverNow);
          if (serverNow === undefined) serverNow = page.timestamp;
          cursors = page.cursors;
          pageComplete = page.complete;
          thisPageRows = countRows(page.changes);
          this.setState({
            progress: {
              phase: "apply",
              pageIndex,
              rowsApplied: rowsApplied + thisPageRows,
            },
          });
          const mapped = mapPullChanges(
            page.changes as Record<string, ChangeBucket>,
          ) as unknown as Record<string, ChangeBucket>;
          return {
            changes: await demoteExistingCreates(getDatabase(), mapped),
            timestamp: page.timestamp,
          };
        },
        pushChanges: async ({ changes, lastPulledAt }) => {
          // Push outgoing mutations once per syncOnce(), on the first page.
          // Subsequent pages skip push (no extra round-trip; no risk of
          // re-sending a mutation that the server already accepted).
          if (pushDone) return;
          if (
            allEmpty(
              changes as Record<
                string,
                {
                  created: WatermelonRow[];
                  updated: WatermelonRow[];
                  deleted?: string[];
                }
              >,
            )
          ) {
            pushDone = true;
            return;
          }
          this.setState({
            progress: {
              phase: "push",
              pageIndex,
              rowsApplied,
            },
          });
          const clientMutationId = generateUUID();
          const mapped = mapPushChanges(
            changes as Record<
              string,
              {
                created: WatermelonRow[];
                updated: WatermelonRow[];
                deleted?: string[];
              }
            >,
          );
          const response = await callPush(
            {
              lastPulledAt: lastPulledAt ?? 0,
              changes: mapped,
              clientMutationId,
            },
            this.deviceId,
          );
          if ("rejected" in response && response.rejected.length > 0) {
            console.warn("[SyncManager] push rejections:", response.rejected);
          }
          pushDone = true;
        },
        sendCreatedAsUpdated: false,
      });

      rowsApplied += thisPageRows;
      if (pageComplete) break;

      pageIndex += 1;
      if (pageIndex > MAX_PULL_PAGES) {
        throw new Error(
          `syncOnce: did not complete within ${MAX_PULL_PAGES} pages`,
        );
      }
      this.setState({
        progress: { phase: "pull", pageIndex, rowsApplied },
      });
      await yieldToEventLoop();
    }

    this.retryAttempt = 0;
    this.setState({
      status: "idle",
      lastPulledAt: Date.now(),
      lastPushedAt: Date.now(),
      lastError: null,
      progress: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SyncManager]", msg);
    this.setState({ status: "error", lastError: msg, progress: null });
    this.scheduleRetry();
  } finally {
    this.inFlight = false;
  }
}
```

Notes for the implementer:
- `cursors`, `serverNow`, `pushDone`, `pageIndex`, `rowsApplied` are closure-scoped to one `syncOnce` invocation. They reset on the next call.
- `serverNow` is captured from page 1's `timestamp` and threaded into every subsequent `callPull` so the server keeps `since` constant across pages within a run (matches existing protocol).
- `pageComplete` and `thisPageRows` are captured per-iteration via the `pullChanges` closure so the outer loop can break / accumulate after `synchronize` returns.
- `pushChanges` is invoked by WatermelonDB on every `synchronize()` call. The `pushDone` flag short-circuits subsequent calls so we don't re-send mutations on every page.
- The error path resets `progress: null` so the pill doesn't render stale `page N` text on a failure.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter native typecheck
pnpm --filter native lint
```

Both should pass. If typecheck complains about `cursors` being passed where `CursorMap | null | undefined` was expected, double-check `callPull`'s signature in `apps/native/src/sync/syncEndpoints.ts` and adjust the cast.

- [ ] **Step 6: Run the existing test suite for the sync layer**

```bash
cd apps/native && pnpm jest sync
```

Expected: only the `countRows.test.ts` runs (no other sync tests exist) and passes.

- [ ] **Step 7: Commit**

```bash
git add apps/native/src/sync/SyncManager.ts
git commit -m "feat(sync): chunk pull-apply per page to keep UI responsive"
```

---

## Task 4: Render page progress in `SyncStatusPill`

**Files:**
- Modify: `apps/native/src/sync/SyncStatusPill.tsx:13-31` (rewrite `formatStatus`)

- [ ] **Step 1: Update `formatStatus` to read `state.progress`**

Replace the `formatStatus` function in `apps/native/src/sync/SyncStatusPill.tsx` with:

```ts
function formatStatus(state: SyncState): string {
  if (state.status === "syncing") {
    if (state.progress?.phase === "push") return "Pushing…";
    if (state.progress) return `Syncing… page ${state.progress.pageIndex}`;
    return "Syncing…";
  }
  if (state.status === "offline") {
    return state.pendingMutationCount > 0
      ? `Offline (${state.pendingMutationCount} pending)`
      : "Offline";
  }
  if (state.status === "error") return "Sync failed — tap to retry";
  // idle
  if (!state.lastPulledAt) return "Not synced";
  const ago = Date.now() - state.lastPulledAt;
  const dc = syncManager.getDeviceCode();
  const deviceSuffix = dc ? ` · Device ${dc}` : "";
  if (ago < 60_000) return `Synced${deviceSuffix}`;
  const minutes = Math.floor(ago / 60_000);
  if (minutes < 60) return `Synced ${minutes}m ago${deviceSuffix}`;
  const hours = Math.floor(minutes / 60);
  return `Synced ${hours}h ago${deviceSuffix}`;
}
```

The rest of the component (component body, `COLORS` map, JSX) stays the same.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter native typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/sync/SyncStatusPill.tsx
git commit -m "feat(sync): render page index in status pill while pulling"
```

---

## Task 5: Live counter + spinner on Force Resync row

**Files:**
- Modify: `apps/native/src/features/settings/screens/SettingsScreen.tsx`

- [ ] **Step 1: Subscribe to `SyncState` at the top of the component**

Open `apps/native/src/features/settings/screens/SettingsScreen.tsx`. Near the top of the `SettingsScreen` component (alongside any existing hooks), add:

```ts
const [syncState, setSyncState] = useState<SyncState>(syncManager.getState());
useEffect(() => syncManager.subscribe(setSyncState), []);
```

Add the imports at the top of the file:

```ts
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import type { SyncState } from "../../../sync/types";
```

(Keep existing imports; only add what's missing.)

- [ ] **Step 2: Compute the resync row's subtitle and disabled state**

Just above the JSX block that renders the Force Resync `Pressable` (around line 126), add:

```ts
const isSyncing = syncState.status === "syncing";
const resyncSubtitle = (() => {
  if (!isSyncing) return "Re-download all data from server";
  const p = syncState.progress;
  if (!p) return "Syncing…";
  if (p.phase === "push") return "Pushing pending changes…";
  return `Synced ${p.rowsApplied.toLocaleString()} rows · page ${p.pageIndex}`;
})();
```

- [ ] **Step 3: Wire `isSyncing` and the live subtitle into the Force Resync row**

Modify the Force Resync `Pressable` (currently around lines 126-170) so it:
1. Disables the press handler (and the Alert) while syncing.
2. Replaces the static subtitle with `resyncSubtitle`.
3. Swaps the trailing chevron for an `ActivityIndicator` while syncing.

The full updated block:

```tsx
{/* Force Resync */}
<Pressable
  android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
  disabled={isSyncing}
  style={({ pressed }) => [
    {
      backgroundColor: "#FFFFFF",
      paddingHorizontal: 16,
      paddingVertical: 16,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: "#F3F4F6",
    },
    { opacity: pressed || isSyncing ? 0.7 : 1 },
  ]}
  onPress={() => {
    if (isSyncing) return;
    Alert.alert(
      "Force Resync",
      "This will re-download all data from the server. Any unsynced local changes will still be pushed first. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Resync",
          style: "destructive",
          onPress: () => void syncManager.forceFullResync(),
        },
      ],
    );
  }}
>
  <YStack
    width={40}
    height={40}
    borderRadius={20}
    backgroundColor="#FEF2F2"
    alignItems="center"
    justifyContent="center"
  >
    <Ionicons name="refresh-outline" size={20} color="#EF4444" />
  </YStack>
  <YStack flex={1} marginLeft={12}>
    <Text style={{ fontSize: 16, fontWeight: "600" }}>Force Resync</Text>
    <Text style={{ fontSize: 14, color: "#6B7280" }}>{resyncSubtitle}</Text>
  </YStack>
  {isSyncing ? (
    <ActivityIndicator size="small" color="#9CA3AF" />
  ) : (
    <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
  )}
</Pressable>
```

- [ ] **Step 4: Typecheck and lint**

```bash
pnpm --filter native typecheck
pnpm --filter native lint
```

Both should pass.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/settings/screens/SettingsScreen.tsx
git commit -m "feat(settings): live progress on Force Resync row"
```

---

## Task 6: Manual verification

These cannot be automated; the existing test suite has no end-to-end sync harness. Run them on a real device (or simulator) before claiming the feature done.

- [ ] **Step 1: Force Resync against a populated store**

1. `cd apps/native && pnpm ios` (or `pnpm android`).
2. Sign in to a store with at least a few hundred catalog rows.
3. Open Settings → tap **Force Resync** → confirm.
4. Watch the row's subtitle: it should climb (`Synced 250 rows · page 1` → `… page 2` → `… page N`) with the spinner spinning.
5. Watch the header pill: it should show `Syncing… page N` and update.
6. Try scrolling and tapping menu items during the resync. The UI should remain responsive (this is the core fix).

- [ ] **Step 2: Crash-resume**

1. Start a Force Resync on a store large enough to take more than one page.
2. Force-quit the app while page 2+ is applying (watch the row counter to time it).
3. Relaunch. The next sync should resume — observe via the pill that the very first page on the new run still pulls some rows (because the cursor was committed at the end of each page).

- [ ] **Step 3: Steady-state pull is unchanged**

1. Without forcing resync, leave the app idle for ~60s so the periodic timer fires.
2. The pill should briefly show `Syncing… page 1`, then return to `Synced` within a second.
3. No regression: existing periodic sync behavior is unaffected.

- [ ] **Step 4: Push during resync**

1. Start a Force Resync.
2. While it's mid-pull, immediately add an item to a draft order (any local mutation).
3. The mutation should queue locally and push once the in-flight resync's first iteration runs `pushChanges` (only on page 1). No errors in the console.

- [ ] **Step 5: Offline → online transition**

1. Toggle airplane mode while idle.
2. Pill should show `Offline`.
3. Toggle off — pill should transition `Offline` → `Syncing… page 1` → `Synced`.

- [ ] **Step 6: If all five pass, write a release note + version bump (separate concern, see Task 7)**

---

## Task 7: Version bump + release note

**Files:**
- Modify: `apps/native/package.json` version field, plus whichever release-notes file the project uses.

- [ ] **Step 1: Bump version**

Use the project's existing `version-release` skill (per CLAUDE.md): say "bump version" or run the skill. Choose **minor** (new user-visible feature). Confirm the new version, e.g. `3.26.0`.

- [ ] **Step 2: Add release note**

Whatever file `version-release` updates (likely `apps/native/RELEASE_NOTES.md` or similar — follow the skill's lead), add an entry:

```
- Sync: live progress on Force Resync ("Synced N rows · page X") and per-page chunked apply so the UI stays responsive on large stores.
```

- [ ] **Step 3: Commit**

The `version-release` skill commits + pushes. Follow its prompts.

---

## Self-Review Notes

- Spec coverage: every section of the spec maps to a task. Architecture → Task 3. State Contract → Task 1 + Task 3 (state transitions). UI Changes → Tasks 4 and 5. Error Handling → Task 3 step 4. Testing → Task 6 (manual) + Task 2 (countRows unit).
- Type consistency: `SyncPhase` values are `"pull" | "apply" | "push"` everywhere. `progress: null` is the resting value in initial state, success, and error. `pageIndex` is 1-based throughout.
- One spec deviation flagged at the top: this plan picks option (a) (preserve cursors) and explains why — not a placeholder.
- No `setImmediate` (RN doesn't expose it natively); `setTimeout(0)` is used per the spec's footnote.
