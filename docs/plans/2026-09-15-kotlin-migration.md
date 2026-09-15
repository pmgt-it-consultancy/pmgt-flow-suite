# Migration plan: Android POS from React Native to native Kotlin

**Date:** 2026-09-15
**Map:** [#13](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/13) · **Plan ticket:** [#24](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/24)
**Baseline:** `main` @ `ba59163`, native `3.28.1`
**Status:** Plan. No migration code written.

---

## 1. Goal and constraint

Rebuild `apps/native` (30,858 LOC, 230 files) as a native Kotlin Android application, replacing React Native, Expo, WatermelonDB and Tamagui, without losing money-correctness, unsynced offline orders, or uptime across three live restaurant stores.

**The constraint is a 1:1 port.** The Kotlin app reproduces current behaviour. It does not add features, fix non-urgent defects, or improve workflows. Three reasons this is load-bearing rather than merely tidy:

1. Verification rests on **differential testing against the running React Native app**. Behaviour with no RN counterpart has no oracle.
2. The Kotlin source will not be reviewed line by line. Every difference must therefore be intentional and attributable.
3. It eliminates staff retraining, which is what makes a solo migration tractable at all.

Improvements are not cancelled — they are sequenced after cutover, once there is one codebase.

### Context that shaped every decision

| Fact | Consequence |
|---|---|
| Android only, permanently | The cross-platform economics behind Shopify's 2026 migration do not apply; this codebase never paid that tax |
| Solo developer plus agents | Kotlin **review** capacity, not writing capacity, is the binding constraint |
| 3 live stores, 1-3 tablets each | Blast radius is a client's books; all tablets in a store cut over together |
| `apps/web` and `packages/backend` unchanged | Only `apps/native` is rebuilt; the backend becomes the referee |
| Dominant risk is money, not speed | VAT, SC/PWD, split payments, centavo rounding outrank milliseconds |

---

## 2. Target architecture

| Layer | Choice | Decision |
|---|---|---|
| Language / UI | Kotlin, Jetpack Compose | — |
| Local persistence | **SQLDelight** | [#15](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/15) |
| Convex access | **Plain HTTP** over one OkHttp stack; thin transport + domain repositories; no Convex client library | [#25](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/25) |
| Sync | **v1 row replication**, ported | [#27](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/27) |
| Auth | `@convex-dev/auth` retained, bearer token over the same transport; pin `0.0.9x` | [#16](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/16) |
| Money arithmetic | `Double`, bit-for-bit with the TS implementation | [#19](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/19), [ADR 0002](../adr/0002-ledger-compatible-money-arithmetic.md) |
| Printing | Ported ESC/POS over classic SPP RFCOMM; no third-party library | [#17](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/17) |

### Load-bearing details

**SQLDelight was chosen on cutover risk, not reactivity.** It checks only `PRAGMA user_version` (WatermelonDB writes 3), while Room validates column type affinity — and WatermelonDB emits all 215 columns **untyped** with a nullable PK. Room therefore cannot open existing tablet databases, and choosing it would have forced an ETL onto tablets holding unsynced sales.

**SQLDelight re-executes queries per invalidation** where WatermelonDB executed once at subscribe. Query shapes that were tolerable become pathological: the pre-3.27.2 `useTables` shape goes from ~100k rows inspected to ~6.7M. The 3.27.2 bounded-query hotfix is a **precondition**, and the remaining unbounded shapes — `useModifiers.ts:270`, `voidMutations.ts:271`, the missing `orders.created_at` index — must be fixed in the Kotlin design rather than ported. Emit narrowing uses `distinctUntilChanged()` over a projected data class, which subsumes `observeWithColumns` and cannot drift from what the UI reads. Add `EXPLAIN QUERY PLAN` assertions as a standing gate.

**No Convex client library.** All 28 call sites were enumerated; **none carries orders, items or tables**. Operational data already flows through local replica observation. The official client cannot call HTTP actions at all, rebroadcasts every subscriber's full result set on any invalidation, and is 7 months stale. Two consequences: `api.ping.ping` is deleted and connection status derives from the sync layer (a truer signal — a ping can succeed while `/sync/push` fails), and `getDashboardSummary` stays server-only under 1:1.

**Money arithmetic is deliberately not improved.** `roundMoney` is `Math.round((amount + Number.EPSILON) * 100) / 100` over IEEE-754 doubles. `BigDecimal` would be *more accurate and therefore divergent* — same inputs, different centavo, and every settled Business Day across three stores becomes unreproducible. Replicate bit-for-bit, epsilon included, with a comment at the rounding function stating the compatibility is intentional.

---

## 3. Shape and sequencing

**Parallel app, infrastructure-first, per-store cutover** ([#20](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/20)). A separate Kotlin APK built to parity while React Native runs production untouched.

Strangler-with-interop was rejected: it would require both persistence libraries writing the same SQLite file with two notions of pending work, and both halves agreeing on a singular `deviceId` or `orderNumberCounters` breaks. The interop machinery would be more delicate than the port it de-risks, and all of it is throwaway.

Each phase ends at the Bounded Sync E2E Lab, never at a store.

| Phase | Scope | Why here |
|---|---|---|
| **1. Infrastructure** | HTTP transport + repositories; SQLDelight schema + in-place adoption + integrity checks; sync v1 pull/push; auth and screen lock; money arithmetic + golden vectors | Nothing is demonstrable until this exists; everything depends on it |
| **2. Read-only surfaces** | Catalog, products, categories, modifiers, tables, order history | Lowest risk; exercises repositories and observation against real data; defects are visual, not financial |
| **3. Order entry** | Cart, quantities, modifiers, takeout, counter ordering | First writes; differentially testable against RN on the same fixture |
| **4. Money** | Checkout, split payments, discounts, SC/PWD, voids, refunds | Highest risk; entered only once the layers beneath are proven |
| **5. Day closing and printing** | Z-Reports, sync-clean gate, ESC/POS | Printing is last because only physical hardware can verify it |

---

## 4. Money-correctness regime

Four mechanical oracles ([#22](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/22)). None is reading the code.

**1. Golden vectors from real production orders.** Export order amounts (no customer data) from the three stores and replay through both implementations. Real orders already encode every VAT / SC-PWD / split-payment / void combination that occurs, with the results the TS implementation produced. Covers `calculateVatBreakdown`, `calculateScPwdDiscount`, `calculateItemTotals`, `aggregateOrderTotals`, `calculateChange`, plus `normalizeVatRate` and `roundMoney` through them. Preserve the `12` vs `0.12` normalisation quirk exactly.

**2. Server-side Totals Reconciliation.** Sync push currently trusts the tablet verbatim — `sync.ts:923-929` casts `grossSales`, `vatAmount` and `netSales` straight onto the order. The backend recomputes on its own mutations but never on push, so **the tablet is today the sole authority on money**. On push, recompute from the Order Aggregate's items and compare. **Flag and accept, never reject** — a divergence must never block a sale. This is the one place the migration touches `packages/backend`. It also closes the gap at `sync.ts:1061`, whose own comment admits it bypasses `processPaymentCore`'s payment guard.

**3. Differential testing.** Backbone: both implementations against the E2E Lab (store `kh74r72rmz69jtr783qyhftt2h8e77t0` on `aromatic-dalmatian-30`), diffed. Supplement: capture-replay of real store inputs, replayed offline. True shadow mode is impossible — `deviceId` is singular, so two live apps collide `T-xxx`/`D-xxx` numbering.

**4. Day closing as production tripwire.** Extend the existing gate so final closing also requires zero unresolved Totals Divergences, reusing `closing.ts`'s `attention_required` pattern. It is the one moment each day a human already checks numbers, it already blocks, and it is already per-store and per-day — so a wrong total surfaces within a shift, not at month-end.

### Test disposition

24 backend tests stay untouched — the backend is not rewritten. Of 29 native tests: **transcribe 6** (pure logic, to language-neutral fixtures both run), **port 4** (service/behaviour, existing tests as the spec), **discard 8** (RN component/hook, plus dead `cachedSession`), **retain 9** (v2, for the deferred follow-on). Transcribe beats port wherever logic is language-neutral, because a shared fixture cannot drift the way two parallel suites will.

---

## 5. Cutover procedure, per tablet

**Adopt the existing database in place; convert on first open** ([#21](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/21)).

Pending Local Work lives in exactly one store — WatermelonDB's `_status` in `('created','updated')`. Sync v2's Operation Journal and checkpoints are in AsyncStorage but **off in every production build**, so they hold nothing. Record `id`s are client-generated UUIDs with `server_id` carrying the Convex `_id`, so nothing needs remapping.

1. **Before cutover:** drain toward Sync-Clean. A *safety measure*, not a precondition — a tablet holding three unsynced orders at 9pm must still upgrade safely. Requiring a synchronised quiet moment across every device is worth avoiding.
2. **Read `deviceId` from the existing `expo-secure-store` entry — never regenerate.** `SecureStore.xml`, key `key_v1-pmgt.deviceId`, alias `AES/GCM/NoPadding:key_v1:keystoreUnauthenticated`. A new UUID resets or collides `syncDevices.orderNumberCounters` and corrupts `T-xxx`/`D-xxx` numbering. **This path is source-derived and untested on hardware — verify on the VistaTab before any store cuts over.**
3. **Convert on first open:** translate `_status`/`_changed` into the Kotlin pending representation and `local_storage`'s `lastPulledAt` into the Kotlin cursor; write the Kotlin schema version.
4. **Three integrity checks, logged:** per-table row counts before and after; count of `_status != 'synced'` rows carried across, matched exactly; server-side confirmation that every local order's `server_id` resolves.
5. **If pending rows are found but cannot be converted, block with a visible error.** Silent loss of unsynced sales is the one outcome that must be impossible.

---

## 6. Rollout and rollback

**One store at a time, gated on a settled Business Day** ([#23](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/23)).

Store 1 is the lowest-volume store physically closest to the developer — reachability outranks volume when there is one pair of hands. One full settled Business Day before store 2; a further week before store 3. Cutover happens before open, never mid-shift. All tablets in a store cut over together.

**Gate — all of the following, for one complete Business Day:** Z-Report balances against the backend; zero unresolved Totals Divergences; every tablet reaches Sync-Clean with `pendingCount` zero and no `attention_required`; no stranded unsynced orders; receipts and kitchen tickets print on the store's own units; no payment, void or discount anomalies in `auditLogs`; `T-xxx`/`D-xxx` numbering continuous across cutover.

**Any money defect fails the gate regardless of everything else.** Speed is a conversation; a wrong total is a stop.

**Rollback: store 1's first week only, then retired for all stores.** In-place adoption keeps rollback possible only while the Kotlin app writes nothing WatermelonDB cannot read — no new columns, no changed affinities. Acceptable for a week, corrosive indefinitely. **The developer calls rollback, not the store.** Trigger: any money defect, any stranded unsynced order, or inability to complete day closing. Not slowness, and not unfamiliarity.

**Dual maintenance:** React Native receives bug fixes only when a store is actually hurting — no refactors, no dependency upgrades, no fixing defects that produced no complaint. The `bluetooth-connection` module is the precedent: dead 139 days across five releases with zero reports, correctly left alone. Anything fixed in RN during the window must be mirrored in Kotlin before its phase completes, or it silently regresses at cutover.

**Training is the 1:1 constraint's dividend** — no new workflows. Staff need only: what the app looks like offline, and who to call. The instruction is *keep selling, the app works offline, call immediately*.

---

## 7. Not migrated

| Item | Disposition |
|---|---|
| **Offline sign-in and PIN unlock** | Does not exist today; building it would add a security-sensitive feature with no differential oracle. Post-migration effort ([#26](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/26)) |
| **Sync v2 / ADR 0001** | Deferred, **not superseded**. More valuable under SQLDelight than under WatermelonDB, so it should follow promptly ([#27](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/27)) |
| **`cachedSession.ts`** | Zero production call sites; discarded |
| **`api.ping.ping`** | Replaced by sync-layer-derived connection status |
| **`getDashboardSummary` local-first** | An improvement, not a port; deferred |
| **iOS, `apps/web`, the Convex backend** | Out of scope throughout |

### Defects carried forward deliberately

Ported as-is rather than silently corrected, because an unattributable divergence is worse than a known bug:

1. **Lockout does not survive restart.** `useLockStore`'s `partialize` excludes `failedAttempts` and `cooldownUntil`. Force-quit resets both; PIN is up to 6 digits. Fix once, after cutover.
2. **Offline cold relaunch fails.** Root stays blank while auth waits for `getCurrentUser`.
3. **No reprint duplicate-protection.** `logReceiptReprint` is append-only audit written *before* printing; the only guard is `orderItems.isSentToKitchen`, which the reprint button deliberately bypasses.
4. **`bluetooth-connection` is dead in production.** `requireNativeModule` returns `{}` since `2bc95f9`. The Kotlin port picks up ~55 reusable lines and the defect disappears with the runtime.

---

## 8. Stop rule

Decided now, in calm conditions. This is a safety catch, not a reopening of the decision to migrate.

**Pause the migration when any of these holds:**

- A Totals Divergence reaches a live store's books and its cause is not understood within one Business Day.
- Two consecutive phases fail their E2E Lab gate for the same underlying reason.
- Store 1 rolls back, for any trigger.
- Differential testing stops being possible — for example the RN app can no longer run against comparable data.

**Abandon and stay on React Native when:** store 1 rolls back twice, or a defect class is found that the four oracles structurally cannot detect. The RN app remains production-capable throughout precisely so this stays available.

**Explicitly not a stop signal:** slowness, staff unfamiliarity, or the migration taking longer than expected.

---

## 9. Decision index

| # | Decision |
|---|---|
| [#14](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/14) | Convex access: plain HTTP, no client library |
| [#15](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/15) | Persistence: SQLDelight over Room |
| [#16](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/16) | Auth: `@convex-dev/auth` survives |
| [#17](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/17) | Printing: port ESC/POS, adopt nothing |
| [#19](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/19) | Money: `Double` bit-for-bit + reconciliation |
| [#20](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/20) | Shape: parallel app, infrastructure-first |
| [#21](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/21) | Tablet data: adopt in place, convert on open |
| [#22](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/22) | Verification: four mechanical oracles |
| [#23](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/23) | Rollout: one store at a time |
| [#25](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/25) | Transport + repositories |
| [#26](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/26) | Offline auth out of scope |
| [#27](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/27) | Sync v1 now, v2 deferred |

Supporting research: `docs/investigations/2026-09-15-*.md` (Convex client, persistence, auth, printing). Architectural decisions: [ADR 0001](../adr/0001-bound-operational-replication.md), [ADR 0002](../adr/0002-ledger-compatible-money-arithmetic.md).

---

## 10. Open before execution

**[#18 — Measure the rush-hour baseline on the VistaTab](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/18)** is the one item requiring physical hardware, and it has accumulated three purposes:

1. A performance baseline the Kotlin app must beat.
2. Confirmation of which unbounded query shapes still cost time, so they are fixed in the Kotlin design rather than ported into a primitive that re-executes them per invalidation.
3. **Verification that `deviceId` can be read from the existing `expo-secure-store` entry** — source-derived, untested, and a cutover-breaking failure if wrong.

The protocol is `docs/investigations/rush-hour-acceptance.md`. Phase 1 should not complete without item 3.
