# Ticket #9: sync responsiveness and queued delivery

Code changes are complete; release-device performance acceptance is still pending. No APK build, deployment, backend migration, worker runtime, or financial protocol change was performed.

## Findings and changes

- `syncNow()` and debounced `triggerPush()` previously returned immediately while a run was active, dropping the requested subsequent pass. Requests now coalesce into a follow-up run, with an event-loop yield between runs. `syncNow()` waits through the active run and its queued follow-up. Writes are remembered immediately even before the 500 ms debounce expires.
- Failed runs stop draining and use the existing 2 s / 5 s / 15 s / 60 s retry schedule. Offline requests remain queued until connectivity returns. Stopping clears timers and pending requests, and session generation checks prevent an old startup/run from starting further network work or updating completion state after sign-out. In-flight native/network operations themselves cannot be cancelled.
- A second delivery hazard existed in paginated sync: `pushDone` returned successfully without sending on later pages. Installed WatermelonDB 0.28 `sync/impl/synchronize.js` calls `markLocalChangesAsSynced` after a successful `pushChanges` callback. A write made during page two could therefore disappear from the outbox without delivery. Later pages now omit `pushChanges` entirely, leaving late writes pending for the coalesced follow-up. Push remains at most once per run and uses the existing payload/identifier protocol.
- The original pull `since`, server timestamp and pagination cursor remain pinned across pages. The 50-page bound and macrotask yields remain intact.
- Incomplete pages now retain the original durable watermark, so stop/offline/error before the final page replays safely instead of skipping unseen pages. Watermelon's required positive timestamp uses marker `1` for an incomplete first pull; that marker is normalized back to `null` on restart so the backend still includes legacy rows without `updatedAt`. Push requests still use the server timestamp. A request arriving between the drain loop completing and its promise settling is also drained before its waiter resolves.

## Opt-in profiling and capture

For a future expressly authorized profiling build, set `EXPO_PUBLIC_POS_PERF=1` before Expo bundles the app. The default is disabled. This flag enables collection in `apps/native/src/sync/diagnostics.ts`; it does not print or upload anything. No build was made for this task.

A profiling harness or temporary device diagnostics action can import the API directly:

```ts
import { syncDiagnostics, SyncPhase } from "./src/sync/diagnostics";

syncDiagnostics.enable(); // Clears old samples and begins a fresh workload window.
// Perform the defined busy-shift workload on the release device.
const samples = syncDiagnostics.snapshot(); // Detached, chronological numeric records.
syncDiagnostics.disable(); // Stops collection and clears retained memory.
```

Capture `samples` locally at workload checkpoints through that harness; do not attach order payloads, device/store IDs, customer details, tokens, or payment content. The API is available in release JavaScript and has no `__DEV__` dependency. Re-enabling resets the capture window. Disabling invalidates unfinished measurements so they cannot leak into the next capture.

The same explicit flag also installs a local `globalThis.__POS_SYNC_PERF__` handle with only `enable()`, `disable()` and `snapshot()`. In an attached JavaScript execution console for a profiling runtime, run `globalThis.__POS_SYNC_PERF__.enable()` before the workload and `JSON.stringify(globalThis.__POS_SYNC_PERF__.snapshot())` at each checkpoint, then `globalThis.__POS_SYNC_PERF__.disable()`. This handle is absent from normal bundles. A standard release build may not expose a JavaScript console: in that case use a deliberate local profiling harness/action importing the API above; the flag alone does not add a UI, console, export file, or debugger transport. Collection and capture do not change the JavaScript execution engine.

Each sample contains only numeric `phase`, `page`, `durationMs`, `rows`, and `succeeded` (1 or 0). Retention is a fixed 256-entry ring, oldest samples overwritten first. Snapshot mutation cannot alter retained data. Disabled collection reads no profiling clock. No identifiers, free-form labels, error text, table names, or payloads are retained by this diagnostics module. Existing sync error logging is unchanged and is not the capture mechanism.

| Phase number | Enum name | Interpretation |
| --- | --- | --- |
| 1 | PullNetwork | Endpoint elapsed time, including authentication, serialization, network wait and response JSON parsing; not pure wire latency. Row count is 0 because counting happens next. |
| 2 | PullMap | Synchronous row counting, progress publication and camelCase-to-snake_case mapping. Includes synchronous progress listeners. |
| 3 | ApplyPreparation | Existing-create lookup and demotion; includes database wait and JavaScript preparation. |
| 4 | ApplyAndReadLocal | Time after pull callback preparation until push callback entry, or synchronize completion if no push callback runs. Includes Watermelon apply, lock wait and local-change reads/bookkeeping, not pure SQLite time. |
| 5 | PushMap | Synchronous outgoing field translation and row counting. |
| 6 | PushNetwork | Push endpoint elapsed time, including serialization, authentication, network wait and response parsing. |
| 7 | SynchronizeTotal | Entire page synchronize elapsed time, including the above phases and final local bookkeeping. Overlaps other samples; never add it to them or label it database time. |

These are elapsed phase measurements. Use Hermes/Android profiling alongside them to distinguish CPU, GC, scheduling and database lock time within mixed phases. A failed endpoint/preparation/apply records a failure bit, not the error content. Sample retention is bounded but may wrap during a long run; capture checkpoint snapshots rather than assuming it is a complete event history.

## Verification and measurement limits

Regression tests use the public manager lifecycle and diagnostic snapshot API, with native storage/network/Watermelon/time boundaries mocked. They cover active-run coalescing and waiting, stopped startup, stopped pull, restart before old completion, offline/reconnect, retry backoff/cancellation, pagination yield/cursor stability, late-page outbox delivery, retention/isolation, and separation of phase times.

The synthetic phase fixture assigns 20 ms to pull, 7 ms to local apply/read, 30 ms to push, and 3 ms to final bookkeeping. It verifies reported phases and the inclusive 60 ms synchronize total; these numbers are test inputs, not tablet measurements.

Focused validation: `pnpm exec jest src/sync/__tests__/SyncManager.test.ts src/sync/__tests__/diagnostics.test.ts src/sync/__tests__/countRows.test.ts --runInBand` and native `pnpm typecheck`. Full native suite is coordinated by the parent task once after integration.

## Evidence required before additional architecture changes

Before a worker: capture a representative release workload on the VistaTab with build/device details, data/page volume, phase distributions, memory trend and Hermes CPU/GC trace. Demonstrate repeatable mapping/CPU stalls that correlate with cashier interaction latency, then compare smaller chunks/yields against worker transfer/serialization costs and memory overhead. Network wait alone does not justify a worker.

Before an index migration: identify the specific slow query using an actual database query plan and elapsed timings at representative row counts, show scans/lock wait cause the observed stall, and measure candidate-index gains plus write, disk and migration cost. Require migration/recovery tests and device evidence before changing the schema.

## Existing API limitation retained

`syncNow()` still resolves after an attempted run fails, and while stopped/offline or held by backoff; errors remain in manager state and background retries. This preserves the existing public failure contract and avoids unhandled rejections in callers using `void syncNow()`. It now waits correctly for active/coalesced work, but a resolved promise is not a delivery receipt. Day-closing callers currently use it as a precondition without inspecting manager state; strengthening that gate and the explicit failure contract requires a coordinated caller change. No success timestamp is written for a stopped/offline/failed pass.
