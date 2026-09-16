# Kotlin POS Migration (apps/android)

The Android POS was rewritten from React Native to native Kotlin/Jetpack Compose. Merged to
`staging`. This is the app under active development; `apps/native` is now the porting reference.

## Non-negotiable framing

**It is a 1:1 port.** Behaviour is defined by `apps/native`, not by what looks correct. Read the RN
source before changing Kotlin behaviour. Quirks preserved on purpose — do not "fix" without a ticket:

- Receipt preview's kitchen button is gated on the **receipt** printer's connection and bypasses
  `kitchenPrintingEnabled`.
- Receipt header keeps the raw `cardPaymentType`; the Other-to-custom substitution belongs to the
  payment record only.
- Store socials are never printed — RN hardcodes `socials: undefined`. A review finding against
  this was raised and correctly rejected.

## It is a separate application

Ships as `com.pmgt.pos` ("PMGT Flow POS"), installed **alongside** the RN app, not replacing it.
Consequences:

- Android isolates per-application storage, so the Kotlin app **cannot** inherit the RN app's
  SecureStore device identity or its unsynced rows. In-place tablet adoption is impossible.
- Cutover is therefore **drain then switch**: RN reaches a clean sync, then the till moves over.
  Rollback = switch back, since RN is never uninstalled.
- Update channel is namespaced: `.github/workflows/release-pos-kotlin.yml` publishes
  `kotlin-v<version>-<variant>`, and `checkForUpdate` filters on the `kotlin-` prefix via its
  `product` arg so neither app is offered the other's APK.
- The RN release workflow has been retired.

## Structure

Package root `com.pmgt.pos`, mirroring the RN feature folders: `browse/`, `catalog/`, `orders/`,
`checkout/`, `printer/`, `settings/`, `closing/`, `updater/`, `sync/`, `db/`, `auth/`,
`transport/`, `money/`.

## Build variants

Gradle, outside the pnpm/Turborepo graph. Secrets via Gradle properties or
`apps/android/local.properties` — never checked in.

| Variant   | Suffix   | Convex URL property                      |
| --------- | -------- | ---------------------------------------- |
| `debug`   | `.debug` | `CONVEX_URL_DEVELOPMENT` → `CONVEX_URL`  |
| `staging` | `.stg`   | `CONVEX_URL_STAGING` → falls back to dev |
| `release` | —        | `CONVEX_URL_PRODUCTION`                  |

Version line is its own: `versionName = "1.0.0"`, `versionCode = 10000` (MMmmpp).

## Persistence

SQLDelight drives the **legacy WatermelonDB file** at the app data root —
`AndroidDatabase.legacyPath` strips `/databases`, so the DB is NOT in `databases/`. Uses the exact
generated DDL in `LegacyDdl.kt`; never substitute SQLDelight's logical `Schema.create`.

## Platform lessons (each cost real debugging time)

- Android 16 ignores `screenOrientation` on large screens without
  `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`. Both set; landscape is mandatory.
- A Compose `Dialog` has its own window and does **not** inherit the activity's immersive flags.
  Every dialog must call `HideSystemBarsInDialog()`.
- Never key a `Dialog` on a value that can change while it is open — the key change destroys and
  rebuilds the window, so the sheet visibly dismisses and reopens. This caused a real defect in
  `ProductOptionsSheet` (fixed in `8384a11`).
- Bluetooth first connect races the OS bonding dialog: retry once after 800 ms, but only if the
  device really is in the paired list.
- `ComposeTestRule` runs frames on whichever thread resumes `TestMonotonicFrameClock`. A repository
  emitting from `Dispatchers.IO` will compose off-main and crash. Tests use a Main-delivery
  repository; production still queries on IO.
- Structured concurrency: rethrow `CancellationException` **before** any generic `catch`, or a
  disposed screen surfaces as a bogus user-facing error.

## Known open issue

The initial full sync pull is **all-or-nothing**: the watermark `__watermelon_last_pulled_at` only
advances when the whole pull finishes, so an interrupted first sync restarts from scratch.
Measured ~5 m 20 s per 22 000 rows. Suggested fix: checkpoint per page in `SyncManager.syncOnce`.

## Verification gates

Android host suite (`:app:testDebugUnitTest`) and `:app:lintDebug` at **0 errors** are the fast
gate. The **instrumented** suite reaches 65/65 but is NOT reliably green — test-authoring debt,
tracked in #42. Never report it as passing.

`connectedDebugAndroidTest` **uninstalls the app under test**, wiping its data. Do not run it
against a tablet holding data you care about.

## Tracker

Parent map #13, spec #28 (both stay open). Closed as implementation-complete: #31, #34, #35, #37,
#38, #41. Open on acceptance evidence: #29, #32, #33, #39, #40, #42. **#30 needs re-scoping** — its
in-place adoption premise is void now that this is a separate app.

Related: [[app-versioning-and-updater]], [[android-tablet-landscape-fullscreen]]
