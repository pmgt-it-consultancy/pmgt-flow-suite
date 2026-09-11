# Bounded Sync Acceptance

Date: 2026-09-11

## Automated gates

Run from the repository root:

```bash
pnpm -C packages/backend exec vitest run
pnpm -C packages/backend typecheck
pnpm -C apps/native exec jest --runInBand
pnpm -C apps/native typecheck
pnpm -C apps/native test:query-performance
pnpm -C apps/native test:bounded-sync
pnpm check
```

The bounded harness models 100,000 historical roots separately from 2,000 current-day roots
(approximately 40,000 operational rows), ten device states, and seven unsettled Business Days. It
also checks that the server snapshot source uses the store/date and store/status indexes. Its
reported timings are deterministic synthetic processing measurements, not physical-tablet latency.

## Rollout sequence

1. Deploy the additive backend schema and v2 HTTP routes. Leave all v2 client flags off.
2. Release the native database v3 migration. Verify v1 sync and guarded `Refresh POS Data` on a
   staging tablet.
3. Enable `EXPO_PUBLIC_SYNC_V2=1` for internal/staging builds only. Compare numeric v1/v2 membership
   counts for at least seven Business Days. Do not log order payloads.
4. Investigate every mismatch before enabling scoped repair. Confirm that a failed repair retains
   the prior sidecar replica and that pending journal work blocks repair.
5. Enable server `appConfig.sync_clean_closing_v2=1` for one staging store only after all registered
   devices report current checkpoints. Exercise audited lost-device retirement.
6. Keep v1 routes and reads available as rollback until shadow metrics, closing reconciliation, and
   physical-device performance gates pass for the agreed observation window.

## Physical-device gates still required

- Visible tap response below 100 ms and p95 cart mutation below 300 ms during a 2,000-order day.
- Incoming operational order visible within approximately two seconds across ten real tablets.
- Seven-day offline operation, reconnect, lost acknowledgement, app kill during every repair phase,
  and low-storage behavior.
- Receipt printing, split payments, refund/re-ring, manager PIN workflows, and final Z-Report totals.
- Clock drift warnings at two minutes and final-closing block at ten minutes.

Synthetic tests do not establish these physical-device results. Record device model, OS version,
database size, Wi-Fi conditions, p50/p95/max timings, and any mismatch counts during the rollout.
