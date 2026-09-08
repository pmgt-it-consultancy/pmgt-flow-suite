# Ticket #8: history and refund scope

History now applies search/status/sort/limit before querying child items. The React hook regression returned the correct three results before the fix but read 200 item models; it now reads 3, including when search changes.

Refund modifier queries now cover the paid order's active items, including retained items needed for replacement-order construction. A test using real WatermelonDB models/writers with the in-memory Loki adapter verifies a 20-peso refund and a 25-peso remaining order including a 5-peso modifier. Storage-boundary modifier reads decreased from 3 to 2, excluding the unrelated modifier and including the replacement copy.

RED: focused history test failed expected 3 / received 200. Focused refund test failed expected 2 / received 3.
GREEN: pnpm --dir apps/native exec jest src/features/voids/services/voidMutations.test.ts src/sync/dataSources/useOrderHistoryQuery.test.tsx --runInBand --silent; 2 suites / 2 tests passed.

Typecheck passed after the history change; subsequent global typecheck encountered the cart task's in-progress test interface. Integration typecheck remains required after all task edits finish. Tests do not measure SQLite latency on the tablet.
