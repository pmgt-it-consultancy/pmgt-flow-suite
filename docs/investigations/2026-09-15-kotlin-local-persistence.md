# Kotlin local persistence: what replaces WatermelonDB

Date: 2026-09-15
Status: research for [#15](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/15); no code changes. Part of the map in [#13](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/13).

## Executive conclusion

**Recommendation: SQLDelight** — decided on cutover risk, not on reactivity, where Room and SQLDelight
are near enough to equivalent. SQLDelight checks nothing but `PRAGMA user_version` when it opens a
database, and WatermelonDB already writes its schema version there, so the file now on the tablets can
be opened as-is. Room validates every column's type affinity against the entity declaration, and
WatermelonDB declares all 215 columns with no type at all, which nothing on the entity side can fix
and no SQLite `ALTER` can repair. Room therefore forces a one-time ETL or a 20-table rewrite onto
devices that may be holding unsynced sales. That decision belongs to
[#21](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/21); choosing Room now would make
it by default, in the most expensive direction. §6.3 states plainly what would flip this.

The reactivity question in #15 is really three questions, and separating them changes the answer.
WatermelonDB's `observeWithColumns` narrows on two axes at once: **what wakes an observer** (a
per-record in-JS matcher over the changeset, never a re-query) and **what reaches the UI** (membership
or named-column change). Room and SQLDelight are coarser on the first axis only.

- The **emit gate is recoverable, and the replacement is strictly better**: `.distinctUntilChanged()`
  over a projected Kotlin data class subsumes both halves of `observeWithColumns`, and unlike it
  cannot drift from what the UI actually reads. On the highest-frequency write in the system — a sync
  echo-back touching only `server_id` and `updated_at`, which the `CLAUDE.md` invariants make
  mandatory on every write — both designs emit zero times.
- The **recompute regression is real and irreducible**: both libraries re-execute the query. For the
  bounded queries the app ships today that costs roughly 8 extra indexed reads per applied sync page,
  on a background thread instead of the JS thread. That is affordable.
- **But it amplifies unbounded queries rather than merely repeating the 2026-09-08 bug.** Under
  WatermelonDB an unbounded query is paid once at subscribe; under a re-executing primitive it is
  paid on every invalidation — for the pre-3.27.2 `useTables` code during an initial sync, roughly
  6.7M rows inspected instead of 100,000. The bounded-query discipline is a _precondition_ for this
  migration, and should be enforced by `EXPLAIN QUERY PLAN` assertions rather than left as convention.

On trigger-level narrowing the two libraries differ, and it is the one place SQLDelight has a
capability Room does not: its `addListener`/`notifyListeners` take unvalidated free-form `String`
keys, so an application-defined key such as `"order_items:order=<id>"` is expressible if measurement
ever demands it.

Rebuild cost for the persistence layer and the read models on top of it — replacing ~2,400 TS LOC
(`src/db`'s 1,023 plus ~1,400 of `sync/dataSources`) — is **~1,470 lines for SQLDelight**
(~740 of them declarative SQL) or **~1,820–2,070 for Room**. Both are smaller than what they replace,
because joins, `ORDER BY` and `LIMIT` become available and absorb the JS projection layer that
WatermelonDB's fast observation path forbids. The schema itself is mechanical: 368 lines of `.sq`
DDL or 448 lines of Room entities, both generated directly from `schema.ts`.

## 1. The baseline: what WatermelonDB actually does today

All claims here are read off the installed copy, `@nozbe/watermelondb@0.28.0`, and the app source at `ba59163` (v3.28.1).

### 1.1 Size and shape of what gets replaced

| Area                                               |       LOC | Notes                                                            |
| -------------------------------------------------- | --------: | ---------------------------------------------------------------- |
| `apps/native/src/db/models/`                       |       445 | 20 model classes + barrel                                        |
| `apps/native/src/db/schema.ts`                     |       346 | 20 tables, 215 declared columns, 50 indexed columns              |
| `apps/native/src/db/migrations.ts`                 |        58 | 2 steps (v1→2, v2→3); current `SCHEMA_VERSION = 3`               |
| `apps/native/src/db/database.ts` + `index.ts`      |        36 | JSI adapter singleton                                            |
| `apps/native/src/db/useObservable.ts`              |        58 | the entire observation layer                                     |
| `apps/native/src/db/useObservable.test.tsx`        |        63 | focus/blur subscription lifecycle                                |
| `apps/native/src/db/testing/createTestDatabase.ts` |        17 | in-memory LokiJS adapter                                         |
| **`src/db` total**                                 | **1,023** | matches the figure quoted in #15                                 |
| `apps/native/src/sync/dataSources/`                |     2,096 | 43 observations, 31 observed-column sets, read-model projections |

Writers sit outside `src/db`: `orderMutations.ts` (472), `voidMutations.ts` (455),
`orderTotals.ts` (158), `recalculateOrder.ts` (147), `checkoutMutations.ts` (119).

### 1.2 Observations per table

| Table         | Live observations |     | Table                                  | Live observations |
| ------------- | ----------------: | --- | -------------------------------------- | ----------------: |
| `order_items` |                 8 |     | `order_item_modifiers`                 |                 3 |
| `orders`      |                 7 |     | `stores`                               |                 2 |
| `tables`      |                 5 |     | `order_discounts`                      |                 2 |
| `products`    |                 5 |     | `modifier_group_assignments`           |                 2 |
| `categories`  |                 4 |     | `order_voids` / `order_payments`       |            1 each |
| `users`       |                 3 |     | `modifier_groups` / `modifier_options` |            1 each |

### 1.3 The emission rule, precisely

`useObservable` (`src/db/useObservable.ts:45`) calls `query.observeWithColumns(columns)` when an
observed-column list is supplied, else `query.observe()`. All 43 call sites supply a column list.

`observeWithColumns` resolves to `observation/subscribeToQueryWithColumns/index.js`. Its contract,
quoted from the source comment at line 26:

> Emits a list of records when:
>
> - source observable emits a new list
> - any of the records in the list has any of the given fields changed

The gate is line 129:

```js
var shouldEmit =
  firstEmission ||
  hasPendingColumnChanges ||
  !identicalArrays(records, observedRecords);
```

`hasPendingColumnChanges` is set only when a record **already in the result set** changes one of the
listed columns (lines 91-101: look up `recordStates` by id, rebuild the column tuple, compare).
Rows not in the result set are skipped at line 92-94.

### 1.4 The part that matters more than the emission gate

WatermelonDB has two observation strategies, chosen by `encodeMatcher/canEncode.js`:

```js
var forbiddenError =
  "Queries with joins, sortBy, take, skip, lokiTransform can't be encoded into a matcher";
```

- **Encodable query** → `subscribeToSimpleQuery`. Runs the SQL **once**. Thereafter it subscribes to
  the collection changeset and calls `processChangeSet(changeSet, matcher, mutableMatchingRecords)`,
  which walks only the _changed_ records and applies an in-memory JS predicate
  (`subscribeToSimpleQuery/processChangeSet.js`). It returns `shouldEmit` only when set membership
  actually changed. **SQLite is never re-queried.**
- **Non-encodable query** → `subscribeToQueryReloading`, whose own header comment reads:

  > Produces an observable version of a query by re-querying the database when any change occurs in
  > any of the relevant Stores. This is inefficient for simple queries, but necessary for complex queries

  It subscribes to `query.allTables` and re-runs the whole query on any write to any of them.

**A grep for `Q.sortBy`, `Q.take`, `Q.skip` and `Q.on` across `apps/native/src` returns nothing.**
Every one of the 43 observations is matcher-encodable, so today _zero_ of them re-execute SQL on an
unrelated write. That is the real baseline, and it is stronger than "emits less often."

The price is visible in the read models: `useOrderHistoryList` (`useOrders.ts:542`) pulls the whole
date-window result set into JS and then does `.sort(...).slice(0, limit ?? 50)` in a memo, because
using SQL `ORDER BY`/`LIMIT` would have demoted the observer to the reloading path. The fine-grained
reactivity is _bought_ by forbidding joins, sorting and limiting in observed queries.

### 1.5 The one case where the column gate is load-bearing

`updated_at` and `server_id` appear in **zero** of the 31 observed-column constants. Meanwhile
`CLAUDE.md` makes stamping them mandatory:

> Every `ctx.db.patch()` on `orders` / `orderItems` / `orderItemModifiers` / `orderDiscounts` /
> `orderVoids` / `tables` MUST include `updatedAt: Date.now()`. Without it, the change is invisible
> to incremental pull.

WatermelonDB additionally maintains `_status` and `_changed` on every row
(`adapters/sqlite/encodeSchema/index.js:10`).

So the single most frequent write in the system — a sync echo-back that touches only `server_id`,
`updated_at`, `_status` and `_changed` — currently produces **no emission at all** on any of the 43
observers. Under a per-table invalidation primitive it would produce a re-query and a re-emit on
every observer of that table. This is the specific regression to design against, not "coarser
invalidation" in the abstract.

### 1.6 What the documented slowdown was actually caused by

`docs/investigations/2026-09-08-tablet-incoming-data-performance.md` reproduced 100,000 rows
inspected to display 10. Reading the findings list, the cause is named as unbounded **query
predicates** — `useTables.ts:79` "observes the entire local `order_items` collection", `useOrders.ts:531`
and `:606` likewise — and the fix shipped in 3.27.2 was to add predicates, not to change the
observation primitive:

> Implemented four bounded-query changes using existing indexes: Tables subscribe to items belonging
> to the current store's open orders. History subscribes to items belonging to orders in the selected
> store/date range. Checkout discount names load items only for the selected order.

This distinction decides the whole evaluation. The column gate limited _how often_ an O(total
history) memo ran; it never made that memo cheaper. A coarser trigger only reproduces the 2026-09-08
bug if the per-emission work is still unbounded. Push the projection into SQL and the O(N) term
disappears regardless of trigger granularity.

### 1.7 Write and transaction semantics to match

Writers use `database.write(async () => { ... db.batch(op1, op2, ...) })` with `prepareCreate` /
`prepareUpdate` / `prepareDestroyPermanently`. 9 `batch()` sites, 26 `prepare*` sites, 36 `write()` sites.

`orderMutations.ts:124` commits a line item, its modifiers and the parent order's `item_count` in a
single batch. `aggregateApply.ts:70` replaces one store's whole operational generation with
`database.batch(...deletions, ...creations)` inside one `write()`. Sync applies one WatermelonDB
`synchronize()` per server page (`SyncManager.ts:348`), so one transaction can carry up to the
per-request row budget (1,500 rows per `CLAUDE.md`).

ADR-0001 adds the hard requirement: _"a changed Order Aggregate becomes visible atomically."_

### 1.8 Test story to match

3 test files drive a real in-memory database via `createTestDatabase()` (LokiJS adapter, no native
module, no device): `orderMutations.test.ts`, `voidMutations.test.ts`, `sync/v2/__tests__/aggregateApply.test.ts`.
29 test files and ~94 test blocks total; 25 lines assert money fields.

These tests assert transaction _shape_, not just outcomes — `orderMutations.test.ts:72`:

```js
expect(batches[0]).toEqual(["order_items", "order_item_modifiers", "orders"]);
expect(batches).toHaveLength(2); // line transaction + recalculated totals
```

which works because the test spies on `mockDatabase.adapter.underlyingAdapter.batch`. Any Kotlin
replacement must let a JVM unit test both (a) run against an in-memory database and (b) observe
transaction boundaries.

### 1.9 On-disk format (for the in-place adoption question)

From `adapters/sqlite/encodeSchema/index.js`:

- Every table: `create table "<name>" ("id" primary key, "_changed", "_status", "<col>", ...)` —
  columns carry **no declared type**, so they have no SQLite type affinity except `id`.
- A `local_storage` table: `("key" varchar(16) primary key not null, "value" text not null)`. The
  declared width is decorative — SQLite does not enforce it, which is why the 27-character
  `__watermelon_last_pulled_at` key below fits.
- Indices named `"<table>_<column>"` for each indexed column, plus `"<table>__status"` on `_status`.
- Schema version lives in `PRAGMA user_version` — `native/shared/Database-sqlite.cpp:286-302`
  (`getUserVersion` / `setUserVersion`), called from `Database.cpp:96,111,114`. It should read `3`,
  since `schema.ts` declares `SCHEMA_VERSION = 3` and the adapter writes that value; this is inferred
  from the code path, not read off a device.
- File path on Android is `context.getDatabasePath("watermelon.db").getPath().replace("/databases", "")`
  (`native/android/.../WMDatabase.java:52`) — i.e. `/data/data/<pkg>/watermelon.db`, **not** the
  conventional `databases/` subdirectory.

### 1.10 Pending local work is also on disk, and also readable

This is the part of in-place adoption that ADR-0001 actually cares about ("never erase or silently
reinterpret pending sales, payments, voids, discounts, or closing operations"). The pending-write set
is not held in memory or in a queue — it is the `_status` / `_changed` columns:

- `_status` is one of `synced`, `created`, `updated`, `deleted`, `disposable` (`Model/index.js:161,201,341`).
  Deletions are soft until push confirms.
- `_changed` is a comma-separated list of changed column names, used for partial updates.
- Every table already carries an index on it — `"<table>__status"` (`encodeSchema/index.js:32`) — so
  `WHERE _status <> 'synced'` is an indexed read from any SQLite client.
- `SyncManager.ts:638` confirms these markers never cross the wire: `translateRow` strips every key
  beginning with `_` before push.

So a Kotlin app adopting the file can reconstruct the created/updated/deleted buckets that
WatermelonDB's `fetchLocalChanges` produces, without the tablet having to be sync-clean at cutover.
Whether it _should_ belongs to
[#21 — what happens to the data already on the tablets](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/21);
mechanically it is available.

The sync watermark is not in a table of ours: `@nozbe/watermelondb/sync/impl/index.js:23-24` stores
`__watermelon_last_pulled_at` and `__watermelon_last_pulled_schema_version` as rows in `local_storage`.
A Kotlin app that adopts the file in place can read that key and resume incremental pull instead of
forcing the full resync ADR-0001 specifically wants to retire.

### 1.11 One thing the Kotlin version gets for free

`database.ts:20` sets `jsi: true`, and the JSI adapter is synchronous — every matcher evaluation,
every column diff and every projection memo runs **on the JS thread**, the same thread React renders
on. Room and SQLDelight both expose queries as cold flows collected on a background dispatcher. Even
a strictly coarser invalidation primitive does its extra work off the UI thread, which is the thread
ADR-0001's "visible tap feedback under 100 ms" gate actually measures.

### 1.12 Query shapes to be reproduced

Across the 43 observations:

| Shape                                              | Count | Note                                                         |
| -------------------------------------------------- | ----: | ------------------------------------------------------------ |
| Equality predicates only                           |    25 | all on indexed columns except the `created_at` range filters |
| `IN (...)` driven by a previous query's result ids |     9 | two-step chains that exist only because joins are banned     |
| No predicate — whole table                         |     9 | `tables`, `products`, `users`, `stores` reference data       |

They feed exactly **17 exported read models** (`sync/dataSources/index.ts`). The 9 `IN (...)` chains
are artefacts of §1.4: with joins available they collapse into their parent query. `orders.created_at`
carries no index today, which the 2026-09-08 investigation lists as an open item.

One more reason joins matter here: the **local** schema does not carry `store_id` on `order_items`,
`order_item_modifiers`, `order_discounts` or `order_voids` — only `order_payments` has it. The
`CLAUDE.md` invariant that every child row stamps `storeId` is a _server_ rule; the tablet replica
scopes children through the parent order. So every store-scoped child read, and every bounded-replica
eviction ("delete children of orders no longer operational"), is inherently a join or subquery —
precisely the shape WatermelonDB demotes to `subscribeToQueryReloading`.

### 1.13 Observation fan-out is already bounded by screen focus

`useObservable` gates every subscription on `useScreenQueryActive()` (`useObservable.ts:30`), which
unsubscribes on React Navigation `blur` and resubscribes on `focus`. Of 15 screens, only the focused
one holds live observations. The worst single-screen fan-out is `useOrderDetail`: 8 observations
across 8 different tables (`orders`, `order_items`, `order_item_modifiers`, `order_discounts`,
`order_voids`, `tables`, `products`, `users`).

So the realistic question is not "43 observers stampede" but "up to 8 queries re-execute per applied
sync batch" — and under §1.11 they re-execute off the UI thread.

### 1.14 The reactive surface is shrinking, not growing

ADR-0001 moves order history out of the reactive local store. `useV2OrderHistory.ts` already
demonstrates the destination: it holds no observation at all, just a 250 ms-debounced
`HistoryGateway.searchHistory()` call against the server, with results in `useState`. The v2 replica
keeps whole order aggregates as JSON in `sync_v2_aggregates.payload` rather than as normalized rows.

So the reactive working set the Kotlin layer must serve is the bounded Operational Replica — ADR-0001
sizes it at roughly 40,000 operational order rows, against up to 100,000 historical _server_ orders.
Any argument about invalidation granularity should be evaluated at 40,000 local rows with indices,
not at the 100,000-row figure from the 2026-09-08 reproduction.

## 2. What the Kotlin layer has to provide

Distilled from §1, in priority order set by #13 ("dominant risk is money-correctness, not performance"):

1. **Transactional atomicity** over multi-table order writes — line item + modifiers + parent totals in
   one commit, and ADR-0001's "a changed Order Aggregate becomes visible atomically."
2. **In-memory JVM testability** with observable transaction boundaries, so `orderMutations.test.ts`
   and `voidMutations.test.ts` port as executable specification rather than being rewritten as
   device tests.
3. **Bounded per-emission work.** Not "few emissions" — bounded work per emission. This is the actual
   lesson of 2026-09-08.
4. **An emission gate that survives `updated_at`-only writes** (§1.5), because the sync invariants
   guarantee those are the most common write in the system.
5. **Schema/migration expression** for 20 tables / 215 columns / 50 indices, and enough control over
   database opening to make in-place adoption of `watermelon.db` at least possible (§1.9).

## 3. Room

Primary sources fetched 2026-09-15: the published sources JARs on Google's Maven
(`room-runtime-android-2.8.5-sources.jar`, `room3-runtime-android-3.0.3-sources.jar`,
`room-compiler-2.8.5-sources.jar`) and developer.android.com.

### 3.0 There are two Room lines now, and it matters

| Line         | Latest stable                                    | Artifacts                          | Status      |
| ------------ | ------------------------------------------------ | ---------------------------------- | ----------- |
| Room 2.x     | **2.8.5** (2026-09-09)                           | `androidx.room` / `room-runtime`   | maintenance |
| **Room 3.x** | **3.0.3** (2026-09-09); 3.0.0 shipped 2026-07-01 | `androidx.room3` / `room3-runtime` | active      |

Google's own announcement is explicit
([Modernizing Room](https://android-developers.googleblog.com/2026/03/room-30-modernizing-room.html)):

> Since the development of Room will be focused on Room 3, the current Room 2.x version enters
> maintenance mode. This means that no major features will be developed but patch releases … will
> still occur with bug fixes and dependency updates.

The setup guide now shows `androidx.room3:room3-runtime`. So "adopt Room" in 2026 means Room 3, and
Room 3 is a materially different surface: **KSP2 only (KAPT impossible), Kotlin-only codegen, every
DAO function `suspend` or `Flow`-returning, no `SupportSQLiteDatabase`/`Cursor`, no
`setQueryExecutor`/`setTransactionExecutor` (use `setQueryCoroutineContext`), `runInTransaction`
replaced by `withWriteTransaction`, and `InvalidationTracker.Observer` removed entirely.** For a
rewrite that is fine — there is no legacy Kotlin to port — but it does mean most Room material written
before mid-2026 describes a different API.

### 3.1 Invalidation is per table, and Google documents it as a limitation

The official guide says it plainly
([async queries](https://developer.android.com/training/data-storage/room/async-queries)):

> **Observable queries in Room have one important limitation: the query reruns whenever any row in
> the table is updated, regardless of whether that row is in the result set.**

The source shows why. `TriggerBasedInvalidationTracker.startTrackingTable` (identical in 2.8.5 and
3.0.3):

```kotlin
private val TRIGGERS = arrayOf("INSERT", "UPDATE", "DELETE")
private const val CREATE_TRACKING_TABLE_SQL =
    "CREATE TEMP TABLE IF NOT EXISTS room_table_modification_log (" +
        "table_id INTEGER PRIMARY KEY, invalidated INTEGER NOT NULL DEFAULT 0)"

connection.execSQL(
    "CREATE $tempKeyword TRIGGER IF NOT EXISTS `$triggerName` " +
        "AFTER $trigger ON `$tableName` BEGIN " +
        "UPDATE room_table_modification_log SET invalidated = 1 " +
        "WHERE table_id = $tableId AND invalidated = 0; " +
    "END")
```

**The trigger records one bit per table: `invalidated = 0|1`, keyed by `table_id`.** No rowid, no
column, no old/new values. Worth noting what is _not_ there: SQLite supports column-scoped update
triggers (`AFTER UPDATE OF col1, col2 ON t`), and Room does not use them — a grep of room-runtime
2.8.5, room3-runtime 3.0.3 and room-compiler for `UPDATE OF` returns zero hits. So the one mechanism
that could have given Room something like `observeWithColumns` is available in SQLite and unused.

The only public entry point is table-named:

```kotlin
@JvmOverloads
public fun createFlow(vararg tables: String, emitInitialState: Boolean = true): Flow<Set<String>>
```

`@param tables The name of the tables or views to track.`

### 3.2 What a DAO `Flow` actually does, and the one escape hatch

Generated DAO code calls `androidx.room.coroutines.FlowUtil.createFlow`:

```kotlin
public fun <R> createFlow(db: RoomDatabase, inTransaction: Boolean, tableNames: Array<String>,
                          block: (SQLiteConnection) -> R): Flow<R> =
    db.invalidationTracker.createFlow(*tableNames, emitInitialState = true)
        .conflate()
        .map { performSuspending(db, true, inTransaction, block) }
```

Three facts fall out, and they confirm §5's model exactly:

- **The query re-executes on every invalidation.** A downstream `distinctUntilChanged()` suppresses
  the _emission_, not the _re-query_.
- Room applies `.conflate()` but **not** `distinctUntilChanged()` — identical results still emit
  unless you add it. Google documents adding it yourself on the same page as the limitation quote.
- `emitInitialState = true`, so every Flow emits once on collection.

The escape hatch is that `invalidationTracker.createFlow(...)` is _public_ and returns
`Flow<Set<String>>` with **no query attached**. You can subscribe to raw table-name notifications and
decide yourself when and what to read — debounce, coalesce, or skip. It is not narrower than a table,
but it does decouple _being told_ from _re-querying_, which is the expensive half. Room's docs show
precisely this pattern:

```kotlin
db.invalidationTracker.createFlow("Artist").map { _ -> /* your own reads */ }
```

`InvalidationTracker.Observer` / `addObserver` / `removeObserver` offered the same table granularity
in Room 2.x and were **removed in Room 3.0**.

### 3.3 There is no periodic refresh interval — a common belief that is wrong

Room 2.2.6, 2.6.1, 2.8.5 and 3.0.3 contain **zero** occurrences of `postDelayed`,
`scheduleAtFixedRate`, `Timer` or `delay(` anywhere in the invalidation path. Refresh is purely
event-driven, coalesced by an `AtomicBoolean`:

```kotlin
private val pendingRefresh = AtomicBoolean(false)
internal fun refreshInvalidationAsync(...) {
    if (pendingRefresh.compareAndSet(expect = false, update = true)) {
        database.getCoroutineScope().launch(CoroutineName("Room Invalidation Tracker Refresh")) {
            notifyInvalidation()
        }
    }
}
```

So the only smoothing is this pending-refresh coalescing, `.conflate()` on the Flow, and one refresh
per outermost transaction (§3.5). The `mRefreshRunnable` people remember from the Java era is this
same runnable posted on demand, never on an interval. Nothing in 2.6 → 3.1 changed invalidation
granularity.

### 3.4 Which tables a query observes

room-compiler computes the observed set as every table the SQL parser finds, plus `@Relation` tables:

```kotlin
val tableNames = ((adapter?.accessedTableNames() ?: emptyList()) + query.tables.map { it.name }).toSet()
```

- **A JOIN observes every joined table.** Any write to any of them re-runs the query.
- **`@Relation` adds the related tables.**
- **`@DatabaseView` expands to its underlying tables** via a generated `_viewTables` map.
- **Only declared `@Entity` tables are trackable** — `validateTableNames` throws
  `IllegalArgumentException("There is no table with name $tableName")` otherwise.

This is the one place the "push projections into SQL" advice from §5 needs a caveat, and it applies
equally to SQLDelight: joining correlated tables is a win (one execution, one projection, indexed),
but joining _uncorrelated_ reference data into a hot query means catalog writes invalidate the order
view. Keep `products` / `users` / `stores` as separate flows.

### 3.5 Transactions — one invalidation per transaction, not per row

`RoomDatabase.internalPerform`:

```kotlin
if (!isReadOnly && !transactor.inTransaction()) invalidationTracker.sync()       // install triggers BEFORE
val result = transactor.withTransaction(type) { block.invoke(this) }
if (!isReadOnly && !transactor.inTransaction()) invalidationTracker.refreshAsync()  // check flags AFTER
```

with the decisive comment on the compat path:

> enqueue refresh only if we are NOT in a transaction. Otherwise, wait for the last endTransaction
> call to do it.

The trigger flips `invalidated = 1` idempotently (`WHERE table_id = N AND invalidated = 0`) inside
the transaction; one post-commit refresh reads and resets the flags. **N row writes to one table in
one transaction produce exactly one emission** — the same guarantee SQLDelight gives (§4.2), and what
today's `db.write { db.batch(...) }` gives (§1.7).

`@Insert`/`@Update`/`@Delete`/`@Upsert` always generate `inTransaction = true`, and
`EntityInsertAdapter.insert(connection, entities: Iterable<T>)` prepares the statement once and loops
`bind / step / reset`. So `@Insert fun insertAll(rows: List<Order>)` is one transaction, one prepared
statement, one emission. `@Upsert` has been stable since 2.5.0.

### 3.6 Schema validation, and why in-place adoption fails

`checkIdentity` runs on every open:

```kotlin
private suspend fun checkIdentity(connection: SQLiteConnection) {
    if (hasRoomMasterTable(connection)) {
        val identityHash: String? = /* SELECT identity_hash FROM room_master_table WHERE id = 42 */
        if (openDelegate.identityHash != identityHash &&
            openDelegate.legacyIdentityHash != identityHash) {
            error("Room cannot verify the data integrity. Looks like you've changed schema but " +
                  "forgot to update the version number. …")
        }
    } else {
        // No room_master_table, this might an a pre-populated DB, we must validate to see
        // if it's suitable for usage.
        val result = openDelegate.onValidateSchema(connection)
        if (!result.isValid) {
            error("Pre-packaged database has an invalid schema: ${result.expectedFoundMsg}")
        }
        openDelegate.onPostMigrate(connection); updateIdentity(connection)
    }
}
```

The `else` branch is genuinely promising: a foreign file with **no** `room_master_table` — exactly
`watermelon.db` — is schema-validated and, if it passes, **adopted in place**, with Room writing its
own identity hash afterwards. No copy, no data loss. So the whole question is whether
`onValidateSchema` passes.

It does not. `TableInfo.equalsCommon` compares `columns`, a plain `Map<String, Column>`, so map
equality is size-sensitive; `Column.equals` ends with `return affinity == other.affinity`; and
affinity for the database side comes from the declared type text:

```kotlin
internal fun findAffinity(type: String?): Int {
    if (type == null) return ColumnInfo.BLOB
    val uppercaseType = type.uppercase()
    if (uppercaseType.contains("INT")) return ColumnInfo.INTEGER
    if (uppercaseType.contains("CHAR") || uppercaseType.contains("CLOB") ||
        uppercaseType.contains("TEXT")) return ColumnInfo.TEXT
    if (uppercaseType.contains("BLOB")) return ColumnInfo.BLOB
    if (uppercaseType.contains("REAL") || uppercaseType.contains("FLOA") ||
        uppercaseType.contains("DOUB")) return ColumnInfo.REAL
    // SQLite returns NUMERIC here but it is like a catch all. We already
    // have UNDEFINED so it is better to use UNDEFINED for consistency.
    return ColumnInfo.UNDEFINED
}
```

Four blockers, in order of severity:

1. **Affinity — unfixable.** §1.9 established that WatermelonDB declares every column with no type.
   `PRAGMA table_info` returns `type = ""`, every branch falls through, and all 215 columns resolve to
   `ColumnInfo.UNDEFINED`. Room's expected affinity is always TEXT / INTEGER / REAL / BLOB, and you
   cannot declare `UNDEFINED` — room-compiler maps `ColumnInfo.UNDEFINED` to `null`, which falls back
   to the type adapter's affinity. **SQLite has no `ALTER COLUMN TYPE`,** so not even a `Migration`
   fixes this without CREATE-new / INSERT-SELECT / DROP / RENAME on every table.
2. **Nullable primary key — unfixable.** WatermelonDB's `"id" primary key` has `notnull = 0`;
   `Column.equals` compares `notNull`, and a nullable PK is a Room _compile_ error: _"You must
   annotate primary keys with @NonNull."_
3. **Extra columns** `_status` and `_changed` on every table — fixable by declaring them as fields.
4. **Explicit indices.** `readIndices` skips only auto-created indices (`if ("c" != origin) continue`),
   and WatermelonDB's `<table>_<column>` / `<table>__status` indices are explicit — fixable via
   `@Index(name = ...)`.

Two useful asymmetries: **extra tables are tolerated** (validation iterates declared entities only,
nothing sweeps `sqlite_master`), and **column order is irrelevant** (the widely repeated claim that it
matters is wrong — `columns` is a map).

There is one mechanical workaround: **pre-seed `room_master_table` yourself**, since a matching hash
short-circuits `onValidateSchema` permanently. The hash is available offline from the exported schema
JSON (`database.identityHash`, and verbatim in its `setupQueries`). This is undocumented, disables
Room's integrity check forever, and leaves Room generating SQL against affinity-mismatched columns
with no Google source describing the runtime behaviour. For a system whose dominant risk is
money-correctness, that is not a route to take.

**So Room's in-place answer is no.** The realistic Room path is a one-time ETL: open the old file with
a plain driver, read rows, insert through Room DAOs, delete the old file. That is a defensible plan —
it permanently fixes affinity and nullability and drops `_status`/`_changed` cleanly — but it is a
full data migration executed on tablets that may be holding unsynced sales, not an open.

One landmine to record while here: **Room 3 changed `fallbackToDestructiveMigration` to default
`dropAllTables = true`**, which enumerates `sqlite_master` and drops every table and view except
`sqlite_*` and `android_metadata` — including tables Room does not manage, such as WatermelonDB's
`local_storage` where the sync watermark lives (§1.10). Room 2.x's no-arg form meant "Room tables
only".

### 3.7 Tests — Room's strongest card, with one version caveat and one CI caveat

Google now explicitly discourages Robolectric
([testing docs](https://developer.android.com/training/data-storage/room/testing-db)):

> **We don't recommend Android local unit tests with Robolectric. Use local JVM tests using Room KMP
> instead.**

> With Room KMP, you can run database tests on your host development machine using local JVM JUnit
> tests. This setup lets your tests run faster by eliminating the overhead of an Android emulator or
> device.

> To help maintain consistency, use the `BundledSQLiteDriver`. This driver includes SQLite compiled
> from source, which uses the exact same version of SQLite on your host machine, Android devices, and
> iOS devices.

That last sentence is a real advantage over SQLDelight, whose JVM tests run on bundled xerial while
the device runs its system SQLite (§4.6). For a codebase whose tests are the money specification,
"same SQLite everywhere" is worth something.

Two caveats:

- **It only works Context-free on Room 3.** An Android-only module resolves the _Android_ variant
  even for `testImplementation`, and Room 2.8.5's Android `Room` object requires a `Context` on all
  four entry points. Room 3.0.3 added `inMemoryDatabaseBuilder` with no `Context` (3.0.0-alpha03,
  2026-04-08) and made the builder's `context` nullable. So plain-JVM `src/test/` database tests in
  this app's module shape need Room 3, not Room 2.
- **`sqlite-bundled` ≥ 2.7.0 ships no Intel-Mac native.** 2.6.2 included `osx_x64`; 2.7.0 onward does
  not. An Intel MacBook gets `UnsatisfiedLinkError`, not a build error, and this is in no release note.
  Linux x64/arm64 CI and Apple Silicon are fine.

Also note `BundledSQLiteDriver`'s own KDoc: _"the bundled SQLite used by this driver is compiled in
multi-thread mode which means connections opened by the driver are NOT thread-safe."_

## 4. SQLDelight

Primary sources fetched 2026-09-15. **The repository has moved**: `cashapp/sqldelight` now redirects
to `sqldelight/sqldelight` (default branch `main`), and the canonical docs host is
`sqldelight.github.io/sqldelight`, not `cashapp.github.io`. Maven group is still `app.cash.sqldelight`.

Stable **2.3.2** (2026-03-16); `2.4.0-rc2` on Maven Central as of 2026-09-15. Head commit 2026-09-15,
repo not archived — actively maintained.
([releases](https://github.com/sqldelight/sqldelight/releases/tag/2.3.2),
[maven-metadata](https://repo1.maven.org/maven2/app/cash/sqldelight/android-driver/maven-metadata.xml))

### 4.1 Notification granularity: table names _by default_, arbitrary strings _by capability_

The driver interface
([SqlDriver.kt](https://github.com/sqldelight/sqldelight/blob/main/runtime/src/commonMain/kotlin/app/cash/sqldelight/db/SqlDriver.kt)):

```kotlin
fun addListener(vararg queryKeys: String, listener: Query.Listener)
fun removeListener(vararg queryKeys: String, listener: Query.Listener)
fun notifyListeners(vararg queryKeys: String)
```

Generated code passes table names as those keys. From the checked-in generated output
([PlayerQueries.kt](https://github.com/sqldelight/sqldelight/blob/main/sqldelight-compiler/integration-tests/src/test/kotlin/com/example/PlayerQueries.kt)):

```kotlin
Query(-1_634_440_035, arrayOf("player"), driver, ...)            // SELECT registers on "player"
notifyQueries(-1_595_716_666) { emit -> emit("player") }          // INSERT emits "player"
```

and the compiler hard-codes that — `SelectQueryGenerator.kt` builds the key array from
`tablesObserved`, `QueryGenerator.kt` builds the emit set from `tablesUpdated()`. There is no
extension point. **So out of the box, granularity is exactly one table name — no narrower than Room.**

The difference is that the key space is _unvalidated free-form `String`_. Both drivers store keys in
a plain map:

```kotlin
// AndroidSqliteDriver.kt — JdbcSqliteDriver.kt is the same implementation
private val listeners = linkedMapOf<String, MutableSet<Query.Listener>>()
override fun addListener(vararg queryKeys: String, listener: Query.Listener) {
  synchronized(listeners) { queryKeys.forEach { listeners.getOrPut(it, { linkedSetOf() }).add(listener) } }
}
```

and SQLDelight's own driver test fires an arbitrary literal key at a hand-rolled `Query` subclass
([QueryTest.kt](https://github.com/sqldelight/sqldelight/blob/main/drivers/driver-test/src/commonMain/kotlin/com/squareup/sqldelight/driver/test/QueryTest.kt)):

```kotlin
driver.notifyListeners("test")   // arbitrary string
```

So a narrower key such as `"order_items:order=<id>"` is expressible. The cost is that you own both
halves: wrap or subclass `Query` to register the custom key, and emit it yourself from the writer.
`BaseTransacterImpl.notifyQueries` is `protected` on a public abstract class, so an app-side
`TransacterImpl` subclass can emit custom keys **and still get commit deferral**:

```kotlin
class OrderTransacter(driver: SqlDriver) : TransacterImpl(driver) {
  fun touch(orderId: String) = notifyQueries(STABLE_ID) { emit -> emit("order_items:order=$orderId") }
}
```

Calling `driver.notifyListeners(...)` directly does **not** defer — it fires immediately even inside
an open transaction. This is an undocumented pattern: it is proven by the API signature, both driver
implementations and SQLDelight's own test, but no doc page or changelog entry endorses it.

### 4.2 Notifications are deferred to the outermost commit

`BaseTransacterImpl` in
[Transacter.kt](https://github.com/sqldelight/sqldelight/blob/main/runtime/src/commonMain/kotlin/app/cash/sqldelight/Transacter.kt)
buffers into `transaction.pendingTables` and flushes in `postTransactionCleanup` only when
`enclosing == null`. Consequences:

- One notification burst per outermost commit, carrying the deduplicated union of affected tables.
- Rollback produces **zero** notifications.
- Nested transactions merge `pendingTables` upward; nothing fires until the outer commit.
- `registeredQueries` dedupes by statement identifier, so the same insert run 500 times in a loop
  contributes its table set once.
- Listeners run **synchronously on the writing thread**, per `Query.Listener`'s own KDoc.

A 1,500-row sync page applied inside one `transaction { }` therefore produces exactly one
notification per affected table, not 1,500.

### 4.3 `asFlow()` re-executes; there is no built-in dedupe

[FlowExtensions.kt](https://github.com/sqldelight/sqldelight/blob/main/extensions/coroutines-extensions/src/commonMain/kotlin/app/cash/sqldelight/coroutines/FlowExtensions.kt):

```kotlin
fun <T : Any> Query<T>.asFlow(): Flow<Query<T>> = flow {
  val channel = Channel<Unit>(CONFLATED)
  channel.trySend(Unit)
  val listener = Query.Listener { channel.trySend(Unit) }
  addListener(listener)
  try { for (item in channel) { emit(this@asFlow) } } finally { removeListener(listener) }
}
fun <T : Any> Flow<Query<T>>.mapToList(context: CoroutineContext): Flow<List<T>> =
  map { withContext(context) { it.awaitAsList() } }
```

Every notification re-runs the full query and re-maps every row. The whole public API of the
coroutines artifact is 6 functions (`toFlow`, `mapToList`, `mapToOne`, `mapToOneNotNull`,
`mapToOneOrDefault`, `mapToOneOrNull`) — nothing else, so `.distinctUntilChanged()` is yours to add.
`Channel(CONFLATED)` collapses a burst arriving while a query is still running, but does not debounce
in time. `context` is mandatory since 2.0; query execution and row mapping happen there, listener
registration and callback do not.

### 4.4 Schema, migrations, and adopting `watermelon.db` in place

`SqlSchema` has `version: Long`, `create(driver)`, `migrate(driver, old, new, vararg callbacks)` —
and **nothing that inspects an existing database**
([SqlSchema.kt](https://github.com/sqldelight/sqldelight/blob/main/runtime/src/commonMain/kotlin/app/cash/sqldelight/db/SqlSchema.kt)).

`AndroidSqliteDriver.Callback` is the entire Android schema logic:

```kotlin
override fun onCreate(db) = schema.create(...)
override fun onUpgrade(db, old, new) = schema.migrate(..., old.toLong(), new.toLong(), *callbacks)
```

Dispatch is Android's, not SQLDelight's: `SQLiteOpenHelper.getDatabaseLocked` compares
`db.getVersion()` — literally `PRAGMA user_version` — against the helper's version and calls
`onCreate` (0), `onUpgrade` (<), `onDowngrade` (>), or nothing (==).

**This is the answer to the in-place question, and it is a clean yes.** §1.9 established that
WatermelonDB writes its schema version to `PRAGMA user_version` and the device file currently reads
`3`. Get the SQLDelight schema to version 3 and the `==` branch runs: SQLDelight opens the existing
file blind and issues no DDL at all. It never checks table shape, never checks column types, never
writes an identity hash.

Reaching version 3 is not a fudge, it falls out of the existing history. SQLDelight's schema version
is derived from migration files — "the first version of the schema is 1. Migration files are named
`<version to upgrade from>.sqm`" — and `migrations.ts` already has exactly two steps, v1→2 and v2→3.
Transcribe them as `1.sqm` and `2.sqm` and the generated `Schema.version` is 3, matching the device
file by construction. A tablet that somehow sits at an older `user_version` then takes the normal
`onUpgrade` path through the same migrations.

Three further facts make that survivable rather than merely possible:

- **Extra physical columns are tolerated on read.** `expandSelectStar` defaults `true`, rewriting
  `SELECT *` into an explicit projection, and cursor reads are positional. So `_status`, `_changed`
  and any column you decline to declare are simply never selected.
- **Inserts must be column-explicit.** Generated code emits your SQL byte-for-byte; the sample
  `INSERT INTO player VALUES (?, ?, ?, ?)` would fail against a wider physical table. Write
  `INSERT INTO order_items (id, order_id, ...) VALUES (...)` and make undeclared physical columns
  nullable or defaulted. Note that `_status` and `_changed` are untyped and nullable in the
  WatermelonDB DDL (§1.9), so leaving them unwritten is legal.
- **There is no `NOT NULL` cross-check.** If the file holds a NULL where the `.sq` says `NOT NULL`,
  the generated mapper does `cursor.getString(0)!!` and you get an NPE at read time, not at startup.

Cleanest adoption route is the `AndroidSqliteDriver(database: SupportSQLiteDatabase)` constructor, or
an override of the `open` `AndroidSqliteDriver.Callback`. Note that WatermelonDB's file sits at
`/data/data/<pkg>/watermelon.db`, not under `databases/` (§1.9), so it must be opened by absolute path
or moved.

Migration verification (`verifySqlDelightMigration`) is build-time only and effectively off unless
you set `schemaOutputDirectory`, generate and commit a `.db` snapshot, and set `verifyMigrations = true`
([migrations docs](https://sqldelight.github.io/sqldelight/2.3.2/android_sqlite/migrations/)).

### 4.5 Transactions and bulk writes

`transaction { }` / `transactionWithResult { }` on every generated `Queries` class and on the
generated `Database`. Nesting merges upward with no savepoints, so **an inner rollback fails the whole
outer transaction**. `afterCommit` / `afterRollback` hooks run only for the outermost. Transactions
are thread-confined (`checkThreadConfinement()`).

There is no dedicated batch API; the documented pattern is a plain loop inside `transaction { }`.
`AndroidSqliteDriver` keeps an `LruCache<Int, AndroidStatement>` of compiled statements, default size
**20**, keyed by generated statement identifier — so a hot insert loop reuses one compiled statement.
Variable-arity `IN (...)` queries pass `identifier = null` and recompile every call; with 9 such
observations today (§1.12) and 20+ hot statements, raise `cacheSize`.

### 4.6 Tests

Documented and direct
([testing docs](https://sqldelight.github.io/sqldelight/2.3.2/android_sqlite/testing/)):

```kotlin
driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
Database.Schema.create(driver)
```

Plain JUnit on the JVM, no emulator, no Robolectric, because generated code takes a `SqlDriver`.
Two caveats worth writing down now:

- `JdbcSqliteDriver.IN_MEMORY` is `"jdbc:sqlite:"`, which per its own KDoc creates a **temp file**
  deleted on close, not an in-memory database. Use `"jdbc:sqlite::memory:"`.
- **SQLite version skew is real.** `sqlite-driver` bundles `org.xerial:sqlite-jdbc` 3.51.3.0 in 2.3.2;
  the tablet's bundled SQLite is far older. The testing docs' own workaround is to pin xerial with
  `strictly(...)` to match the device. Independently, the compile-time dialect is auto-selected from
  `minSdk` (`Project.sqliteVersion()` in the Gradle plugin: `>=34 → 3.38`, `>=31 → 3.30`, `>=30 → 3.25`,
  else **3.18** — no UPSERT, no window functions, no `RETURNING`). Set the dialect explicitly rather
  than inheriting it.

Because the driver is a plain interface the app constructs, a test can decorate it to record
`newTransaction()` and `execute()` calls — which is how the `expect(batches[0]).toEqual([...])`
assertion in §1.8 ports.

## 5. The reactivity comparison, quantified

### 5.1 The three things "coarser" can mean

The question in #15 collapses three separable properties. Keeping them apart is what makes the answer
tractable:

| Property                                | WatermelonDB today                                                                 | Room / SQLDelight default                              |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Trigger** — what wakes the observer   | collection changeset, filtered per changed record by an in-JS matcher              | the table name                                         |
| **Recompute** — what runs when it wakes | nothing; membership is maintained incrementally, SQLite is never re-queried (§1.4) | the whole query re-executes and every row is re-mapped |
| **Emit gate** — what reaches the UI     | membership change, or one of N named columns changed on a row already in the set   | nothing; every notification emits                      |

Only the _middle_ row is a real regression, and only the _bottom_ row is cheaply recoverable. Read
that way, "Room invalidates per-table, SQLDelight per-query" understates the problem in one direction
and overstates it in the other.

### 5.2 The emit gate is recoverable — and the replacement is strictly better

`.distinctUntilChanged()` on a projected Kotlin data class subsumes both halves of
`observeWithColumns`, and is more accurate than it, for three reasons:

1. **WatermelonDB's membership check is reference equality.** `identicalArrays` compares elements
   with `!==` (`utils/fp/identicalArrays/index.js`), and WatermelonDB caches one `Model` instance per
   id — so an updated row keeps the same instance and the membership check cannot see the change.
   The whole column-diff apparatus exists to compensate. A data class comparison has no such blind
   spot.
2. **It compares what the UI renders, not a hand-maintained proxy for it.** The 31 observed-column
   constants are a manual restatement of what each projection reads, and they drift: commit
   `83c448d` is literally `fix(sync): add observedColumns to all useObservable calls`. The view types
   (`OrderDetailView`, `OrderItemView`, …) are already flat value shapes, so they become data classes
   with structural equality for free.
3. **It suppresses strictly more.** An observed column reassigned to the same value, or any change
   that does not alter the projection, still emits under `observeWithColumns` and does not under
   `distinctUntilChanged`.

Concretely on the case §1.5 identifies as the most frequent write in the system — a sync echo-back
touching only `server_id` and `updated_at` — both designs emit **zero** times. The Kotlin version
just pays a query to find that out.

### 5.3 The recompute regression, with numbers

Take the scenario #15 asks for: a screen observing order items while sync writes land. Use
`useOrderDetail` (§1.13: 8 observations over 8 tables, order X holding ~10 items) and one sync page,
which `CLAUDE.md` caps at 1,500 rows and `SyncManager.ts:348` applies as one `synchronize()` call.

**Today.** `Collection.experimentalSubscribe` delivers a changeset only to observers of _that_
collection, and `useOrderDetail` holds exactly one observation per table, so each changed row is seen
once: one `matcher(record._raw)` call plus an `indexOf` over a ≤10-element array, and one
column-tuple comparison if the row is already in that observer's result set. Call it ~1,500 matcher
evaluations for the page, no SQLite access, on the JS thread. Emissions: 0 if the page only moved
`updated_at`.

**Under a re-executing primitive.** One notification burst naming the affected tables, then 8 queries
re-execute: 5 indexed lookups returning ≤10 rows, plus the 3 unfiltered reference-table reads
(`tables`, `products`, `users`). Emissions after `distinctUntilChanged`: 0, same as today. All of it
on a background dispatcher (§1.11).

Those 3 unfiltered reads deserve a note, because they are the one place this scenario could degrade.
They are unfiltered today only because the filtering happens afterwards in a JS memo; `products` in
particular grows with catalog size, which `useModifiers.ts:270` is already flagged for. In SQL they
become `WHERE store_id = ?` with an existing index, so the rebuild should bound them rather than port
them as-is. Nine of the 43 observations are in this category (§1.12).

So for _bounded_ queries the honest summary is: **~8 extra indexed queries per applied page, zero
extra emissions, and the work moves off the UI thread.** That is not a threat to ADR-0001's 100 ms
tap gate.

### 5.4 Where it genuinely bites — and it is worse than #15 assumes

The danger is not coarseness as such; it is coarseness multiplied by an unbounded query. Under
WatermelonDB an unbounded query is paid **once, at subscribe**, and thereafter costs O(changed rows).
Under a re-executing primitive it is paid **on every invalidation**.

Apply that to the exact code the 2026-09-08 investigation reproduced — `useTables.ts` observing the
entire `order_items` collection at 100,000 rows, during an initial sync of ~67 pages at 1,500 rows
each:

|                                                 |  rows inspected during the initial sync |
| ----------------------------------------------- | --------------------------------------: |
| WatermelonDB (pre-3.27.2 code, as shipped)      | ~100,000 once, then O(changed) per page |
| Room / SQLDelight with the same unbounded query |            ~100,000 **per page** ≈ 6.7M |

**So the answer to "does a coarser primitive risk reproducing that bug" is: it does not merely
reproduce it, it amplifies it by roughly the page count.** The 3.27.2 hotfix that bounded those four
queries is therefore not optional background — it is a precondition for this migration, and the
discipline has to be carried forward as an enforced property rather than a convention.

That is what makes the §7.4 suggestion load-bearing: with a real in-memory SQLite instance, "this
read uses an index" becomes an `EXPLAIN QUERY PLAN` assertion in the test suite. WatermelonDB never
offered that, because the fast path never touched SQLite at all.

### 5.5 Answering #15's question directly

> Say clearly whether either library can express the needed narrowing, and how.

- **Emit-gate narrowing: both, and better than today.** `.distinctUntilChanged()` over projected data
  classes (§5.2). No library support needed.
- **Trigger narrowing: SQLDelight yes, Room no.** SQLDelight's `addListener(vararg queryKeys: String,
…)` / `notifyListeners(vararg queryKeys: String)` take unvalidated free-form strings, and both
  drivers store them in a plain `linkedMapOf<String, MutableSet<Query.Listener>>` (§4.1). A key such
  as `"order_items:order=<id>"` is therefore expressible: subclass `Query` to register it, and emit
  it from an app-side `TransacterImpl` subclass so it still gets commit deferral. Room's trigger
  writes one bit keyed by `table_id` and there is no application-supplied key space at all (§3.1).
  Notably, SQLite's column-scoped `AFTER UPDATE OF …` triggers would have given Room something close
  to `observeWithColumns`, and Room does not use them.
- **Recompute narrowing: neither automatically, but both allow manual control.** The ergonomic path
  in both libraries re-executes on every notification — Room's generated DAO `Flow` is
  `createFlow(*tableNames).conflate().map { query() }` (§3.2), SQLDelight's `asFlow()` emits the
  `Query` for `mapToList` to re-run (§4.3). Both also expose the raw notification stream:
  `invalidationTracker.createFlow(vararg tables): Flow<Set<String>>` in Room, `Query.addListener` in
  SQLDelight. That decouples _being told_ from _re-querying_, which is the expensive half, without
  making the trigger any finer. §5.3 shows the automatic path is affordable provided queries stay
  bounded, so treat manual control as a targeted remedy for one expensive view, not a default.

## 6. Recommendation

**SQLDelight**, on cutover risk — not on reactivity, where the two are near enough to equivalent.

### 6.1 The deciding difference

§5 shows the reactivity gap is not where #15 expected it: both libraries lose trigger-level narrowing,
both recover the emit gate via `distinctUntilChanged`, and the one asymmetry (SQLDelight's free-form
query keys, §4.1) is an undocumented capability held in reserve rather than something you would build
on from day one. If reactivity were the only axis, this would be a coin toss.

The axis that is not a coin toss is opening the file that is already on the tablets:

|                              | SQLDelight                                        | Room                                                                             |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| What it checks on open       | `PRAGMA user_version`, nothing else (§4.4)        | identity hash in `room_master_table`, else full `onValidateSchema` (§3.6)        |
| Untyped WatermelonDB columns | never inspected                                   | all 215 resolve to `UNDEFINED` affinity and fail; unfixable from the entity side |
| Nullable `"id" primary key`  | never inspected                                   | fails `notNull` comparison; a nullable PK is a Room compile error                |
| `_status` / `_changed`       | never selected                                    | fail the column-set comparison unless declared                                   |
| Result                       | declare schema version 3 and the file opens as-is | one-time ETL into a fresh database, or a full 20-table rewrite                   |

Three live stores are running v3.28.1 with unsynced sales on device, and ADR-0001 is unambiguous that
pending local work is a protected data class. The riskiest single moment of this migration is the
cutover, and Room forecloses the cheapest version of it. SQLDelight does not have to _win_ on
reactivity to be the right call; it only has to not lose, and it doesn't.

Two secondary Room facts point the same way. **Room 3 changed `fallbackToDestructiveMigration` to
default `dropAllTables = true`**, which sweeps `sqlite_master` and drops tables Room does not manage —
including `local_storage`, where the sync watermark lives (§1.10, §3.6). And **Room 3 is a
substantially different API from the Room most material describes**: KSP2 only, every DAO function
`suspend` or `Flow`-returning, no `SupportSQLiteDatabase`, no Executors, `InvalidationTracker.Observer`
removed. For a greenfield rewrite that is survivable, but it erodes the "well-trodden path" argument
that is Room's main non-technical appeal.

Note what this argument is not. It is not "adopt the file in place" — that is
[#21](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/21)'s decision. It is
"don't spend the option before #21 gets to make it." Picking Room now decides #21 by default, in the
direction that costs the most.

### 6.2 What Room is genuinely better at, and how to cover the gap

This should not be read as a one-sided result. Room is first-party, on a predictable release train
(3.0.3, 2026-09-09), with better tooling and a far larger body of prior art — all of which matters for
a solo developer leaning on agents, which is the staffing model
[#22](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/22) is about.

Its concrete technical advantage is `BundledSQLiteDriver`: _"the exact same version of SQLite on your
host machine, Android devices, and iOS devices"_ (§3.7), with Google now explicitly steering away from
Robolectric toward plain JVM tests. SQLDelight has the opposite problem — its JVM tests run on bundled
xerial 3.51 while the tablet runs its system SQLite, and its compile-time dialect is auto-selected
from `minSdk` (§4.6). For a codebase whose tests _are_ the money specification, that is a real gap and
it has to be closed deliberately:

- Pin `org.xerial:sqlite-jdbc` with `strictly(...)` to match the device, which is the SQLDelight
  testing docs' own recommendation.
- Set the SQLDelight dialect explicitly rather than inheriting it from `minSdk`.
- On device, `AndroidSqliteDriver` accepts a `SupportSQLiteOpenHelper.Factory`, so a bundled modern
  SQLite can be supplied there if the system one proves to be the constraint.

If those three are not done, Room's testing story is better and the recommendation is closer than it
looks. Two things take a little shine off it even so: the Context-free JVM builder only exists on
Room 3, and `sqlite-bundled` ≥ 2.7.0 ships no Intel-Mac native, so an Intel MacBook gets an
undocumented `UnsatisfiedLinkError` running those tests (§3.7).

### 6.3 What would flip this

One thing, cleanly: **if [#21](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/21)
decides on a clean-slate cutover** — drain pending work, verify sync-clean, wipe, re-sync into a fresh
database — then §6.1's entire argument evaporates. At that point Room's first-party support,
`BundledSQLiteDriver` and ecosystem make it the better choice, and the ~350 extra LOC (§7.2) is a fair
price. This recommendation should be revisited the moment #21 lands, not treated as settled.

The same is true of the middle option Room's own shape suggests: a **one-time ETL** — open the old
file with a plain driver, read rows, insert through Room DAOs, delete it. That permanently fixes the
affinity and nullability problems and drops `_status` / `_changed` cleanly, and it keeps Room's
validation as a real safety net rather than something you disable. It is a perfectly defensible plan.
It is simply a larger, more dangerous cutover than "open the file", executed on devices that may be
holding unsynced sales — so it should be #21's deliberate choice, not a consequence of a library
decision made here.

A weaker flip: if measurement on the VistaTab
([#18](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/18)) showed that re-execution
cost was the binding constraint after all, SQLDelight's custom query keys would become load-bearing
rather than held in reserve — which strengthens rather than reverses the recommendation, but would
mean depending on an undocumented API (§8.2).

### 6.4 Recommended sequence

1. Transcribe the money assertions from `orderTotals.test.ts`, `orderMutations.test.ts` and
   `voidMutations.test.ts` as golden fixtures **before** any Kotlin persistence code exists (§7.4).
2. Generate the `.sq` schema from `schema.ts` (368 lines, §7.1) and transcribe `migrations.ts` as
   `1.sqm` / `2.sqm` so `Schema.version` is 3 by construction (§4.4).
3. Build the 17 read models as SQL with joins, aggregates and `ORDER BY … LIMIT`, deliberately
   bounding the 9 currently-unfiltered reads (§5.3). Guard each with an `EXPLAIN QUERY PLAN`
   assertion. Join _correlated_ tables — an order with its items, modifiers, discounts and voids —
   but keep `products`, `users` and `stores` as separate flows, because a joined query is invalidated
   by writes to every table it touches (§3.4) and catalog writes should not wake the order view.
4. Add `.distinctUntilChanged()` at the repository boundary over projected data classes, and delete
   the concept of hand-maintained observed-column lists rather than porting it (§5.2).
5. Leave custom query keys unimplemented until #18 produces a number that demands them.

## 7. What the rebuild costs

### 7.1 The two mechanical numbers are not guesses

I transpiled `schema.ts` into both target forms and counted:

- **`.sq` DDL: 368 lines.** 20 `CREATE TABLE`, 216 column lines (215 declared + `id`), 50
  `CREATE INDEX`, blank separators.
- **Room entities: 448 lines.** 20 `@Entity` data classes with `indices = [...]` blocks and one
  `@ColumnInfo` line per column.

Room is larger because index declarations and column annotations both cost a line, and because the
result types SQLDelight generates from a query must be hand-written as POJOs.

### 7.2 Full estimate

Scope is the persistence layer and the read models that sit directly on it — `src/db` (1,023 LOC)
plus roughly 1,400 of the 2,096 LOC in `src/sync/dataSources` that is observation plumbing and JS
projection. Call the thing being replaced ~2,400 TS LOC. Mutation services (~1,351 LOC) and the sync
protocol are out of scope here.

| Piece                                                            |    SQLDelight |             Room | Basis                                  |
| ---------------------------------------------------------------- | ------------: | ---------------: | -------------------------------------- |
| Schema (20 tables / 215 cols / 50 indices)                       |           368 |              448 | mechanically generated, §7.1           |
| Migrations v2, v3 + adoption step                                |           ~60 |              ~90 | current `migrations.ts` is 58          |
| Read queries for 17 read models (~25 named queries)              |          ~220 |             ~200 | joins/aggregates replace the JS memos  |
| Result/projection types                                          | 0 (generated) |             ~220 | SQLDelight derives them from the query |
| Write statements (~30)                                           |          ~150 |             ~160 |                                        |
| Value adapters — Boolean, 16 enum-shaped columns, 3 JSON columns |           ~90 |              ~90 | §7.3                                   |
| Driver / database setup + cutover path                           |          ~120 |         ~150–400 | Room's upper bound is the ETL of §6.3  |
| Repository layer: 17 Flows + `distinctUntilChanged`              |          ~320 |             ~320 | identical work either way              |
| Test harness: in-memory instance, driver decorator, fixtures     |          ~140 |             ~140 |                                        |
| **Total**                                                        |    **~1,470** | **~1,820–2,070** |                                        |

Of the SQLDelight total, ~740 lines (schema + queries + migrations) is declarative SQL rather than
Kotlin — which matters because #13 names _Kotlin review capacity_, not writing capacity, as the
binding constraint.

Both totals are smaller than the ~2,400 TS LOC they replace, and the reason is structural rather
than cosmetic: the 9 two-step `IN (...)` chains and most of the 16 `useMemo` projections collapse
into `JOIN` / `GROUP BY` / `ORDER BY ... LIMIT`, which §1.4 shows WatermelonDB cannot express on its
fast observation path.

### 7.3 Type mapping notes

- 215 columns: 129 `string`, 73 `number`, 13 `boolean`; 87 optional, 128 required.
- Booleans are physically `1`/`0` — `adapters/sqlite/encodeValue/index.js` returns `'1'`/`'0'` — so
  an `INTEGER AS Boolean` adapter reads the existing file directly.
- Required columns are never NULL in the existing file: `RawRecord/index.js` defaults non-optional
  columns to `''`, `0`, `false`, so `NOT NULL` declarations are safe for the 128 required columns.
- **Money stays `Double`.** `packages/shared/src/taxCalculations.ts` uses IEEE-754 with an explicit
  `roundMoney(x) = Math.round((x + Number.EPSILON) * 100) / 100` at each step. Porting that
  bit-for-bit is the lowest-risk option and keeps in-place adoption viable; switching to integer
  centavos changes results and forces every money golden to be re-derived. That decision belongs to
  [#19 — how money math stays identical across TypeScript and Kotlin](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/19),
  not here; the only claim this ticket makes is that the **storage format does not force it** —
  a `REAL` column reads as `Double` either way.
- 16 columns hold closed vocabularies (`status`, `order_type`, `void_type`, `discount_type`,
  `payment_method`, `selection_type`, …) and 3 hold JSON in TEXT (`roles.permissions`,
  `stores.schedule_json`, `sync_v2_aggregates.payload`).

### 7.4 Where the risk actually sits

| Tier       | Work                                                       | Review risk                                                                                       |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mechanical | schema/DDL, entities, indices, migrations (~430–540 lines) | Low — generated from an existing file and diffable against it                                     |
| Moderate   | write statements and transaction boundaries                | Medium — must preserve `updated_at` stamping; the existing tests already assert transaction shape |
| **High**   | the 17 read models                                         | **This is where the money lives** — `calculateLineTotal`, VAT and SC/PWD projections              |

The sequencing that follows from that: port the money assertions from `orderTotals.test.ts`,
`orderMutations.test.ts` and `voidMutations.test.ts` as golden fixtures **first**, then build read
models against them. #13 lists "what happens to the 18 existing Jest suites" as unspecified; for the
persistence layer specifically the answer should be _transcribe as goldens_, because 25 lines of
existing assertions already pin the money behaviour.

There is already precedent for treating query breadth as a correctness property rather than a
performance one: `voidMutations.test.ts`'s single test is named _"refunds selected items while
retaining remaining modifier charges **without reading unrelated modifiers**"_ — a money assertion
and a breadth assertion in the same test. That instinct is the right one to keep.

One cheap upgrade worth taking while rebuilding: `scripts/test-query-performance.cjs` (175 lines)
currently transpiles hook source in a `vm` and counts hydrated rows to guard against the 2026-09-08
regression. Against a real in-memory SQLite instance that guard becomes an `EXPLAIN QUERY PLAN`
assertion — a direct, robust test that a read uses an index instead of scanning, which is the actual
invariant the investigation wanted.

## 8. Sources, and what was not verified

### 8.1 Method

WatermelonDB claims are read off the installed copy at
`node_modules/@nozbe/watermelondb` version 0.28.0 — the shipped JavaScript and the bundled
`native/shared/Database-sqlite.cpp` / `native/android/.../WMDatabase.java`, not the project's
documentation. App claims are read off the tree at `ba59163` (v3.28.1). Library claims were fetched
from first-party docs and repository source on 2026-09-15; every one is cited inline.

Two retrieval notes for anyone re-checking this:

- `developer.android.com/reference/*` pages are client-rendered and return only nav chrome to a
  fetcher. `curl` gets the full HTML. Better still, Google's Maven publishes real sources JARs —
  `room-runtime-android-2.8.5-sources.jar`, `room3-runtime-android-3.0.3-sources.jar`,
  `room-compiler-2.8.5-sources.jar` — which is the same code the reference site is generated from,
  and is where the Room quotations here come from.
- SQLDelight's repository has moved from `cashapp/sqldelight` to `sqldelight/sqldelight` and its docs
  from `cashapp.github.io` to `sqldelight.github.io`. The old docs root still returns 200 while its
  versioned paths 404, so it is easy to read a stale page without noticing.

The two schema line counts in §7.1 come from transpiling `apps/native/src/db/schema.ts` into `.sq`
DDL and into Room `@Entity` classes and counting the output, not from estimation.

### 8.2 Not verified

- **No device measurement.** Nothing here was run on a VistaTab 30S. The arithmetic in §5.3 and §5.4
  counts rows and queries; it is not a latency benchmark. That measurement is
  [#18](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/18)'s job and this document
  should not be read as pre-empting it.
- **No library was actually run against a WatermelonDB file.** §4.4's conclusion is derived from
  source — SQLDelight's `Callback` → androidx `FrameworkSQLiteOpenHelper` → AOSP
  `SQLiteOpenHelper.getDatabaseLocked` → `PRAGMA user_version` — plus WatermelonDB's own
  `getUserVersion`/`setUserVersion`. The chain is short and each link is quoted, but nobody has opened
  a real `watermelon.db` with `AndroidSqliteDriver`. That experiment belongs to
  [#21](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/21) and should be run before
  anything depends on it. **Pull the actual device file and run `PRAGMA table_info` / `PRAGMA
index_list` against it** rather than trusting §1.9's reading of the DDL generator — the app uses the
  JSI adapter, and the `user_version` behaviour quoted here is from the shared C++ and the classic
  Java adapter.
- **Room's "pre-seed `room_master_table`" workaround is unverified at runtime.** It is mechanically
  sound — a matching hash short-circuits `onValidateSchema` permanently — but it leaves Room issuing
  SQL against affinity-mismatched columns, and no Google source describes what that does to reads and
  writes over real data. §3.6 rejects it on that basis rather than on evidence that it breaks.
- **SQLDelight's custom query keys are undocumented.** The capability is established by the API
  signature, both driver implementations and SQLDelight's own `QueryTest`. No doc page, changelog
  entry or issue endorses it as a supported pattern. Treat it as a capability held in reserve, not a
  design you commit to up front.
- **Minimum toolchain versions are shaky on both sides.** SQLDelight states no minimum Kotlin
  anywhere and has no plugin-side check; its in-repo compatibility matrix is stale relative to its own
  build. Room 3's minimum Kotlin, KSP-plugin, AGP and JDK versions are likewise absent from the
  release notes — the only figures available are lower bounds read out of `.pom` / `.module` metadata.
  Both need pinning empirically when the Gradle build is set up.
- **No Google issue was found requesting finer Room invalidation**, but `issuetracker.google.com`
  bodies are JS-rendered and sign-in-gated, so that is weak negative evidence rather than a
  confirmation that none exists.
- **The LOC figures in §7.2 beyond §7.1 are estimates**, derived from counts of what exists (17 read
  models, 43 observations, ~30 write paths) rather than from written Kotlin. Treat the ratio between
  the two columns as more reliable than either absolute.
- **Effort is deliberately not given in days.** #13 names Kotlin _review_ capacity as the binding
  constraint, which makes calendar estimates a function of the reviewer, not of the line count. §7.4
  gives risk tiers instead.
