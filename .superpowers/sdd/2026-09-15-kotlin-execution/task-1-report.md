# Task 1 — Kotlin launch and sign-in (#29)

## Result

Buildable standalone Compose Android app, reusable OkHttp Convex transport, online
Convex Auth sign-in/refresh/sign-out, assigned store, exact role permission membership,
Keystore-encrypted atomic token storage, and persisted screen lock with online PIN and
manager override. Debug package: `com.pmgtitconsultancy.pmgtflow.kotlin.dev`; release
package: `com.pmgtitconsultancy.pmgtflow`, verified against RN `app.config.ts`.

Parent ruling: match RN assigned `user.storeId`; do not add a store picker despite the
ticket's broad “select store” wording. User waived VistaTab testing. No hardware result
is claimed. `PosAuthShell` supplies an actual login/store/lock shell; feature content is
an injectable composable for subsequent POS migration tasks.

## TDD and verification

Approved seam: public HTTP/auth workflow with MockWebServer, and Compose workflow.
Used `/Users/solstellar/.agents/skills/tdd/SKILL.md`.

1. RED: `apps/android/gradlew -p apps/android testDebugUnitTest --tests '*AuthWorkflowTest*'`
   failed at compile because `ConvexHttp`, `AuthRepository`, `MemorySessionStorage` did
   not exist. Implemented sign-in/transport and reran: green, 1 workflow test, 4 seconds.
2. RED: added expired-refresh behavior; the same command failed with 2 tests / 1 failure:
   HTTP 560 `Invalid refresh token` kept the old identity. Fixed terminal refresh rejection.
3. RED: `apps/android/gradlew -p apps/android testDebugUnitTest --tests '*AuthWorkflowTest.server revoked*'`
   failed 1 test / 1 failure because HTTP 401 preserved the signed-in state. Fixed logout
   on server identity rejection.
4. Final: `apps/android/gradlew -p apps/android testDebugUnitTest --tests '*auth.*' assembleDebug connectedDebugAndroidTest`
   **BUILD SUCCESSFUL in 10s**, 76 tasks, 8 executed / 68 up-to-date.
   JVM results: 7 auth + 2 lock tests, zero failures. Device results: 1 Compose workflow,
   zero failures on `emulator-5554`, Android 15 / API 35 tablet emulator.

Contract coverage: correct bearer/protocol envelope, sign-in and exact permissions,
rotated refresh persistence, unauthenticated refresh, sign-out despite server outage,
friendly RN error text, denied offline cold start, role removal, expired refresh and
revocation, lock/restart/cooldown fields, online-only PIN, route history preservation,
idle warning and checkout suppression. UI runner: email/password sign-in → assigned
store and cashier permission gate → lock → 1234 PIN unlock → sign-out.

Reports: `apps/android/app/build/reports/tests/testDebugUnitTest/` and
`apps/android/app/build/reports/androidTests/connected/debug/` (generated, untracked).
APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

## Interfaces for downstream tasks

- `PosApplication.http`, `auth`, `lock` are app-scoped services.
- `ConvexHttp(deploymentUrl, client = OkHttpClient(), siteUrl = derived)` exposes
  `suspend query/mutation/action(path, args: JsonObject = {}): JsonElement`.
  `httpAction(path, args, headers = emptyMap())` posts directly to `.convex.site`,
  including optional device headers. `token: String?` is the public current bearer.
  `freshToken` is populated by AuthRepository; transport refreshes before requests.
- `AuthRepository.state: StateFlow<AuthState>` contains `user`, `loading`, `error`,
  `isAuthenticated`, `selectedStoreId` (= assigned user store). `SignedInUser` has
  `id/name/email/storeId/role`; role has `id/name/permissions/scopeLevel`.
  `signIn`, `restore`, `reloadUser`, `freshAccessToken(forceRefresh)`, `signOut` and
  `hasPermission` are public. Refresh serialization uses a Mutex and persist-before-use.
- `SessionStorage.read/write` stores tokens only. Android implementation uses native
  AtomicFile + AES-GCM Keystore in `noBackupFilesDir`, a smaller credential-only
  implementation than the research's proposed future offline-session DataStore.
- `LockState.state` includes `LockSnapshot` and transient cooldown/warning. Snapshot
  matches RN persisted field names. `setRouteHistory`, `setCurrentRoute`, `configure`,
  `tick`, `onBackground/onForeground`, `lock/unlock/clearLock` are public.
- `PosAuthShell(auth, lock, http, configured, content = { user -> ... })` wraps feature
  navigation. Navigation must call `lock.setRouteHistory` with RN route names so
  checkout timer exemption and restoring the pre-lock route work.

## Files and limits

Own files: Android Gradle root/app config and wrapper, manifests, MainActivity,
`auth/`, `transport/ConvexHttp.kt`, auth JVM/instrumentation tests, README and this report.
Money files created by parent are excluded from this task's commit.

No backend edits, production login, production deployment, RN E2E comparison, physical
VistaTab check or signing-key upgrade test was performed. Cross-app comparison is
owned by the final parity runner. Legacy credential/lock/device adoption remains Task 2;
current Kotlin storage does not delete RN storage. No offline auth has been introduced.
The shell polls current user every 30 seconds for role changes; unlike RN's websocket,
permission changes have up to that polling delay. PIN and manager override use existing
server actions; no hashes or PINs are cached. Release remains unsigned until existing
production signing configuration is supplied.

Toolchain references checked live: [AGP 8.13](https://developer.android.com/build/releases/agp-8-13-0-release-notes),
[Compose plugin](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler),
[Convex HTTP](https://docs.convex.dev/http-api/). Installed compatible versions used:
AGP 8.13.1, Gradle 8.14.3, Kotlin/Compose compiler 2.2.20, SDK 36, OkHttp 4.12.0.
