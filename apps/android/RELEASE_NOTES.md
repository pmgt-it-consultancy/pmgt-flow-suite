## What’s new

### Complete native POS workflow

- Adds the Kotlin POS as an independently installable app with authentication, screen lock, catalog browsing, modifier selection, order entry, checkout, receipt printing, settings, day closing, and in-app updates.
- Preserves existing order and payment behavior with shared money, printer, correction, and Z-report fixtures.

### Safer tablet commissioning

- Binds each tablet to one store and adds managed move and retirement workflows.
- Refuses a replica from another store, recovers adoption after delayed connectivity, and prevents unsafe store changes while local work is pending.
- Blocks day closing when financial reconciliation finds a totals mismatch.

### Faster, clearer operation

- Reduces a representative adopted-tablet cold start from about 104 seconds to 10–13 seconds while keeping the session splash visible during restore.
- Retries transient Convex query failures and shows the server’s diagnostic message when recovery is exhausted.
- Adds Firebase Crashlytics and Analytics for release diagnostics.

### Tablet and interface fixes

- Keeps the POS in landscape on Android 16 tablets.
- Fixes product-sheet reloads, modifier input preservation, status indicators, home-card sizing, printer reconnects, PIN entry, manager unlock, logout recovery, and kiosk behavior.

## Rollout requirement

Deploy the matching backend and run the `devices.manage` role backfill before assigning device-management roles in production.

## Verification

- 295 Android host tests passed.
- Android `lintDebug` passed.
- 269 backend tests passed.
- Backend type checking passed.
