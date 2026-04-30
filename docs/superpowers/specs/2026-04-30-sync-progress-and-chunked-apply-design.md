# Sync Progress Tracking & Chunked Apply

**Date:** 2026-04-30
**Status:** Draft
**Surface:** `apps/native/src/sync/*`, `apps/native/src/features/settings/screens/SettingsScreen.tsx`

## Problem

Two pain points in the offline-first sync layer:

1. **No progress visibility.** `SyncState` only carries `status: "syncing"`. The header pill (`SyncStatusPill`) and the Force Resync row in the native Settings screen both show a generic "Syncing…" label with no indication of how far along the sync is. On large stores the user sees a frozen-looking UI for many seconds with no signal that progress is happening.

2. **Initial pull / Force Resync blocks the UI.** `pullAllPages` accumulates every page in memory and hands the merged blob to WatermelonDB's `synchronize()`, which applies it inside one big SQLite transaction on the JS thread. Stores with tens of thousands of rows freeze the app for the entire duration of that single apply.

Steady-state syncs (small periodic deltas, post-write pushes) are fine — this design targets the initial / forced full pull only.

## Goals

- Surface `phase`, `pageIndex`, and cumulative `rowsApplied` from the SyncManager so any subscriber can render meaningful progress.
- Break the apply phase of a large pull into per-page transactions that yield to the event loop, so the UI stays responsive during a Force Resync.
- Preserve crash-resume behavior: a sync interrupted mid-pull resumes at the last completed page rather than restarting.
- No new dependencies. No backend changes — the existing `/sync/pull` already paginates with cursors and a `complete` flag.

## Non-Goals

- True percentage progress. The server doesn't pre-count total rows; we show "page N" and a cumulative row counter, not "X%".
- Per-table breakdown in the header pill (kept as a possible future Settings-screen enhancement).
- Reducing steady-state sync cost (rows-per-page tuning, React re-render debouncing). Out of scope.
- Push-side progress. Pushes are small and debounced; phase label `"Pushing…"` is enough.

## Architecture

### Chunked synchronize loop (replaces `pullAllPages`)

Today, `SyncManagerImpl.syncOnce()` calls `synchronize()` once with a `pullChanges` callback that internally loops `pullAllPages` until the server reports `complete: true`, then returns one merged change blob to WatermelonDB.

New shape: `syncOnce()` runs `synchronize()` **once per server page** in a loop, until the server reports `complete: true`:

```
async syncOnce():
  setState({ status: "syncing", progress: { phase: "pull", pageIndex: 1, rowsApplied: 0 } })
  let pageIndex = 1
  let rowsApplied = 0
  let pushedThisRun = false

  while (true):
    let pageComplete: boolean
    let pageRows: number

    await synchronize({
      pullChanges: async ({ lastPulledAt }) => {
        const page = await callPull(lastPulledAt ?? null, /* no cursor — server picks up from lastPulledAt */)
        pageComplete = page.complete
        pageRows = countRows(page.changes)
        setState({ progress: { phase: "apply", pageIndex, rowsApplied: rowsApplied + pageRows } })
        const mapped = mapPullChanges(page.changes)
        return {
          changes: await demoteExistingCreates(getDatabase(), mapped),
          timestamp: page.timestamp,
        }
      },
      pushChanges: pushedThisRun ? undefined : pushChangesFn,  // push only on first iteration
      sendCreatedAsUpdated: false,
    })

    pushedThisRun = true
    rowsApplied += pageRows
    if (pageComplete) break
    pageIndex += 1
    setState({ progress: { phase: "pull", pageIndex, rowsApplied } })
    await yieldToEventLoop()  // setImmediate / setTimeout(0)
```

Where `yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0))`.

### Cursor handling

WatermelonDB's `synchronize()` updates `__watermelon_last_pulled_at` to the `timestamp` returned from `pullChanges` after each successful apply. The server's `since` parameter on subsequent pages is therefore the timestamp of the previous page.

This is a **behavioral change from today's pagination model.** Today, pages within a single pull share the same `since` (the original `lastPulledAt`) and the server walks rows via opaque per-table `cursors`. With the new loop, each page's `since` advances to the previous page's `timestamp`, and we no longer pass `cursors` to `callPull`.

This is correct as long as `/sync/pull`'s incremental-pull semantics rely solely on `since` (rows where `updatedAt > since`), which they do — the existing `pullTablePage` query in `convex/sync.ts` uses `by_store_updatedAt` indexes with `.gt("updatedAt", since)`. The `cursors` mechanism exists to handle within-`since`-window pagination for very large initial pulls; under the new loop, each page's `since` advances, so within-window pagination is unnecessary.

**Edge case: ties on `updatedAt`.** If multiple rows share an `updatedAt` value spanning a page boundary, advancing `since` to that `updatedAt` value would skip the late-arriving ties. The implementation plan must verify whether `pullTablePage` uses strict `gt` or `gte` and whether ties are handled deterministically. If ties are possible, either:
- (a) Keep the existing `cursors` mechanism inside a single page-fetch, but call `synchronize()` per outer "logical page" (one cursor advancement) — same yielding behavior, no tie risk.
- (b) Change the server's `since` predicate to `>= since` and dedupe on the client.

