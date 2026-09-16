# Kotlin POS Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans. Approved spec: ../specs/2026-09-15-kotlin-pos-parity.md, GitHub #28.

**Goal:** Implement tickets #29–#42 as a verified Kotlin POS parity port.
**Architecture:** Parallel Android application; SQLDelight legacy database, OkHttp Convex transport, Compose UI. RN remains the behavior oracle.
**Tech Stack:** Kotlin, Jetpack Compose, SQLDelight, OkHttp, Convex, Vitest.

## Global Constraints

- 1:1 behavior; no sync v2 or offline-auth feature.
- 1:1 UI as well: existing RN screens, assets, labels, sizing, modal structure and navigation are the reference. No Material defaults or adaptive redesign may replace them.
- Apply android-clean-architecture, android-jetpack-compose and kotlin-coroutines-flows as implementation guidance: explicit domain/data/UI boundaries, hoisted render state, lifecycle-aware collection and cancellation-safe work. Retain the approved SQLDelight/OkHttp stack; do not add frameworks merely because skill examples use them.
- No worktrees; branch feat/kotlin-pos-migration.
- Preserve binary64 money arithmetic including epsilon and JavaScript rounding.
- Preserve existing IDs, pending work, and rollback-compatible SQLite writes.
- Physical VistaTab requirement waived by user; do not invent hardware evidence.
- Commit only migration files; preserve pre-existing user changes.
- Test at approved workflow, fixture, upgrade, and backend endpoint seams.

## Task 1: Launch Kotlin POS and sign in (#29)

Read .scratch/kotlin-migration/issues/01-launch-kotlin-pos-and-sign-in.md.
Create apps/android Gradle app with package com.pmgt.pos, development suffix .kotlin.dev, release identity verified from RN configuration. Build settings and SDK versions must be verified against current official documentation and installed SDKs.
Create transport/ConvexHttp.kt, auth/AuthRepository.kt, auth/SessionStorage.kt, auth/LockState.kt, MainActivity.kt and auth UI. Use kotlinx.serialization JsonObject DTOs at transport boundaries and typed auth state. Backend URL comes from untracked local.properties or Gradle properties. Do not commit credentials.
Public boundary: suspend ConvexHttp.query(path: String, args: JsonObject), mutation and action returning JsonElement; suspend httpAction(path: String,args: JsonObject). Public token property for sync. Auth exposes StateFlow of signed-in user/session and server permission membership. Lock reproduces RN persisted fields and transient cooldown.
- [ ] Write a failing public HTTP/auth behavior test against a local HTTP test server.
- [ ] Run focused test and record RED.
- [ ] Implement sign-in/refresh/sign-out and actual Compose login/store/lock shell.
- [ ] Run tests and assembleDebug; document exact commands and output.
- [ ] Commit scoped Android files and report.

## Remaining tasks

### Implemented shared Android boundaries

- `PosApplication` owns one `ConvexHttp`, `AuthRepository`, and `LockState`; downstream repositories reuse these instances.
- `ConvexHttp.query`, `mutation`, and `action` accept a function path and `JsonObject` arguments and return `JsonElement`. `httpAction(path, args, headers)` targets the site's HTTP endpoints; sync supplies `x-device-id` through its headers argument. `unauthenticatedAction` is reserved for the auth protocol.
- `AuthRepository` installs the transport's suspending `freshToken` supplier. Consumers do not implement their own token refresh. Its `StateFlow<AuthState>` exposes the typed `SignedInUser`, assigned `selectedStoreId`, loading, and error; permission membership uses `hasPermission`. Public lifecycle operations are `signIn`, `restore`, `reloadUser`, and `signOut`.
- Storage and sync may use JSON rows at their boundary; feature repositories must map them to typed domain/render models. Database operations run off the main thread, and committed invalidations must not expose partial transactions.
- `AndroidDatabase.open(context)` provides local-integrity-checked legacy storage, not server readiness. `AdoptionVerifier(db::integrity, verifyReferences, io)` exposes `Ready`, `PendingVerification`, or `Blocked`; Task 3 wires these ahead of synchronization. References include table, local ID, server ID, and local status from one snapshot.
- `PosDatabase` provides serialized synchronous transactions, restricted row queries/local writes/remote merges, local values, and a committed-write invalidation `StateFlow<Long>`. Raw queries include tombstones unless explicitly filtered. `pendingChanges()` returns serializable `ChangeSnapshot(changes, deletedRows)`; persist the full snapshot for retries, transmit only translated changes, then call snapshot-aware `acknowledge` with rejected row identities. Local tombstone revisions must survive restart and must never be transmitted.
- `PosApplication.startup` owns `TabletStartup`; its state binds adoption to the current user/store, and it exposes the shared database and sync only after readiness. Production content remains behind that gate. Downstream repositories must reuse these instances rather than opening another database or session.
- `SyncManager` exposes `state`, `deviceCode`, `start`, `stop`, `syncNow`, `triggerPush`, `syncForDelivery`, and `forceFullResync`. Call `triggerPush` after committed local writes; it schedules delivery rather than confirming server acceptance. Delivery/resync consumers must handle typed offline, backoff, pending and failure outcomes. Preserve local order-counter bookkeeping without making it a server-delivery obligation.
- `LocalBrowseRepository(db, io)` implements typed, route-owned flows for active orders, tables, dated takeout lanes, filtered history and selected order detail. Reuse its source-compatible projections and `BrowseFormatting` display helpers where appropriate; display formatting is separate from ledger arithmetic in `Money`.
- `PosBrowseRoot` owns the headerless operational navigation and emits typed `BrowseAction` callbacks for editor, checkout, receipt, void/refund, settings and closing integration. Unimplemented callbacks show explicit unavailable feedback, never successful business outcomes. Task 7 integrates the editor into this root; catalog stays embedded in the editor.
- `DashboardSource` observes server summaries through the existing HTTP client; local active-order counts do not replace server summaries. Current polling/sync-completion refresh is not proof of live subscription freshness parity.
- Production Home logout uses the shared `RootLogout` single-flight boundary outside the auth gate. Preserve ordinary revocation-failure containment, cancellation propagation and the repository's credential cleanup when extending root navigation.
- `LocalCatalogRepository(db, io)` supplies store-scoped `catalog` and selected-product `modifiers` flows. Typed render projections omit sync-only metadata; relevant modifier changes expose loading then rebuilt groups. Modifier cardinality limits remain `Double` to preserve the source validators' numeric semantics.
- `CatalogMenu` embeds the original three-column menu without navigation chrome. `ProductSelectionSheet` accepts a selected product snapshot, entry point, sending state and typed `ProductChoice` callback. Task 7 owns the selection lifecycle and writes: choices contain base/custom product price and separate modifier snapshots, which must not be charged twice. A catalog choice is not a persisted order item.

