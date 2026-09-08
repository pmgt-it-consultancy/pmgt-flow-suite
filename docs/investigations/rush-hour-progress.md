# Rush-hour performance implementation

Baseline: 9d73acb. Spec: GitHub #3 / docs/specs/2026-09-08-rush-hour-performance.md.

Defaults accepted by user: GitHub tracker, canonical triage labels, single-context docs, existing public query/cart/mutation/sync test boundaries. No APK builds. Current branch: hotfix/native-data-performance. Preserve unrelated work.

| Ticket | Work | State |
| --- | --- | --- |
| #4 | Selected-product modifiers | Implementing in task agent |
| #5 | Cart rendering and pending edit flush | Ready |
| #6 | Batched order mutations | Ready |
| #7 | Inactive display subscriptions | Implementing |
| #8 | History and refund query bounds | Ready |
| #9 | Sync diagnostics and queued requests | Ready |
| #10 | Integrated regression and device protocol | Blocked by #4–#9 |
| #11 | Actual VistaTab validation | Requires device; blocked by #10 |

Full suite runs once at integration. Each task records focused red/green evidence and typechecks. Final review uses Standards and Spec axes. Do not close parent #3.
