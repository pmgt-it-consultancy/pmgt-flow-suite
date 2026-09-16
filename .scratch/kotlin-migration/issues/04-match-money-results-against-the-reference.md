# 04 — Match money results against the reference

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

The app totals representative orders exactly as RN does using shared fixtures.

## Acceptance criteria

- [ ] Public money operations match reference outputs including VAT normalization, SC/PWD, voids, and rounding boundaries.
- [ ] Fixtures include sanitized real-store amounts with provenance; synthetic-only coverage cannot satisfy the final gate.
- [ ] The app preview and offline calculations use the verified implementation.

## Blocked by

- #29