Default to (a) if there's any ambiguity — it preserves current server semantics and only changes client-side chunking.

### Push timing

Push runs once per `syncOnce()` invocation (today's behavior, retained). To avoid pushing on every page iteration, attach `pushChanges` only on the first synchronize() call of the loop and pass `undefined` thereafter (or a no-op that returns early when changes are empty). The first iteration handles outgoing mutations; subsequent iterations are pull-only.

## State Contract

`apps/native/src/sync/types.ts`:

```ts
export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export type SyncPhase = "pull" | "apply" | "push";

export type SyncProgress = {
  phase: SyncPhase;
  pageIndex: number;     // 1-based; current page being fetched or applied
  rowsApplied: number;   // cumulative created + updated + deleted across all completed pages this run
};

export type SyncState = {
  status: SyncStatus;
  lastPulledAt: number | null;
  lastPushedAt: number | null;
  pendingMutationCount: number;
  lastError: string | null;
  progress: SyncProgress | null;  // null when status !== "syncing"
};
```

State transitions inside `syncOnce()`:

| When | `status` | `progress` |
|------|----------|------------|
| Entry | `"syncing"` | `{ phase: "pull", pageIndex: 1, rowsApplied: 0 }` |
| After `callPull` returns page N, before apply | `"syncing"` | `{ phase: "apply", pageIndex: N, rowsApplied: prior + thisPageRows }` |
| After page N applied, page N+1 about to fetch | `"syncing"` | `{ phase: "pull", pageIndex: N+1, rowsApplied: cumulative }` |
| Push step (first iteration only) | `"syncing"` | `{ phase: "push", pageIndex: <current>, rowsApplied: <current> }` |
| Success | `"idle"` | `null` |
| Error | `"error"` | `null` |

`rowsApplied` is computed by `countRows(changes)` = sum of `created.length + updated.length + deleted.length` across all tables in the page payload.

## UI Changes

### `SyncStatusPill.tsx` (header)

Render logic when `status === "syncing"`:

- If `progress?.phase === "pull"` or `"apply"`: show `"Syncing… page {pageIndex}"`.
- If `progress?.phase === "push"`: show `"Pushing…"`.
- If `progress == null` (e.g. push-only debounced sync): show `"Syncing…"` (current behavior).

Other statuses unchanged.

### `SettingsScreen.tsx` Force Resync row

When `status === "syncing"`:

- Replace the static "Force Resync" subtitle with a live counter:
  `"Synced {rowsApplied.toLocaleString()} rows · page {pageIndex}"`
  (Fallback to "Syncing…" if `progress == null`.)
- Show an `ActivityIndicator` (RN built-in, indeterminate) inline next to the counter. No true progress bar — server doesn't return total row count.
- Disable the row's `onPress` (no double-trigger).

When `status !== "syncing"`: revert to today's static label and behavior.

## Error Handling

- A failed page leaves `__watermelon_last_pulled_at` at the last successfully-applied page's timestamp. Retry resumes from there. This is an improvement over today's behavior, where a failed apply on a 30k-row pull discards the entire pull.
- Per-page failures still call `scheduleRetry()` with the existing backoff schedule; nothing changes there.
- The 50-page safety cap (`MAX_PULL_PAGES`) is preserved — applied to the outer loop. If the server sends `complete: false` indefinitely, the loop throws after 50 iterations.
- `progress` is reset to `null` in both the success and error paths (the `setState({ status: ..., lastError: ... })` calls in `syncOnce()`'s try/catch).

## Testing

Manual verification (no new automated tests for this change — sync is exercised end-to-end via the existing `convex-test` suite for backend invariants; client-side chunking is best validated against a real device with a populated store):

1. **Force Resync against a large dev store** (≥10k rows): observe pill updates `page 1 → 2 → … → N`, observe Settings row counter climbs, observe UI remains responsive (can scroll, tap menu items) during apply.
2. **Force Resync interrupted** (kill app mid-pull): relaunch, observe sync resumes at last-completed page rather than starting over (verify by watching pill's starting `pageIndex` after restart — should be > 1 if cursor advanced).
3. **Steady-state periodic pull** (small delta): observe pill briefly shows `page 1`, then back to idle within < 1s. No regression in normal operation.
4. **Offline → online transition**: observe pill goes `offline → syncing (page 1) → idle`.
5. **Push during initial pull**: trigger a local mutation while a Force Resync is mid-flight. Verify the push is debounced and runs once `syncOnce()` re-enters (not interleaved across pages).

## Files Touched

- `apps/native/src/sync/types.ts` — add `SyncPhase`, `SyncProgress`, `progress` field on `SyncState`.
- `apps/native/src/sync/SyncManager.ts` — replace `pullAllPages` accumulator with chunked synchronize loop; thread `progress` updates through `setState`; reset `progress` on success/error.
- `apps/native/src/sync/SyncStatusPill.tsx` — render new progress label when present.
- `apps/native/src/features/settings/screens/SettingsScreen.tsx` — render live counter + spinner on Force Resync row during sync; disable while syncing.

No backend changes. No schema changes. No new dependencies.
