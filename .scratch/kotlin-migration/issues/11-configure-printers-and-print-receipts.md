# 11 — Configure printers and print receipts

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

Staff select printers and print customer receipts, kitchen tickets, and reprints.

## Acceptance criteria

- [ ] ESC/POS bytes match shared RN reference fixtures including per-call styles and cut commands.
- [ ] SPP connection, fallback, permissions, stored settings, and failure/retry behavior are exercised.
- [ ] Audit ordering and reprint semantics match RN; actual printer acceptance is recorded separately.

## Blocked by

- #38
