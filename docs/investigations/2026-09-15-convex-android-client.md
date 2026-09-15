# Does `dev.convex:android-convexmobile:0.8.0` cover what the sync layer needs?

Research for [issue #14](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/14), part of the
Kotlin migration map ([#13](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/13)).

Date: 2026-09-15. Repo state: `main` @ `ba59163` (v3.28.1). All library claims are from the published
docs, the `get-convex/convex-mobile` and `get-convex/convex-rs` sources, the GitHub API, and Maven Central,
read on this date.

## Summary

The ticket assumes the sync layer is built on a Convex client. **It is not.**
`apps/native/src/sync/syncEndpoints.ts` uses bare `fetch` against `*.convex.site` HTTP actions, and
`apps/native/src/sync/v2/endpoints.ts` does the same. Zero lines of the 6,238-LOC sync layer touch
`convex/react` or `ConvexReactClient`. So the question splits:

1. **For the sync layer**, `android-convexmobile` is not needed and cannot help — it has no HTTP-action
   support at all. What is needed is OkHttp/Ktor plus a JWT.
2. **For the rest of the app** — 28 `useQuery`/`useMutation`/`useAction` call sites in 13 files — the
   client covers queries, mutations and actions, but its subscription model is materially coarser than
   both WatermelonDB _and_ the JS Convex client, and it does not support Convex Auth, which is what this
   backend uses.
3. **There is a third option the ticket did not consider**: Convex's documented plain HTTP API
   (`POST /api/query|mutation|action|run`) covers all 28 call sites with the same OkHttp stack and the
   same Bearer token, with no client library at all.

Verdict, in full at §5: **NO-GO on hand-rolling the protocol. Conditional GO on the official client —
it works, but nothing in this migration requires it, and the pre-1.0 evidence argues against taking the
dependency for v1.** Ship on plain HTTP; adopt the client later if a screen earns it.

---

## 1. What the current layer actually requires

Read from the code, not inferred.

### 1.1 Pull is plain HTTP; pagination is entirely server-side

`packages/backend/convex/http.ts` routes ten POST endpoints on `.convex.site`: `/sync/registerDevice`,
`/sync/pull`, `/sync/push`, and seven `/sync/v2/*`.

In `packages/backend/convex/sync.ts`:

- `syncPull` is an `httpAction` (line 422) calling `syncPullPage`, an `internalAction` (line 338).
- `pullTablePage` is an `internalQuery` (line 248) calling `.paginate({ cursor, numItems: TABLE_PAGE_SIZE })`
  on `by_store_updatedAt`.
- `TABLE_PAGE_SIZE = 250` (line 143); `PER_REQUEST_ROW_BUDGET = 1500` (line 146).
- 17 tables in `SYNC_TABLES`, 15 store-scoped with declared FK field lists.

Client side, `apps/native/src/sync/syncEndpoints.ts` is three functions — `callPull`, `callPush`,
`callRegisterDevice` — each a `POST` with `Content-Type: application/json` and `Authorization: Bearer`.
The host is derived by string replacement:

```ts
const SITE_URL = CLOUD_URL.replace(".convex.cloud", ".convex.site");
```

**Every cursor is an opaque JSON string in the request body.** The client never calls a Convex pagination
API and never has. `SyncManager.syncOnce()` runs WatermelonDB's `synchronize()` once per server page,
threading `cursors` and `serverNow` through closure variables (`SyncManager.ts:302-465`).

### 1.2 Push is one HTTP call with app-level idempotency

`callPush` posts `{ lastPulledAt, changes, clientMutationId }` plus an `x-device-id` header
(`syncEndpoints.ts:65`). `syncPushCore` (`sync.ts:530`) dedupes on `clientMutationId` against
`syncedMutations` by index before doing anything else (`sync.ts:541-545`).

Order numbers come from `syncDevices.orderNumberCounters` — `v.optional(v.record(v.string(), v.number()))`
(`schema.ts:604`) — incremented in place, bootstrapped once via `by_store_orderNumber` (`sync.ts:754-795`).

**The push protocol already gives at-least-once delivery with exactly-once server effect, independent of
any client library.** Retry and backoff are the app's: `RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000]`
(`SyncManager.ts:50`), `scheduleRetry()` (`SyncManager.ts:535`).

### 1.3 Observation granularity is three-axis and local

`apps/native/src/db/useObservable.ts` composes three independent narrowing mechanisms:

1. **Row predicate**, evaluated locally — `Q.where("store_id", storeId), Q.where("status", "open")`
   (`useTables.ts:66-76`), `Q.where("order_id", Q.oneOf(orderIds))` (`useTables.ts:87-90`).
2. **Column whitelist** — `query.observeWithColumns(columns)` (`useObservable.ts:45`), e.g.
   `TABLE_ITEM_COUNT_COLUMNS = ["order_id", "quantity", "is_voided"]` (`useTables.ts:48`). A write to any
   other column of a matching row does **not** re-emit.
3. **Screen-focus gating** — `useScreenQueryActive()` (`useObservable.ts:11`) unsubscribes on blur.

`docs/investigations/2026-09-08-tablet-incoming-data-performance.md` records what happens when axis 1 is
missing: unbounded `order_items` observers did work linear in _total local history_ for unchanged visible
output (100 → 10,000 → 100,000 rows inspected, 10 visible). Hotfix 3.27.2 fixed it by adding predicates,
not by changing the observation mechanism.

### 1.4 Live Convex usage outside the sync layer

28 call sites, 13 files:

| Kind          | Count | Examples                                                                                    |
| ------------- | ----- | ------------------------------------------------------------------------------------------- |
| `useQuery`    | 15    | `api.sessions.getCurrentUser`, `api.reports.*`, `api.stores.get`, `api.ping.ping`           |
| `useMutation` | 7     | `api.screenLock.screenLock`, `api.reports.generateDailyReport`, `api.closing.logDayClosing` |
| `useAction`   | 6     | `api.screenLockActions.screenUnlock`, `api.appUpdate.checkForUpdate`, `api.users.verifyPin` |

No `usePaginatedQuery` anywhere in `apps/native`. Notably, **none of the 15 queries needs sub-second
push reactivity** — they are settings, session, catalog, store config, day-closing reports, and a
connectivity ping. Order/table/product data does not come from Convex queries at all; it comes from the
local WatermelonDB replica.

### 1.5 Auth

`packages/backend/convex/auth.ts` uses `convexAuth({ providers: [CustomPassword] })` from
`@convex-dev/auth@^0.0.90` — Convex Auth, not Auth0 or Clerk. `auth.config.ts` makes the deployment its
own OIDC issuer (`domain: process.env.CONVEX_SITE_URL, applicationID: "convex"`). The token reaches the
sync layer via `SyncBootstrap.tsx:46`, wiring `useAuthToken()` into `setAuthTokenFn`.

### 1.6 Schema shape relevant to serialization

`packages/backend/convex/schema.ts`, 28 tables:

| Validator                                      | Count |
| ---------------------------------------------- | ----- |
| `v.optional(`                                  | 125   |
| `v.number(`                                    | 112   |
| `v.id(`                                        | 60    |
| `v.literal(`                                   | 37    |
| `v.union(`                                     | 19    |
| `v.boolean(`                                   | 15    |
| `v.object(` (nested)                           | 9     |
| `v.array(`                                     | 3     |
| `v.record(`                                    | 1     |
| `v.int64(` / `v.bytes(` / `v.any(` / `v.null(` | **0** |

**Zero `v.int64`.** Every numeric field — all money, all timestamps — is `v.number`, i.e. float64. Hold
that thought for matrix row 14. Deepest nesting is
`openingHours: v.optional(v.object({ monday: v.object({ open, close }), ... }))` (`schema.ts:77-84`).

---

## 2. Capability matrix

| #   | Capability needed                                        | Verdict                                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Workaround cost                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Paginated pull via HTTP action (`/sync/pull`)            | **ABSENT from the client; SUPPORTED by plain HTTP**    | HTTP actions are _"exposed at `https://<your deployment name>.convex.site`"_ and the docs demonstrate `curl`/`fetch` with no client library ([HTTP Actions](https://docs.convex.dev/functions/http-actions)). In convex-mobile, a recursive grep for `convex.site`, `httpAction`, `OkHttp`, `Ktor` returns **zero matches** in any source, doc or build file; the FFI surface (`rust/src/convex-mobile.udl`) is `query`, `subscribe`, `mutation`, `action`, `set_auth`, `set_auth_callback` — WebSocket sync protocol only. The client is only ever given a `.convex.cloud` URL.                                                                                                                                                                     | **None.** Port `syncEndpoints.ts` (74 LOC) + `v2/endpoints.ts` (95 LOC) to OkHttp. The `.convex.cloud` → `.convex.site` derivation carries over verbatim.                                                                                                                                                                                                                   |
| 2   | Client-side pagination API                               | **ABSENT — and not needed**                            | Full read of [`ConvexClient.kt`](https://github.com/get-convex/convex-mobile/blob/main/android/convexmobile/src/main/java/dev/convex/android/ConvexClient.kt) (416 lines): the public surface is `subscribe`, `action`, `mutation`, `webSocketStateFlow`, plus `login`/`loginFromCache`/`logout`/`authState` on `ConvexClientWithAuth`. Repo-wide grep for `paginate                                                                                                                                                                                                                                                                                                                                                                                 | paginated                                                                                                                                                                                                                                                                                                                                                                   | cursor`hits only test fixtures passing`paginationOpts`as an ordinary arg. convex-rs has no pagination file; the npm client has`paginated_query_client.ts`and`pagination.ts`. Docs scope it to React: *"Using the `usePaginatedQuery` React hook"\* ([Pagination](https://docs.convex.dev/database/pagination)). | **Zero.** All `.paginate()` calls live in `pullTablePage`; cursors are opaque strings on the wire.                                                        |
| 3   | Push with per-device order-number counters               | **SUPPORTED**                                          | `syncPush` is an `httpAction`, so row 1 applies. The counter is entirely server-side in `syncDevices`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | None.                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | Actions                                                  | **SUPPORTED** (three ways)                             | `ConvexClient.action()` exists in source and docs, with the caveat _"Even though you can call actions from Android, it's not always the right choice."_ ([Android Kotlin](https://docs.convex.dev/client/android/overview)). Also reachable over `POST /api/action` (row 17).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | None for the 6 `useAction` sites.                                                                                                                                                                                                                                                                                                                                           |
| 5   | Reactive subscriptions — emission volume                 | **PARTIAL, and worse than the JS client**              | See §3. In short: every `Transition` re-emits **every** subscription on the client, whole result set, JSON round-tripped, no dedup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Medium — `.distinctUntilChanged()` after full decode, and keep subscriptions per client low. Or don't subscribe (row 17).                                                                                                                                                                                                                                                   |
| 6   | Column-aware observation (`observeWithColumns`)          | **ABSENT**                                             | Convex reactivity is read-set invalidation — _"`"dataChange"`: a rerun of a query whose subscription was invalidated by a write"_ ([log streams](https://docs.convex.dev/production/integrations/log-streams/)); _"Convex tracks the dependencies to your query functions, including database changes, and triggers the subscription in the client libraries"_ ([Realtime](https://docs.convex.dev/realtime)). The server re-runs the whole query and pushes the whole result ([How Convex Works](https://stack.convex.dev/how-convex-works)). No column granularity exists in the model at any layer.                                                                                                                                               | High **if** used as the UI data path. **Zero** if the local DB keeps owning UI observation, which is the recommendation (issue #15).                                                                                                                                                                                                                                        |
| 7   | Screen-focus subscription gating                         | **PARTIAL — and currently crash-prone**                | Not a client feature; `Flow` collection is cancellable, so `repeatOnLifecycle(STARTED)` reproduces it. **But** convex-mobile [issue #24](https://github.com/get-convex/convex-mobile/issues/24) (opened 2026-09-03, **0 comments**) reports that an error delivered while the collector is cancelling _"escapes as an uncaught exception on the callback thread and kills the whole process"_, and that _"No app-side operator (`.catch {}`, `retryWhen`, `runCatching` around `collect`) can intercept it"_. The reporter's trigger — expired token on morning reopen + cancel/re-open subscriptions — is exactly a POS tablet's daily pattern.                                                                                                     | High while unfixed. The reporter's own mitigation is a global `UncaughtExceptionHandler` that swallows `ConvexError` frames originating in JNA `CallbackReference$DefaultCallbackProxy`. That is not something to ship under a cash drawer.                                                                                                                                 |
| 8   | WebSocket drop / reconnect / resume                      | **PARTIAL**                                            | _"The connection is either in `CONNECTED` or `CONNECTING` state, as Convex always tries to maintain a connection"_; `webSocketStateFlow` since 0.7.0. 0.8.0 fixed _"a bug in the Rust client ... that prevented reliable re-auth after reconnect"_. `convex-rs` [#14](https://github.com/get-convex/convex-rs/issues/14) (_"Client can get into bad state on disconnect/reconnect"_, `"Base version 0 passed up doesn't match the current version 1"`) was opened by a maintainer 2026-02-11 and closed 2026-02-17; `convex-rs` #9 _"Operations Hang on a Bad Connection"_ closed 2025-09-02.                                                                                                                                                        | Low-medium. The sync layer has its own `subscribeToNetworkChanges` + backoff and never depends on the WebSocket.                                                                                                                                                                                                                                                            |
| 9   | In-flight mutations across a disconnect                  | **PARTIAL — retries forever, no documented guarantee** | From `convex-rs/src/client/worker.rs`, on reconnect the client calls `resend_ongoing_queries_mutations()`, and `request_manager.rs::restart()` replays the identical `ClientMessage` with the same `request_id: SessionRequestSeqNumber`. So: retried automatically and indefinitely with 100 ms→15 s backoff, ordering preserved, queued **in memory only** (process death loses it), and the `suspend fun mutation(...)` **blocks for the whole outage with no timeout**. The exactly-once wording in the docs is scoped to the **React** client: _"Convex React automatically retries mutations until they are confirmed... every mutation call only executes once"_ ([Convex React](https://docs.convex.dev/client/react/)). A grep for `idempot | at-least-once                                                                                                                                                                                                                                                                                                                                                               | exactly once                                                                                                                                                                                                                                                                                                    | dedup`across`convex-rs/src`and`sync_types/src`finds nothing. Server-side dedup by`SessionRequestSeqNumber` is **implied by the design but undocumented**. | **Zero for the sync layer** — idempotency is already app-level (`clientMutationId`). For live mutations, carry your own idempotency key in the args rather than trusting the session sequence number, and wrap in `withTimeout`. |
| 10  | Offline-first operation                                  | **ABSENT**                                             | Convex handles _"intermittent network blips"_ but _"doesn't currently provide a full offline sync mechanism"_. Nothing in convex-mobile or convex-rs persists anything to disk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Zero — this is exactly why `apps/native/src/sync` exists, and why it must be reimplemented (issue #15) regardless of this decision.                                                                                                                                                                                                                                         |
| 11  | `v.id("table")` serialization                            | **SUPPORTED, untyped**                                 | Ids travel as JSON strings; the docs' own sample is `data class ConvexDocument(@SerialName("_id") val id: String)` ([data types](https://docs.convex.dev/client/android/data-types)). There is no `Id<T>` wrapper — you get a bare `String` with no table binding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | None. 60 fields become `String`; add your own inline value classes if you want the type safety TS gives today.                                                                                                                                                                                                                                                              |
| 12  | `v.optional` — absent vs `null`                          | **PARTIAL — confirmed hazard**                         | `jsonhelpers.kt` maps `null -> JsonNull` in all three `toJsonElement()` overloads: an explicit Kotlin `null` is **sent as JSON `null`, not omitted**. Convex's `v.optional(v.string())` accepts absent-or-string, not `null` — so a nulled optional is a validation error. (Nested nulls were silently _dropped_ before 0.8.0; PR #15 fixed that, shipping in 0.8.0.) On decode, the client sets `Json { ignoreUnknownKeys = true; allowSpecialFloatingPointValues = true }`; an omitted optional throws `MissingFieldException` unless the Kotlin property has a default.                                                                                                                                                                           | **Low per field, wide surface — 125 fields.** Rule: build args as `Map<String, Any?>` and **omit** keys rather than setting them null; declare every optional as `val x: T? = null` on decode. One shared helper plus a round-trip test per table.                                                                                                                          |
| 13  | Nested objects / arrays                                  | **SUPPORTED**                                          | Convex `Array` → `List<T>`, `Object` → `@Serializable` data class. `jsonhelpers.kt` recurses through maps and lists; non-`String` map keys are **silently skipped** (`val key = it.key as? String ?: return@forEach`), and unsupported types throw `IllegalArgumentException`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | None. 9 nested objects, 3 arrays, max depth 2.                                                                                                                                                                                                                                                                                                                              |
| 14  | Numbers — **the money landmine**                         | **PARTIAL — high consequence**                         | Docs warn: _"There are important gotchas when sending and receiving numbers between Kotlin and Convex"_, and _"anytime you get a plain `number` from Convex it will be represented as floating point in Kotlin. You can choose to use `Double` or `Float` ... be aware that `Float` might lose precision."_ Worse, the **send** path is asymmetric: `jsonhelpers.kt` encodes **every Kotlin `Int` and `Long` as a Convex Int64** (`mapOf("$integer" to Base64.encode(...))`). So `mapOf("qty" to 2)` sends an Int64, which a `v.number()` validator rejects — and this schema has **zero `v.int64` fields and 112 `v.number` fields**. `Int` and `Int64` are indistinguishable on the Kotlin send side.                                              | **Medium.** Every numeric arg must be sent as `Double` (`2.0`, not `2`). Decode with `@ConvexNum`/`Float64` or the `@file:UseSerializers(...)` form. Ban `Float` outright. This compounds with issue #19 (money math parity) and needs a shared fixture suite. Row 17 sidesteps it entirely — the plain HTTP API sends ordinary JSON numbers.                               |
| 15  | `v.record(v.string(), v.number())`                       | **SUPPORTED**                                          | One field (`orderNumberCounters`), server-side only; the tablet never decodes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | None.                                                                                                                                                                                                                                                                                                                                                                       |
| 16  | Convex Auth (`@convex-dev/auth`)                         | **ABSENT**                                             | The Android page documents Auth0 (`convex-android-auth0`), Clerk (`clerk-convex-kotlin`), or a custom `AuthProvider` for OIDC providers, via `ConvexClientWithAuth`. Convex Auth's own setup docs list React (Vite), Next.js and React Native — **no Android, Kotlin, Swift or iOS** ([Convex Auth setup](https://labs.convex.dev/auth/setup)).                                                                                                                                                                                                                                                                                                                                                                                                      | **Medium — the largest genuine gap, and it exists in every option.** The deployment is its own OIDC issuer, so you call the `auth:signIn` action with the Password provider and persist/rotate the refresh token yourself. Both the sync layer and any live calls need only the raw JWT string, so `getSyncAuthToken()` maps onto whatever you build. Tracked as issue #16. |
| 17  | _(alternative)_ Plain HTTP for queries/mutations/actions | **SUPPORTED**                                          | Convex documents `POST /api/query`, `/api/mutation`, `/api/action` and `/api/run/{functionIdentifier}` on `.convex.cloud`, body `{path, args, format}`, response `{status, value, logLines}`, authenticated by _"a bearer token in a `Authorization` header. The value is `Bearer <access_key>`"_ ([HTTP API](https://docs.convex.dev/http-api/)). This is the documented surface for non-JS clients. Caveat: _"the `json` format does not support all Convex data types as input, and uses overlapping representation for several data types in output"_ — irrelevant here, since the schema uses no Int64 and no bytes.                                                                                                                            | Covers all 28 call sites with the same OkHttp stack and token as the sync layer. Cost: no push reactivity (refetch on focus/interval instead) and no automatic mutation retry — both of which this app either doesn't need or already implements itself.                                                                                                                    |

---

## 3. Subscription granularity — the finding that matters

The ticket flags this as decisive. It is, and the answer is worse than expected.

**Server side: read-set invalidation, whole-result push.** Convex records a query's read set in the
client's WebSocket session, walks the transaction log after the query's begin timestamp, and on overlap
**re-runs the entire query** and **pushes the full new result** ([How Convex Works](https://stack.convex.dev/how-convex-works)).
No diff. The log-stream schema names the reason explicitly: _"`"dataChange"`: a rerun of a query whose
subscription was invalidated by a write"_ ([log streams](https://docs.convex.dev/production/integrations/log-streams/)).
That part is fine and per-query.

**Client side: the Rust core computes what changed, then throws it away.** In
`convex-rs/src/base_client/mod.rs`, `ingest_query_results_from_server` builds a `changed_queries` map by
comparing `old_query.result != query.result`. But `receive_message` then returns the entire snapshot:

```rust
ServerMessage::Transition { end_version, .. } => {
    let changed_query_ids = self.on_query_result_changes(completed_requests)?;
    for (id, result) in changed_query_ids {
        self.state.latest_results.results.insert(id, result);
    }
    return Ok(Some(self.state.latest_results.clone()));   // ALL queries, not just changed
},
```

and `client/worker.rs` broadcasts that to every subscriber:

```rust
if let Some(subscriber_id_to_latest_value) = base_client.receive_message(msg)? {
    let _ = watch_sender.send(subscriber_id_to_latest_value);   // every subscription
}
```

`client/subscription.rs::poll_next` — the per-subscription filter — does no comparison against what it
last emitted; it just clones its slot out of the map.

**Consequence.** If one `ConvexClient` holds subscriptions to A, B and C and a write invalidates only C,
**A and B each re-emit their unchanged values.** Every `Transition` fans out to every subscription on the
client. The Kotlin layer adds nothing: `ConvexClient.subscribe()` is a `callbackFlow` whose `onUpdate`
does `trySend(Result.success(jsonApi.decodeFromString<T>(value)))` — **no `distinctUntilChanged`, no
equality check** — and the payload crosses the FFI as a re-serialized JSON `String`, so every emission
pays a full encode in Rust and a full parse in Kotlin.

**This is strictly coarser than the JS client**, which notifies only changed tokens
(`ingestQueryResultsFromServer` → `changedQueryTokens` → `handleTransition`). Two secondary hazards in the
same path: the `trySend` result is discarded, so bursts can silently drop updates (Convex's own comment:
_"Ok to be lagged (skip intermediate values)"_); and identical `(udfPath, args)` subscriptions **are**
coalesced into one server query, which is the one efficiency win here.

**Against WatermelonDB today:**

| Axis             | WatermelonDB                                                                         | Convex Android                                                              |
| ---------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Row predicate    | Arbitrary local `Q.where`/`Q.oneOf` against the on-device replica                    | Server query args only; each arg set is its own subscription and round trip |
| Column           | `observeWithColumns(["order_id","quantity","is_voided"])` — other columns are silent | None                                                                        |
| Identical result | Emits on membership or observed-column change                                        | None, and worse: unrelated queries' invalidations re-emit you too           |
| Lifecycle        | `useScreenQueryActive()` unsubscribes on blur                                        | `repeatOnLifecycle` — but see issue #24, cancellation is where it crashes   |

**Why this is survivable.** The 2026-09-08 investigation measured _unscoped local observation_ over
growing local history; 3.27.2 fixed it with predicates. That workload lives in the local DB. The tablet
holds **zero** Convex subscriptions on order data today. Keep a local store (Room/SQLDelight, issue #15)
fed by `/sync/pull` and Room's `Flow<List<T>>` restores the row-predicate and lifecycle axes; the column
axis is approximated with a narrow `@DatabaseView` or projected `SELECT` plus `.distinctUntilChanged()`.
Room invalidates per table, so it is coarser than `observeWithColumns` but far finer than anything Convex
offers.

**Why the inverse would be fatal.** Putting `ConvexClient.subscribe()` on the order/table/product UI path
regresses every axis at once and reproduces the September investigation's failure mode — now over the
network, at rush hour, on a Helio G88 with 4 GB of RAM. Do not do it.

---

## 4. Pre-1.0 risk

### 4.1 Release cadence — 0.8.0 is the latest, and it is seven months old

From Maven Central (`maven-metadata.xml`: `<latest>0.8.0</latest>`, `<lastUpdated>20260219170520</lastUpdated>`)
and the GitHub releases API:

| Version       | Published      | Gap                    |
| ------------- | -------------- | ---------------------- |
| 0.2.0         | 2024-08-21     | —                      |
| 0.3.0         | 2024-09-03     | 13 d                   |
| 0.4.0 / 0.4.1 | 2024-09-06     | 3 d / same day         |
| 0.5.0         | 2024-10-09     | 33 d                   |
| 0.5.1         | 2024-12-19     | 71 d                   |
| 0.6.0         | 2025-10-23     | **308 d**              |
| 0.6.1         | 2025-11-21     | 29 d                   |
| 0.7.0         | 2025-12-04     | 13 d                   |
| 0.7.1         | 2026-01-20     | 47 d                   |
| **0.8.0**     | **2026-02-19** | 30 d                   |
| —             | _today_        | **~208 d, no release** |

Repo metadata: `pushed_at 2026-02-20T15:20:28Z`, 24 stars, 10 open issues, `archived: false`, Apache-2.0.
**No commits in ~7 months.** There is precedent for recovery — the repo was equally dormant from
2024-12-19 to 2025-09-14 — so read this as a lull, not death. But it is a lull with an unanswered crash
report in it.

### 4.2 Breaking-change signals toward 1.0

- **No CHANGELOG exists** anywhere in the repo.
- **No stability, beta, or "subject to change" disclaimer** exists in the root README, `android/README.md`,
  or the docs page. The Android README says only: _"The official Android client for Convex... It builds on
  the Convex Rust client and offers a convenient Android API for executing queries, actions and mutations."_
  There is no semver statement, no deprecation policy, and no migration guide.
- **The one explicit breaking change is in 0.8.0 itself**: _"The `AuthProvider` interface was updated...
  **This is a breaking change that will require existing `AuthProvider` implementations to be updated.**"_
  Eleven 0.x releases, one documented break, no policy — assume more before 1.0, concentrated in exactly
  the area (auth) where this app has the most custom work to do.
- Adjacent signal from the docs' testing section: to test, _"you'll need to provide JSON in Convex's
  **undocumented** JSON format."_

### 4.3 Open issue quality

6 open issues, 4 closed (PRs excluded).

| #      | Title                                                                                                                                        | Opened     | Comments | Maintainer reply                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | -------------------------------- |
| **24** | Android: error delivered to `QuerySubscriber.onError` while the collector is cancelling escapes as an uncaught exception (**process crash**) | 2026-09-03 | **0**    | **none**                         |
| 21     | Use-after-free crash in `swift_unknownObjectRelease` (iOS)                                                                                   | 2026-07-23 | 0        | none                             |
| 20     | iOS xcframework missing Mac Catalyst slice                                                                                                   | 2026-07-23 | 0        | none                             |
| 18     | xcframework missing `x86_64-apple-darwin`                                                                                                    | 2026-03-10 | 1        | declined                         |
| 13     | Support Mac Catalyst                                                                                                                         | 2025-12-19 | 3        | deferred                         |
| 5      | Kotlin Multiplatform support                                                                                                                 | 2025-05-23 | 6        | _"not on the near term roadmap"_ |

Historically the maintainers (`dowski`, `nipunn1313`) reply fast and substantively. **The last maintainer
comment anywhere in the repo is 2026-07-13.** The three newest issues have zero replies, and #24 — a
reproducible process-killing crash on Android 0.8.0 — has been unanswered for 12 days.

Nobody has ever filed an issue about pagination or about subscription over-emission; §3's finding comes
from reading the source, not from a filed bug.

### 4.4 The Rust core, and whether it is shared with the TS client

**Confirmed: convex-mobile wraps `convex-rs` via UniFFI.** Root README: _"`rust/` - contains the wrapper
around `convex-rs` that exposes types for use via FFI"_. `rust/Cargo.toml` pins:

```toml
uniffi = { version = "0.28", features = ["cli"] }
convex = { version = "0.10.3", default-features = false, features = ["rustls-tls-webpki-roots"] }
```

**The pin is stale, and it leaks.** `convex` 0.10.3 shipped 2026-02-13; **0.10.4 shipped 2026-04-10** with:

```
# 0.10.4
- Optimizations to `check_valid_field_name` in `sync_types`
- Fix for memory leak in query subscriptions (get-convex/convex-rs#15)
- Bump rust-version minimum from 1.80.1 to 1.85
```

convex-rs #15: `LocalSyncState::remove_subscriber()` removes the `SubscriberId` from
`latest_results.subscribers` but not the matching entry in `latest_results.results`, so _"each distinct
query can leave behind one retained `FunctionResult` even after the final unsubscribe."_ Because
convex-mobile has had no commits since 2026-02-20, **`android-convexmobile:0.8.0` ships the leaky 0.10.3
core.** For a POS process that lives all day and opens/closes many distinct subscriptions, that is the
wrong bug to inherit.

**Is the Rust core the same core the TS client uses? No — independent implementations of one wire
protocol.** Three proofs: (a) `registry.npmjs.org/convex/latest` declares only `{ws, esbuild, prettier}`
— no native module, no WASM; (b) the npm package carries its own full sync client under
`npm-packages/convex/src/browser/sync/` (`client.ts`, `local_state.ts`, `remote_query_set.ts`,
`request_manager.ts`, `protocol.ts`, `web_socket_manager.ts`, `optimistic_updates_impl.ts`,
`paginated_query_client.ts`); (c) convex-rs's own source says so —

```rust
ServerMessage::TransitionChunk { .. } => {
    // The Rust client should never receive TransitionChunk messages
    // as this feature is only enabled for npm clients
    return Err("Unexpected TransitionChunk message received".to_string());
},
```

They do not even implement the same protocol feature set. **Nothing that gets fixed in the TS client
arrives here for free**, which is the single most important thing to understand about adopting this
library: the maturity of `convex` on npm tells you nothing about the maturity of this AAR.

### 4.5 Risk summary

| Risk                                                                | Severity   | Note                                                                         |
| ------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Unanswered process-crash bug (#24) on the cancel-subscription path  | **High**   | Fires on morning reopen with an expired token — a POS tablet's daily routine |
| Ships convex-rs 0.10.3 with a known subscription memory leak        | **High**   | Fixed upstream 2026-04-10, never pulled in                                   |
| Repo dormant 7 months; last maintainer reply 2026-07-13             | Medium     | Precedent for recovery, but no roadmap or CHANGELOG                          |
| Breaking changes with no policy; 0.8.0 already broke `AuthProvider` | Medium     | Concentrated in auth, where this app has the most custom work                |
| Client-wide subscription fan-out (§3)                               | Medium     | Strictly worse than the JS client; mitigable                                 |
| `Int` → Int64 on the send path vs 112 `v.number` fields             | Medium     | Silent validation failures on money/quantity args                            |
| Two maintainers, 24 stars                                           | Low-medium | Bus factor                                                                   |

---

## 5. Go / no-go

### NO-GO: hand-rolling HTTP + WebSocket against the Convex protocol

Not close. The sync protocol is versioned, not published as a public contract, and involves
`ModifyQuerySet` base-version bookkeeping whose edge cases broke Convex's own Rust client
(`convex-rs` #14). Meanwhile the part this app genuinely depends on — HTTP actions — needs no protocol
work at all. Hand-rolling would mean owning the hard half to avoid the easy half.

### GO, conditionally: the official client is usable, but this migration does not need it

The honest reading of the evidence is that `android-convexmobile` is a competent, officially maintained
wrapper that is **currently in a bad patch**: dormant seven months, shipping a leaky core, with an
unanswered process-death bug on the subscription-cancellation path. None of that is fatal for a narrow
role. All of it is avoidable, because **nothing in this app requires the WebSocket client.**

**Recommended shape:**

1. **Sync layer → plain HTTP, no library.** Port `syncEndpoints.ts` + `v2/endpoints.ts` to OkHttp +
   kotlinx-serialization (~170 LOC). Officially documented, stable, and it keeps the offline pipeline free
   of a pre-1.0 native dependency. Everything that makes the layer correct — pagination cursors, the
   1500-row budget, `clientMutationId` idempotency, `orderNumberCounters` — is server-side and unchanged.
2. **The 28 live call sites → `POST /api/query|mutation|action`** on the same OkHttp stack and token
   ([HTTP API](https://docs.convex.dev/http-api/)). None of the 15 queries needs push reactivity; refetch
   on focus or on the existing 60 s timer. This also sidesteps rows 5, 7, 12 and 14 entirely — plain JSON
   numbers, no FFI, no callback threads, no Int64 ambiguity, no `callbackFlow` cancellation race.
3. **Auth → real work either way (issue #16).** Convex Auth has no Android story. Implement `signIn`
   against the deployment's own OIDC issuer and own the refresh-token rotation. Both options need only the
   raw JWT, so `getSyncAuthToken()` maps cleanly onto it.
4. **Local DB owns UI observation (issue #15).** Never put `ConvexClient.subscribe()` on the
   order/table/product path — §3.
5. **Revisit the client when a screen earns it.** If a genuine push-reactive requirement appears (live
   kitchen display, cross-tablet table locking), adopt `android-convexmobile` for that one screen, gate it
   behind a flag, and re-check: has convex-rs been bumped past 0.10.4? Has #24 been answered?

**What this costs versus adopting the client now:** you give up push reactivity on 15 queries that do not
need it, and automatic mutation retry on 7 mutations, for which you want your own idempotency key anyway
(row 9). **What it buys:** one HTTP stack, one auth path, one serialization model, zero native/JNA
surface, and no exposure to a dormant pre-1.0 AAR on the critical path of a system that takes money.

### Residual risks to accept, in order

1. **Convex Auth on Android** — no first-party support. Medium, blocking, unavoidable in every option. Issue #16.
2. **Money-math parity across TS and Kotlin** — `Double` discipline over 112 `v.number` fields. Issue #19.
3. **`v.optional` vs explicit `null`** across 125 fields — omit keys, don't null them. One helper plus
   round-trip tests.
4. **Losing `observeWithColumns`** — Room invalidates per table. Measure on the VistaTab before assuming
   it is fine (issue #18's baseline is the right instrument).

---

## Sources

All read 2026-09-15.

**Convex docs** — [Android Kotlin](https://docs.convex.dev/client/android/overview) ·
[Kotlin type conversion](https://docs.convex.dev/client/android/data-types) ·
[HTTP actions](https://docs.convex.dev/functions/http-actions) ·
[HTTP API](https://docs.convex.dev/http-api/) ·
[Pagination](https://docs.convex.dev/database/pagination) ·
[Convex React](https://docs.convex.dev/client/react/) ·
[Realtime](https://docs.convex.dev/realtime) ·
[Log streams](https://docs.convex.dev/production/integrations/log-streams/) ·
[OCC](https://docs.convex.dev/database/advanced/occ) ·
[Convex Auth setup](https://labs.convex.dev/auth/setup)

**Convex engineering** — [How Convex Works](https://stack.convex.dev/how-convex-works) ·
[Introducing Convex for Android](https://stack.convex.dev/introducing-convex-for-android)

**Source and registries** — [get-convex/convex-mobile](https://github.com/get-convex/convex-mobile)
(`ConvexClient.kt`, `jsonhelpers.kt`, `rust/Cargo.toml`, `rust/src/convex-mobile.udl`, releases, issues
via the GitHub API) · [get-convex/convex-rs](https://github.com/get-convex/convex-rs)
(`base_client/mod.rs`, `client/worker.rs`, `client/subscription.rs`, `base_client/request_manager.rs`,
CHANGELOG, issues #9/#14/#15) ·
[Maven Central](https://central.sonatype.com/artifact/dev.convex/android-convexmobile) and
`repo1.maven.org/.../maven-metadata.xml` · `registry.npmjs.org/convex/latest` ·
`crates.io/api/v1/crates/convex/versions`

**This repo** — `packages/backend/convex/{sync.ts,http.ts,schema.ts,auth.ts,auth.config.ts}` ·
`apps/native/src/sync/{SyncManager.ts,syncEndpoints.ts,SyncBootstrap.tsx,v2/endpoints.ts}` ·
`apps/native/src/db/useObservable.ts` · `apps/native/src/sync/dataSources/{useTables,useProducts}.ts` ·
`docs/investigations/2026-09-08-tablet-incoming-data-performance.md`
