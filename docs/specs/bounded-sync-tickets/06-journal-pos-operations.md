## Parent

`docs/superpowers/specs/2026-09-11-bounded-operational-sync-design.md`

## What to build

Migrate order edits, discounts, voids, refunds, takeout transitions, transfers, and checkout to versioned business commands while retaining existing offline projections and financial calculations.

## Acceptance criteria

- [ ] Every public native business mutation journals intent before projecting it.
- [ ] Only unsent quantity intent may compact; financial and sent operations never compact.
- [ ] Settle Order atomically covers frozen totals, payments, order state, and table release.
- [ ] Receipt printing remains independently retryable and cannot duplicate payment.
- [ ] Permanent rejection preserves evidence and marks attention required.
- [ ] Tax, discount, modifier, refund, audit, and Origin Tablet rules remain correct.

## Blocked by

- Ticket 05.
