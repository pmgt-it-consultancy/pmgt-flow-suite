# 14 — Verify all phases and prepare cutover

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

A reviewed release candidate has complete parity evidence and a reproducible cutover/rollback procedure.

## Acceptance criteria

- [ ] Each of the five phase gates passes against comparable RN lab data; no phase is marked complete without its evidence.
- [ ] Full suites, type checks, Android build, and two-axis code review complete; every screen and test has an explicit disposition.
- [ ] Emulator identity and performance evidence, sanitized production vectors, and signing/update compatibility are required; explicitly report physical printer and VistaTab checks as unverified per user waiver.
- [ ] Rollout records retain the settled-day/week gates and stop rules; no store is declared migrated by code completion alone.

## Blocked by

- #30
- #31
- #32
- #33
- #34
- #35
- #36
- #37
- #38
- #39
- #40
- #41
