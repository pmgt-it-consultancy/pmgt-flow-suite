# 13 — Preserve settings and APK update workflow

Approved for implementation. Physical VistaTab testing is waived by the user; record hardware checks as unverified.

## Parent

https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/28

## What to build

Staff use the existing settings and update flow on the Kotlin app.

## Acceptance criteria

- [ ] Inventory all current settings/updater actions and reproduce their user-visible behavior.
- [ ] APK download/install path, version display, package identity, and permission handling are verified.
- [ ] Update cancellation/failure preserves local data; no new distribution service is introduced.

## Blocked by

- #29
