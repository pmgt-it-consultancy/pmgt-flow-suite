# 12 — Close the Business Day with reconciliation evidence

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

Managers review closing status and print the same reports, with unresolved Totals Divergences preventing final closing.

## Acceptance criteria

- [ ] Existing report and Sync-Clean semantics remain intact; divergence is exposed through closing attention state.
- [ ] Resolution is attributable and cannot dismiss a discrepancy without evidence; unresolved discrepancies continue blocking.
- [ ] Z-Report totals and bytes match the reference; failures cannot incorrectly declare a settled day.

## Blocked by

- #36
- #38
- #39
