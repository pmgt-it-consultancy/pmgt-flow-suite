# App Versioning & In-App Updater

> **Describes the React Native app's updater.** The Kotlin app (`apps/android`) now has its own
> version line (`versionName = "1.0.0"`, `versionCode = 10000`) and its own release workflow,
> `.github/workflows/release-pos-kotlin.yml`, publishing tag `kotlin-v<version>-<variant>`.
> `checkForUpdate` takes a `product` argument and filters on the `kotlin-` tag prefix so the two
> apps can never be offered each other's APK. The RN release workflow has been retired.
> See memory: kotlin-pos-migration.

## Summary
Implemented a complete in-app update system for the Android sideloaded POS app with semantic versioning, background APK downloads, and GitHub Releases integration.

## Architecture

### Version Management
- **Single source of truth:** `apps/native/package.json` version field
- **Bump script:** `apps/native/scripts/bump-version.js` — syncs version to `package.json`, `app.json`, and `build.gradle` (versionName + versionCode)
- **Scripts:** `pnpm version:patch`, `pnpm version:minor`, `pnpm version:major`
- **versionCode formula:** `major * 10000 + minor * 100 + patch`

### Backend (Convex)
- **`packages/backend/convex/appUpdate.ts`** — `"use node"` file, actions only:
  - `checkForUpdate` action — proxies GitHub Releases API with server-side `GITHUB_TOKEN`, compares versions
  - `getApkDownloadUrl` action — fetches asset URL with auth, returns temporary S3 redirect URL
  - Handler has explicit return type annotation to avoid circular TypeScript inference
- **`packages/backend/convex/appConfig.ts`** — queries/mutations (NO `"use node"`):
  - `getMinRequiredVersion` internalQuery — reads from `appConfig` table
  - `setMinRequiredVersion` mutation — upserts into `appConfig` table
- **Schema:** `appConfig` table in `schema.ts` with `by_key` and `by_store_key` indexes

**IMPORTANT:** Convex `"use node"` files can only contain actions, not queries or mutations. That's why appUpdate.ts and appConfig.ts are split.

### Frontend (React Native)
- **Zustand store:** `apps/native/src/features/updater/stores/useUpdateStore.ts`
  - Global state: updateInfo, downloadStatus, downloadProgress, apkFileUri
  - Actions: checkForUpdate, startDownload, installUpdate, dismiss, reset
  - Uses `@kesha-antonov/react-native-background-downloader` for background APK downloads
  - Uses `expo-notifications` for download progress/completion notifications (with `.catch()` safety)
  - Uses `expo-file-system` only for `getContentUriAsync` (APK installer intent)
  - Uses `expo-intent-launcher` to open Android package installer
  - Store actions receive Convex action functions as parameters (since Zustand is outside React)

- **UpdatesScreen:** `apps/native/src/features/updater/screens/UpdatesScreen.tsx`
  - Full screen with current version, update info, download progress bar, install button
  - Accessible from Settings → "Check for Updates" row
  - Uses `RootStackParamList` type (not `any`)

- **ForceUpdateModal:** `apps/native/src/features/updater/components/UpdateDialog.tsx`
  - Blocking modal for forced updates, redirects to UpdatesScreen

- **Navigation integration:** `apps/native/src/navigation/Navigation.tsx`
  - Checks for updates on mount and every foreground resume via AppState listener
  - Notification response listener: tap "Update ready" notification → triggers APK install
  - ForceUpdateModal rendered when `updateInfo?.isForced`
  - `UpdatesScreen` registered in stack navigator

- **Settings:** Added "Check for Updates" row with current version subtitle

### Import Pattern
Files import `api` from `@packages/backend/convex/_generated/api` (NOT the shorthand `@packages/backend`).

### Android
- `REQUEST_INSTALL_PACKAGES` permission in AndroidManifest.xml
- `@kesha-antonov/react-native-background-downloader` config plugin in app.json

### CI/CD
- **`.github/workflows/release-pos.yml`** — triggers on push to `staging` or `main`
  - `staging` branch → builds staging APK → creates prerelease
  - `main` branch → builds production APK → creates release
  - Version read from `apps/native/package.json`
  - Release notes read from `apps/native/release_notes.txt`
  - Tags created automatically: `v{version}-staging` or `v{version}-production`
  - Old `build-pos.yml` was removed (replaced by this workflow)

### Environment Variables (Convex Dashboard)
- `GITHUB_TOKEN` — GitHub PAT with repo scope
- `GITHUB_REPO` — e.g. `org/repo-name`

## Files Changed
- CREATE: `apps/native/scripts/bump-version.js`
- CREATE: `packages/backend/convex/appUpdate.ts`
- CREATE: `packages/backend/convex/appConfig.ts`
- CREATE: `apps/native/src/features/updater/stores/useUpdateStore.ts`
- CREATE: `apps/native/src/features/updater/index.ts`
- CREATE: `apps/native/src/features/updater/components/UpdateDialog.tsx`
- CREATE: `apps/native/src/features/updater/screens/UpdatesScreen.tsx`
- CREATE: `apps/native/release_notes.txt`
- CREATE: `.github/workflows/release-pos.yml`
- DELETE: `.github/workflows/build-pos.yml`
- EDIT: `packages/backend/convex/schema.ts` (appConfig table)
- EDIT: `apps/native/package.json` (version scripts + deps)
- EDIT: `apps/native/src/navigation/Navigation.tsx`
- EDIT: `apps/native/src/features/settings/screens/SettingsScreen.tsx`
- EDIT: `apps/native/android/app/src/main/AndroidManifest.xml`

## Key Lessons
1. Convex `"use node"` files = actions only. Split queries/mutations to separate files.
2. Circular TypeScript inference in Convex actions requires explicit handler return types.
3. Import `api` from `@packages/backend/convex/_generated/api`, not `@packages/backend`.
4. `expo-file-system` downloads stop when app is backgrounded — use `react-native-background-downloader` for large files.
5. Notification scheduling can fail silently — always `.catch()` errors.
