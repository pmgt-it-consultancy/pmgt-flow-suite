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

Use the approved one-file ticket briefs in .scratch/kotlin-migration/issues in dependency order. Task 8 (#36) can proceed independently against existing backend endpoints. All shared Android interfaces must be recorded in this plan before downstream implementation. Task 2 owns db/ and adoption; Task 3 owns sync/; Task 4 owns money/ and fixtures; Tasks 5–7 and 9–13 own feature UI/repositories. Task 14 runs complete verification and reviews against baseline ede976f4c566b055fb47c8a9b6b412ecf880acac.
