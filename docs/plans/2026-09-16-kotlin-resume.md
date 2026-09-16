# Kotlin migration — resume checkpoint, September 16

## Start here

FREEZE CLEARED September 16 by the controller session. Read `root-integration-report.md` first: it
supersedes the freeze text and the two printer findings below. Current tree compiles; full host
suite is 45 classes / 239 tests / 0 failures, lint is clean (`lintDebug` and `lintVitalRelease`) and
both the debug and the first-ever unsigned release APK build. The Android connected suite reaches
65/65 but is NOT reliably green — read `final-verification-report.md` before relying on it; `printer-fixtures.cjs --check` verifies 9 fixtures;
`compileDebugAndroidTestKotlin` passes. Still UNCOMMITTED.

Done since the handoff: Task 13 compile and focused GREEN restored (7/7); both printer-settings
review findings fixed with regression tests; cash drawer ported end to end with a native-derived
byte fixture; the missing Android device-access adapter added; the Software Update screen and both
update dialogs added; Settings / Printers / Software Update / Day Closing wired into
`PosBrowseRoot` and `MainActivity`; kitchen printing wired into the order editor; receipt preview
after checkout ported and wired with the post-commit drawer pulse. A debug APK was assembled at
13:10 and installed over the existing emulator app (data preserved); it boots clean to the lock
screen. The PIN was not available, so no authenticated route was seen running.

Also done: history reprint with its awaited server audit and the paid-detail receipt preview;
printer connection polling, foreground poll and native ACL connect/disconnect with the source
backoff; and both long-standing Android instrumented failures diagnosed and fixed at the root cause
(see `android-failure-diagnosis.md`).

Task 12 review and the two-axis `code-review` are both DONE; their findings were fixed and are
recorded in `final-verification-report.md`.

Next actions, in order: condition-based waiting across the instrumented UI tests (the remaining
connected-suite flakiness), then the remaining acceptance gates: authenticated route screenshots against the RN
references, sanitized money vectors, adoption/rollback/signing evidence, and physical printer,
drawer, paper and cut acceptance on the user's hardware.

Known deviations to carry forward: the source never requests POST_NOTIFICATIONS, so updater
notifications are silently dropped on Android 13+ until granted in system settings — left as-is for
parity rather than invented. `CheckoutStore` carries no socials, so `storeSocials` is always empty
on the Kotlin checkout receipt.

Branch `feat/kotlin-pos-migration`, committed HEAD `fa8128ae099bac09c5aca4c12620d1c1d03bc804`, migration baseline `ede976f4c566b055fb47c8a9b6b412ecf880acac`. Significant later implementation is UNCOMMITTED. Do not reset, clean, switch branches, use worktrees or repeat completed tasks. Inspect git status and the live agent inventory first.

Authority: issue #13 decisions, #28 spec, `docs/specs/2026-09-15-kotlin-pos-parity.md`, ADR0001/0002 and `docs/plans/2026-09-15-kotlin-execution.md`. This checkpoint does not replace their contracts. User requires 1:1 RN UI/UX, all existing printing features, Bluetooth including cash drawer and ESC/POS. Only VistaTab-specific testing is waived. Forced-update blocking-dialog repair is explicitly approved; no redesign or update bypass.

## Ticket disposition

| Ticket | Current evidence | Remaining before acceptance |
|---|---|---|
| #29 Auth | Core reviewed; live login/captures | Repeated manager-Back Android failure; lock/login visual parity |
| #30 Adoption | Reviewed library; 27 host/9 Android historical | Final integrated identity/rollback/install-over evidence; startup optimization commit |
| #31 Sync | Reviewed v1; live staging Synced; 21 focused live-fix and 14 startup tests clean | Commit reviewed live fixes; final comparable reconnect/integration evidence |
| #32 Money | 1,188 money/51 checkout/30 discount/34 correction oracle scenarios recorded | Sanitized real-store vectors with provenance; final gate |
| #33 Catalog | Reviewed; historical 63 host/29 Android | Matched lab/visual acceptance |
| #34 Browse | Reviewed; historical 57 host/18 Android; populated live routes | Residual visual differences; status/action integration; current visual commits |
| #35 Orders | Reviewed; historical 84 host/40 Android | Kitchen integration, editor visual parity and final lab/reconnect scenario |
| #36 Reconciliation | COMPLETE scoped backend: d77839f/c371ff9/88f6b83, 253 tests + tsc/Biome, clean review | Deployment/cutover are separate, not claimed |
| #37 Checkout | Reviewed through2e6ff60; 123 host/10 affected Android | Final live/backend/visual gate; printing integration in #39 |
| #38 Corrections | Uncommitted; 34 RN scenarios; last full Android57/59 | Diagnose two failures, independent review, final verification/commit |
| #39 Printing | Pure bytes and transport reviewed; settings focused28/28 and8 fixtures; Android tests compile | Settings review and stale socket retirement, runtime device adapter/drawer, all caller/preview/audit/root integration, actual hardware |
| #40 Closing | New UI/controller/HTTP/Z formatter;17/17 focused tests and forced compile GREEN | Independent review, root wiring, matched capture and final dependencies/hardware |
| #41 Settings/updater | Earlier production compile passed; last focused7 tests/1 failure; final UI/harness edit unrun | First compile final edits, focused GREEN, missing update UI/dialogs, review, root/lifecycle and isolated install verification |
| #42 Acceptance | RN35 captures/all14 routes; Kotlin29 captures | Complete integrations, fix tests/UI, vectors/adoption/signing/rollback, final suites/build/two-axis review/commit |