### Order-entry integration (32203d0..cceb586; scoped review clean)

- Reuse `LocalOrderRepository` with the adopted database, IO dispatcher, device identity/code and sync push scheduler. Its cold `cart` projection exposes typed selected rows, discounts and checkout totals; persisted recalculation uses a distinct money branch. Existing-row storage updates preserve SQLite row identity and source fold order.
- `OrderEditorSession` owns memory-only dine-in drafts and the absolute quantity queue. Flush through its existing checkout boundary before consuming `CheckoutRoute` (order/type/table/name/category/marker); an optimistic UI quantity is not yet a durable row. `KitchenRequest` carries persisted identity plus the source's captured print lines and metadata, not a claim of printed output.
- `EditorSessions` lives above the lock conditional but is populated only after adoption readiness. Reuse this ownership pattern when integrating routes: hidden UI observations and dialogs stop, owned saves finish, and actual identity changes clear memory drafts without deleting database work. Modal state survives lock in memory, not process death.
- First-send and item-add callbacks retain exact committed identities across later recalculation failure. Retry finishes known work rather than reserving another number or inserting another item. Preserve the source's separate counter/batch/recalculation phases and number gaps.
- Persisted editor cancellation belongs to order entry. Its exact `CancelCommit` supports finish-only table-release retry after void insertion; settlement must not duplicate this operation. `reserveOrderNumber` is a separate consuming operation for flows such as refund replacement, not an automatic checkout step.

Before extending these boundaries, read `.superpowers/sdd/2026-09-15-kotlin-execution/task-7-report.md` for source-phase caveats, recovery limits and verification evidence. Implementation tests do not establish authenticated RN screenshot or live-store parity.

### Checkout integration (fb33c55..2e6ff60, scoped review clean)

- `LocalCheckoutRepository` reuses adopted storage, shared transport and push scheduling. Durable local intents preserve exact payment/discount identities across separate source write phases; a retry must resume that intent rather than regenerate rows. Local editor writes consult the shared order-write guard while an action is unfinished.
- The round-one v2 journal captures original selected financial inputs and allocated IDs, derives and validates the full canonical phase plan, and checks its committed projection. V1/unknown/unprovable active or settled evidence remains retained and blocked, without automatic conversion or clearing. Parent order-number hydration is excluded narrowly from financial conflict checks; original receipt identity is preserved.
- Each payment/discount insert and paid transition captures its timestamp on first execution, atomically with that phase's journal advancement; committed timestamps survive retries. Receipt time is confirmed local completion time. This does not change the backend's order-created-at closing-date rule.
- `pendingActions(storeId)` distinguishes recoverable, conflicted and unreadable local financial work. Closing and refresh must consult it in addition to sync delivery: all committed rows can be acknowledged before the intent's remaining phases finish. Unreadable recovery evidence is not an empty queue.
- `AuthRepository.sessionEpoch` exposes the existing generation as a read-only flow. Checkout memory/approval ownership observes it alongside user/store, preventing a same-user logout/login from accepting stale work. Durable journal ownership uses stable user/store, not that process-local epoch.
- `recoverablePayment(owner, orderId)` returns only a validated owned saved route for an unfinished paid checkout hidden from active orders. The narrow Home recovery prompt resumes exact existing work; Later retains evidence. This is a documented safety addition, not a new recovery screen.
- `CompletedCheckout` is an immutable local-completion snapshot. Task11 owns receipt preview, formatting, printer/drawer effects and reprint behavior. Presentation can repeat after remount; it must not be treated as an automatic print command or another settlement. Completed journal retention is currently unbounded, and legacy RN cannot interpret unfinished Kotlin journals.

Before extending checkout, read its finalized `.superpowers/sdd/2026-09-15-kotlin-execution/task-9-report.md` for phase, approval, recovery and evidence constraints. Independent review is clean after two correction rounds. Final correction verification covers 123 host tests, 10 affected Android tests and unsigned release; the full 49-test Android baseline passed at c698b9a. These checks do not establish authenticated RN visual, live-store, hardware or cutover acceptance.

Use the approved one-file ticket briefs in .scratch/kotlin-migration/issues in dependency order. Task 8 (#36) can proceed independently against existing backend endpoints. All shared Android interfaces must be recorded in this plan before downstream implementation. Task 2 owns db/ and adoption; Task 3 owns sync/; Task 4 owns money/ and fixtures; Tasks 5–7 and 9–13 own feature UI/repositories. Task 14 runs complete verification and reviews against baseline ede976f4c566b055fb47c8a9b6b412ecf880acac.
