## Context

Discovered while implementing #9 under performance spec #3. This is an existing sync API/caller contract issue, not a claimed performance regression. It is a follow-up for triage, outside the seven code tickets in the current hotfix.

## Evidence

`SyncManager.syncNow()` resolves on attempted failure, offline/stopped state and backoff; completion is not proof of outbox delivery. `apps/native/src/features/day-closing/screens/DayClosingScreen.tsx` awaits it before `generateReport`, without checking delivery success. The sync hotfix preserves this public failure contract because other callers fire-and-forget.

## What to decide and implement

Provide an explicit sync/delivery outcome or a separate delivery-required operation, and coordinate day-closing callers with that contract. Do not simply make all background sync calls reject. Establish how an offline close should behave before changing operator behavior.

## Acceptance criteria

- [ ] Define success for report generation, including rejected rows and outstanding local writes.
- [ ] A failed/offline/backoff sync cannot silently be treated as confirmed delivery by day closing.
- [ ] Present an actionable retry/offline message and preserve duplicate report protections.
- [ ] Test successful delivery, rejected writes, network failure, backoff, offline and fire-and-forget callers.
- [ ] Preserve financial/report policy; obtain a product decision if offline closing behavior needs to change.

## Blocked by

#9
