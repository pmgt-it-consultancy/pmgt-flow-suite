# Kotlin POS

Android application alongside `apps/native`. Namespace is `com.pmgt.pos`;
release application ID remains `com.pmgtitconsultancy.pmgtflow` for in-place upgrades.
Debug uses `com.pmgtitconsultancy.pmgtflow.kotlin.dev` and installs separately.

## Build

Install JDK 17+, Android SDK 36, and SDK build tools. Set `sdk.dir` and
`CONVEX_URL=https://your-deployment.convex.cloud` in untracked `local.properties`,
or pass `-PCONVEX_URL=...`. Without a URL the app launches with setup instructions.
Never put credentials or deployment secrets in Gradle properties committed to git.

```sh
./gradlew testDebugUnitTest assembleDebug
./gradlew connectedDebugAndroidTest
```

The instrumentation workflow uses MockWebServer inside the emulator, with synthetic
credentials. It exercises the Compose login, permission gate, lock, online PIN unlock,
and sign-out. It needs no backend credentials. Cleartext HTTP is enabled only in debug.

## Integration boundaries

- `PosApplication.http`, `.auth`, `.lock` are application-scoped services.
- `ConvexHttp.query/mutation/action(path, JsonObject): JsonElement` handles the Convex
  function envelope; `httpAction(path, JsonObject, headers)` targets the `.convex.site`
  HTTP routes and returns their JSON directly. `token` exposes the current bearer;
  normal requests call `freshToken` automatically. No polling or sync state lives here.
- `AuthRepository.state: StateFlow<AuthState>` carries live user/role/assigned store.
  `hasPermission` performs exact membership. Credentials are AES-GCM encrypted using
  Android Keystore, atomically written under `noBackupFilesDir`; no user/permission
  snapshot is persisted and a cold start must validate the user online.
- `PosAuthShell(..., content = { user -> ... })` hosts feature navigation after login.
  Update `lock.setRouteHistory()` when navigating; `CheckoutScreen` suppresses idle
  timers. `LockSnapshot` preserves RN's persisted fields; cooldown is transient.
- `AndroidLockStorage` currently holds Kotlin lock state. Legacy AsyncStorage adoption
  belongs to the database migration task; no legacy data is deleted by this bootstrap.

## Toolchain references

Uses installed/cached AGP 8.13.1, Gradle 8.14.3, Kotlin 2.2.20, compile/target SDK 36.
[AGP compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes)
supports API 36 and requires JDK 17. The
[Compose compiler plugin](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler)
matches the Kotlin plugin version. Requests follow the
[Convex HTTP API](https://docs.convex.dev/http-api/) and the repository's existing
Convex Auth 0.0.x action protocol; no auth dependency upgrade is included.

Release signing must use the existing production key for an in-place upgrade. This
project deliberately contains no signing credentials and does not sign release builds
with the debug key. Physical VistaTab testing has not been performed.
