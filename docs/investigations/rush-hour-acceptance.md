# Rush-hour acceptance protocol

Spec: [#3](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/3). Automated harness: #10. Actual-device acceptance: #11.

No APK is built by this protocol's automated command. Do not run a device workload against a live sales store. Use an isolated test store, test payments and a test printer. Do not clear production app storage or delete unsynced orders to prepare a fixture.

## Automated regression gate

From the repository root:

```sh
pnpm --dir apps/native test:rush-hour
pnpm --dir apps/native typecheck
```

`test:rush-hour` runs the deterministic scaling script, then the complete native Jest suite once. It exits unsuccessfully on any failed assertion. Fixtures are created in process; no production backend or tablet is contacted.

| Boundary | Fixture / assertion |
| --- | --- |
| Tables, history, discounts, takeout | 0 vs 10,000 unrelated history records; two relevant hydrated items in both cases |
| Selected-product modifiers | 1,000 unrelated catalog entries; bounded relevant reads, no reads without selection, ancestry/override and live-change correctness |
| Cart | Rendered rows, rapid taps, failed save/retry, row recycling, edits during an in-flight save, checkout waits for persistence |
| Display subscriptions | Blur unsubscribes, changed scope cannot display old rows, focus refreshes |
| History and refunds | Hydrate displayed history children only; refund reads selected order's modifiers and retains correct replacement totals |
| Order writes | Real Watermelon models/writers with in-memory adapter; coherent batches, invalid draft leaves no partial order, modifier/VAT/SC/PWD totals preserved |
| Sync | Network/database-boundary lifecycle tests, pagination/cursors, queued requests, retry/offline/stop behavior; bounded numeric diagnostic snapshots |

These are correctness and scaling proxies, not SQLite-device timing, GPU, Bluetooth or thermal benchmarks. In-memory database tests do not establish Android adapter failure recovery. The cart harness is not an end-to-end native checkout/navigation test.

## Device run prerequisites

An operator with the VistaTab must perform #11 after a separately authorized build. Compare baseline `9d73acb` with the exact candidate commit, not only the version label (both may be 3.27.2). Use a release-mode candidate for acceptance; a development build can help locate a bottleneck but is not a release latency result. [React Native 0.81 performance guidance](https://reactnative.dev/docs/0.81/performance).

Record:

- Device model, Android version, physical RAM (not RAM expansion), free storage, battery/charging state, thermal state and display refresh rate.
- Commit, app version/code, package name, build mode, Hermes runtime verification, network and printer model/connection.
- Dataset counts per table, active orders, visible cart size, catalog/modifier counts, history days and sync page counts.
- Identical baseline/candidate fixture and scripted actions; three runs each, alternating order where practical. Allow comparable cooldown; keep background apps and network conditions consistent.

Suggested test-store fixture: 1,000 products including category ancestors and overrides, 10,000 historical orders with children, 30 active orders, carts of 1/20/50 lines. Use approved fixture/import tooling or a sanitized test-store snapshot; this change does not add a backend seeder. Record actual counts rather than claiming these volumes were provisioned automatically.

## Repeatable workload

1. Cold-open the populated test store, wait for initial hydration, then repeat warm. Record startup separately from interaction latency.
2. Perform 100 product-to-cart actions per measured run, including plain, modifier, variable-price and discounted items. Record each tap's first visual response and completed cart update separately. Exercise rapid quantity taps followed immediately by checkout and kitchen send.
3. Repeat while another test device creates/updates 10 orders per minute for 15 minutes. Include a multi-page catch-up sync. Record offered and completed order rates, sync duration and local backlog; do not assume a test rate equals the store's real peak.
4. Cycle home, tables, order, takeout and history 20 times; change date/store scopes and return to previously hidden screens. Confirm fresh data, no stale cross-store rows and no accumulating observers/latency.
5. Disconnect/reconnect network, edit during sync, retry a failed save, navigate back with a pending edit and immediately checkout after rapid taps. Verify persisted quantity and charge agree, orders eventually arrive once, and errors remain visible/retryable.
6. Exercise kitchen print, receipt reprint, SC/PWD, void/refund, split/partial payments and repeated action taps using test data. Compare item snapshots, totals and receipt output; do not measure a payment-provider wait as local UI CPU time.
7. Repeat the 15-minute workload four times without restarting (one hour). Sample idle memory before the run and after each cycle with the same two-minute idle interval. Extend to a representative busy shift if the original slowdown takes longer to appear.

Use an external high-frame-rate camera to measure physical tap-to-visible response without adding screen-recording load. Report frame resolution/error and use the same method for both builds. For each run sort the 100 cart latencies and take the 95th value for nearest-rank p95; retain raw measurements, median and maximum. Do not average individual run p95s and call that a pooled p95.

## Frames and memory

Confirm the installed package first (production and staging differ). Read-only examples for staging:

```sh
adb devices -l
adb shell dumpsys package com.pmgtitconsultancy.pmgtflow.stg
adb shell dumpsys meminfo com.pmgtitconsultancy.pmgtflow.stg
adb shell dumpsys gfxinfo com.pmgtitconsultancy.pmgtflow.stg framestats
```

Capture timestamped outputs at matching points. PSS is a process-memory signal, not a JS-only heap or proof of a leak. `gfxinfo` has limited history and renderer coverage; use an Android System Trace/Perfetto frame timeline to correlate UI-thread stalls with sync and confirm frame behavior when summary data is insufficient. The frame budget depends on the actual refresh rate (16.7 ms at 60 Hz, 11.1 ms at 90 Hz). [Android rendering guidance](https://developer.android.com/topic/performance/vitals/render), [dumpsys reference](https://developer.android.com/tools/dumpsys).

For sync phase capture, use the opt-in API and phase definitions in [ticket #9's report](rush-hour-task-9.md). Endpoint elapsed time includes network/server/response work; local apply/read includes Watermelon bookkeeping; the total is inclusive. These measurements are not mutually exclusive CPU slices. Diagnostics retain numeric samples only; do not attach payloads, customer data, auth tokens or payment details to tickets.

## Acceptance and decision record

Proposed gates from the spec: visible tap feedback <=100 ms, p95 product-to-visible-cart <=300 ms, responsive scrolling during incoming sync, and no sustained memory/latency growth. Record frame jank/frozen frames and memory trend alongside these targets; there is no invented universal memory threshold. Explain any plateau versus continuing growth and repeat suspect runs. Any lost edit, incorrect total, duplicated payment or dropped sync write fails acceptance regardless of speed.

| Result | Baseline | Candidate | Gate / evidence |
| --- | --- | --- | --- |
| Commit / device / dataset | Pending | Pending | Exact metadata above |
| Tap feedback / cart p95 | Not measured | Not measured | <=100 ms / <=300 ms |
| Sync-active scrolling | Not measured | Not measured | Trace + operator observation |
| One-hour idle PSS / latency trend | Not measured | Not measured | No sustained growth |
| Money, pending edits, offline delivery, printing | Not device-tested | Not device-tested | All correct |

If remaining time is concentrated in a particular SQL query, inspect its actual query plan before adding an index. If mapping/computation blocks the JS thread, evaluate smaller chunks or a worker/native boundary with measured serialization cost. If layout/rendering dominates, optimize the measured components. Do not parallelize conflicting database/payment writes or migrate frameworks without that evidence. #3 and #11 remain open until the actual-device report and this follow-up decision are recorded.
