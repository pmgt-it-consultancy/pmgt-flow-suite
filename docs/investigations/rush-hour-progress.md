# Rush-hour performance implementation

Baseline: 9d73acb. Spec: GitHub #3 / docs/specs/2026-09-08-rush-hour-performance.md.

Defaults accepted by user: GitHub tracker, canonical triage labels, single-context docs, existing public query/cart/mutation/sync test boundaries. No APK builds. Current branch: hotfix/native-data-performance. Preserve unrelated work.

| Ticket | Work | State |
| --- | --- | --- |
| #4 | Selected-product modifiers | Implemented; focused review and integration tests passed |
| #5 | Cart rendering and pending edit flush | Implemented; focused review and integration tests passed |
| #6 | Batched order mutations | Implemented; includes VAT/SC/PWD regression tests |
| #7 | Inactive display subscriptions | Implemented; lifecycle tests and focused review passed |
| #8 | History and refund query bounds | Implemented; focused review and integration tests passed |
| #9 | Sync diagnostics and queued requests | Implemented; outbox/cursor/restart regressions covered |
| #10 | Integrated regression and device protocol | Implemented; automated gate passed; protocol documented |
| #11 | Actual VistaTab validation | Open; no attached device; requires separately authorized release build |
| #12 | Explicit sync delivery outcome for day closing | Follow-up for triage; existing API/caller limitation, outside this hotfix |

Integration at code candidate `7beaaa2`: `pnpm --dir apps/native test:rush-hour` passed (scaling checks plus 18 suites / 64 tests); native typecheck passed. Full suite ran once, with focused checks per slice before it. Changed-file Biome had no errors; an unused catch binding was subsequently removed, leaving 11 existing imported-function dependency warnings across the two order screens.

Final spec review found two gaps, corrected in `39c4448` (takeout still used store-wide modifier resolution) and `86dc89d` (backlogs beyond 50 pages could not finish safely). After those corrections, a combined rerun of all seven affected suites passed 36 tests; fresh native typecheck and changed-file Biome passed with the 11 warnings noted above. The full suite was not repeated after the focused corrections. See [two-axis review](rush-hour-review.md).

Task reports contain red/green evidence and review outcomes. Final review uses independent Standards and Spec axes against baseline `9d73acb`. No backend changes, APK build, migration or deployment. Hermes and New Architecture were already enabled; version remains 3.27.2. A future build must use the latest candidate commit, not the earlier version-bump commit alone.

Device measurements are **not available**: `adb devices -l` listed no devices. [Acceptance protocol](rush-hour-acceptance.md) defines the repeatable workload and unresolved gates. Do not close parent #3 or #11 until device acceptance; #12 needs separate product/API triage.