All test counts above are scoped/historical unless explicitly described otherwise. No all-green final suite, production deployment or cutover claim. Parent issues #13/#28 remain open.

## Current ownership and next sequence

- `printer_resume` (GPT-5.6-sol): FROZEN for user-requested handoff, no active process. Final focused28/28,8 oracle fixtures and Android-test compilation passed. Two hardening REDs (concurrent flag snapshots; reconnect completing after removal) now GREEN. Independent settings review pending. Late unpatched finding: state token suppresses a removed printer's late reconnect status, but a successful stale connect may leave its underlying socket active. Retire that exact stale connection without closing a newer same-address operation; test at the connection/workflow seam. Real Android device-access adapter and drawer bytes are still absent.
- `ui_resume` (GPT-5.6-sol): closing slice ready for review,17/17 tests. `DayClosingScreen(storeId,controller,onBack)`, `HttpClosingRepository(http)`; controller uses real pendingActions, sync delivery, immutable print calls, selected receipt width, network, scope/session ownership and clock. Root untouched.
- `startup_resume` (GPT-5.6-sol): Settings/updater; compile-ready checkpoint, behavior tests/UI work ongoing. Approved forced-route repair pending verification.
- Controller owns emulator, MainActivity/PosBrowseRoot integration assignment, final verification/review/commit. Assign exactly one root integrator; preserve dirty Task10 changes. See local `root-integration-checklist.md`.

Shared Gradle compilation repeatedly failed because another worker introduced unresolved declarations/signature changes. Keep production/test declarations compile-ready and serialize Gradle ownership plus short source freezes. Missing-symbol failures are not behavioral RED. Run focused tests regularly; one consolidated full suite at end, then supplied `code-review` standards/spec axes and scoped commit on current branch. No broad commit of unrelated files.

## Resume artifacts and runtime

Detailed local reports, reviews, failure logs and image indices: `.superpowers/sdd/2026-09-15-kotlin-execution/`. This directory is ignored: preserve it for same-machine handoff; a GitHub-only resume cannot assume it exists. Read `progress.md` plus latest task reports and this checkpoint; older report prose may predate later clean review recorded in ledger.

- `task-10-report.md` and `task-10-artifacts/second-full-results`: latest57/59; auth manager Back and takeout refund manager-open failures. Focused passes do not explain them. No weakened assertions/timeouts.
- `task-12-report.md`, `printer-settings-report.md`, `printer-byte-parity-report.md`, `printer-platform-report.md`, `task-13-report.md` when finalized.
- `rn-screen-reference/README.md`, `kotlin-screen-reference/README.md`, `screenshot-parity-findings.md`. Screenshots cover routes, not every state; font/weight/dimming/spacing drift remains.
- Latest installed APK checkpoint: September16 12:00 build, `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Does not include completed printer/closing/updater integration. Do not mistake a newer overwritten artifact for this verified build.
- Emulator5554 Pixel_Tablet_API_35,2560x1600,density320. Controller owns it. RN staging package `com.pmgtitconsultancy.pmgtflow.stg`; Kotlin `com.pmgtitconsultancy.pmgtflow.kotlin.dev`. Never run both sync clients concurrently; RN force-stopped at checkpoint. Do not clear either app's data.
- Staging synthetic manager/cashier authorized by user; credentials/PIN are not in this document. Ignored native `.env.local` selects staging; original `.env` unchanged. Metro8081 session63334 may need checking, not assumed alive after resume.
- JDK `/Users/solstellar/Library/Java/JavaVirtualMachines/corretto-17.0.13/Contents/Home`; Android SDK `/Users/solstellar/Library/Android/sdk`.

## Safety and tracker gotchas

Unreadable SecureStore identity blocks, never regenerate; real crypto fixtures use isolated preferences and UUID test aliases, never live key_v1. Preserve JS binary64 rounding and v1 sync. Cached-session offline auth is not implemented; do not infer it from comments. Cash-drawer/print failures cannot replay financial work. Physical output is not proven by successful socket writes.

GitHub repo `pmgt-it-consultancy/pmgt-flow-suite`: default account `paotea-rms` reads but writes return misleading404. Authorized writer is `Pipaolo`; switch only for scoped tracker writes, restore previous account afterward. No token/credential content in reports. Unrelated `.serena/project.yml`, `.claude/.gitkeep`, `.drift/`, `output/`, `tmp/` must remain excluded from migration commits. No deployment, production seeding or cleanup is authorized by this checkpoint.
