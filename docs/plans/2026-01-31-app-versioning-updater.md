# Implementation Plan: App Versioning & In-App Updater

## Overview
Add proper semantic versioning with a bump script, a Convex-proxied GitHub Releases update checker, and an in-app APK updater for the Android sideloaded app.

---

## Task 1: Install Dependencies

**Goal:** Add required Expo packages for file download and intent launching.

**Command:**
```bash
cd apps/native && npx expo install expo-file-system expo-intent-launcher
```

`expo-constants` is already available via Expo. `expo-file-system` is needed for APK download, `expo-intent-launcher` for opening Android's package installer.

**Verification:** `npx expo install` completes without errors; packages appear in `apps/native/package.json`.

---

## Task 2: Version Bump Script

**Goal:** Create a script that bumps version in `package.json` (source of truth) and syncs to `app.json` and `build.gradle`.

**File to create:** `apps/native/scripts/bump-version.js`

**File to modify:** `apps/native/package.json` — add version scripts

**Details:**

```javascript
// apps/native/scripts/bump-version.js
const fs = require("fs");
const path = require("path");

const type = process.argv[2]; // "patch" | "minor" | "major"
if (!["patch", "minor", "major"].includes(type)) {
  console.error("Usage: node bump-version.js <patch|minor|major>");
  process.exit(1);
}

const pkgPath = path.resolve(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);

let newVersion;
if (type === "patch") newVersion = [major, minor, patch + 1];
else if (type === "minor") newVersion = [major, minor + 1, 0];
else newVersion = [major + 1, 0, 0];

const versionStr = newVersion.join(".");
const versionCode = newVersion[0] * 10000 + newVersion[1] * 100 + newVersion[2];

// 1. Update package.json
pkg.version = versionStr;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 2. Update app.json
const appJsonPath = path.resolve(__dirname, "../app.json");
const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
appJson.expo.version = versionStr;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + "\n");

// 3. Update build.gradle
const gradlePath = path.resolve(__dirname, "../android/app/build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName "[^"]+"/, `versionName "${versionStr}"`);
fs.writeFileSync(gradlePath, gradle);

console.log(`Bumped version to ${versionStr} (versionCode: ${versionCode})`);
```

Add to `apps/native/package.json` scripts:
```json
"version:patch": "node scripts/bump-version.js patch",
"version:minor": "node scripts/bump-version.js minor",
"version:major": "node scripts/bump-version.js major"
```

**Verification:** Run `node apps/native/scripts/bump-version.js patch`, confirm `package.json` → `1.0.1`, `app.json` → `1.0.1`, `build.gradle` → `versionCode 10001`, `versionName "1.0.1"`.

---

## Task 3: Convex Schema — `appConfig` Table

**Goal:** Add an `appConfig` table to store `minRequiredVersion`.

**File to modify:** `packages/backend/convex/schema.ts`

**Details:**

Add after the existing `settings` table definition:

```typescript
// ===== APP CONFIG =====
appConfig: defineTable({
  key: v.string(),
  value: v.string(),
  storeId: v.optional(v.id("stores")),
})
  .index("by_key", ["key"])
  .index("by_store_key", ["storeId", "key"]),
```

Usage: `{ key: "minRequiredVersion", value: "1.2.0" }` stored globally (no `storeId`) or per-store.

**Verification:** `npx convex dev` pushes schema without errors.

---

## Task 4: Convex Backend — Update Check Action & Admin Mutations

**Goal:** Create a Convex action that proxies GitHub Releases API, plus mutations for admin to manage `minRequiredVersion`.

**File to create:** `packages/backend/convex/appUpdate.ts`

**Details:**

The file uses `"use node";` directive and exports:

### 1. `checkForUpdate` (action)
- **Args:** `{ currentVersion: v.string() }`
- **Returns:** Union of `{ updateAvailable: true, latestVersion, downloadUrl, releaseNotes, isForced }` or `{ updateAvailable: false }`
- **Logic:**
  1. Read `GITHUB_TOKEN` and `GITHUB_REPO` from `process.env`
  2. Fetch `https://api.github.com/repos/${repo}/releases/latest` with Bearer auth
  3. Extract `tag_name` (strip leading `v`), compare with `currentVersion` using semver comparison
  4. If no update → return `{ updateAvailable: false }`
  5. Find `.apk` asset in `release.assets`
  6. Call `ctx.runQuery(internal.appUpdate.getMinRequiredVersion, {})` to get forced threshold
  7. `isForced = minRequiredVersion > currentVersion`
  8. Return update info with `apkAsset.url` as `downloadUrl`

### 2. `getApkDownloadUrl` (action)
- **Args:** `{ assetUrl: v.string() }`
- **Returns:** `v.string()` (temporary public download URL)
- **Logic:**
  1. Fetch `assetUrl` with Bearer auth + `Accept: application/octet-stream` + `redirect: "manual"`
  2. GitHub returns 302 redirect to temporary S3 URL
  3. Return the `Location` header value

### 3. `getMinRequiredVersion` (internalQuery)
- **Args:** `{}`
- **Returns:** `v.union(v.object({ value: v.string() }), v.null())`
- **Logic:** Query `appConfig` table with `by_key` index, key = `"minRequiredVersion"`, return first match

### 4. `setMinRequiredVersion` (mutation)
- **Args:** `{ version: v.string() }`
- **Returns:** `v.null()`
- **Logic:** Upsert into `appConfig` — patch existing or insert new

### Semver comparison helper (file-local)
```typescript
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}
```

**Environment variables to add in Convex dashboard (user action):**
- `GITHUB_TOKEN` — GitHub PAT with `repo` scope or fine-grained "Contents: Read"
- `GITHUB_REPO` — e.g. `pmgt-it-consultancy/pmgt-flow-suite`

**Verification:** Deploy, call `checkForUpdate({ currentVersion: "0.0.1" })` from Convex dashboard.

---

## Task 5: React Native — `useAppUpdater` Hook

**Goal:** Create a hook that checks for updates on launch and every foreground resume.

**File to create:** `apps/native/src/features/updater/hooks/useAppUpdater.ts`
**File to create:** `apps/native/src/features/updater/index.ts` (barrel export)

**Details:**

```typescript
// apps/native/src/features/updater/hooks/useAppUpdater.ts
import { useAction } from "convex/react";
import { api } from "@packages/backend";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";

export type UpdateInfo = {
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
  isForced: boolean;
};

export function useAppUpdater() {
  const checkForUpdate = useAction(api.appUpdate.checkForUpdate);
  const getApkDownloadUrl = useAction(api.appUpdate.getApkDownloadUrl);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checkingRef = useRef(false);

  const currentVersion = Constants.expoConfig?.version ?? "0.0.0";

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const result = await checkForUpdate({ currentVersion });
      if (result.updateAvailable) {
        setUpdateInfo({
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
          releaseNotes: result.releaseNotes,
          isForced: result.isForced,
        });
        setDismissed(false);
      } else {
        setUpdateInfo(null);
      }
    } catch (e) {
      console.warn("Update check failed:", e);
    } finally {
      checkingRef.current = false;
    }
  }, [checkForUpdate, currentVersion]);

  // Check on mount
  useEffect(() => { check(); }, [check]);

  // Check on foreground resume
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  const dismiss = useCallback(() => setDismissed(true), []);

  const resolveDownloadUrl = useCallback(
    async (assetUrl: string) => getApkDownloadUrl({ assetUrl }),
    [getApkDownloadUrl],
  );

  return {
    updateInfo: dismissed && !updateInfo?.isForced ? null : updateInfo,
    dismiss,
    resolveDownloadUrl,
    recheckForUpdate: check,
  };
}
```

Barrel export:
```typescript
// apps/native/src/features/updater/index.ts
export { useAppUpdater } from "./hooks/useAppUpdater";
export type { UpdateInfo } from "./hooks/useAppUpdater";
```

**Verification:** Import hook temporarily, confirm console logs update check results.

---

## Task 6: React Native — Update Dialog Component

**Goal:** Create the update UI — dismissable dialog for optional, blocking modal for forced updates, with APK download + install.

**File to create:** `apps/native/src/features/updater/components/UpdateDialog.tsx`

**Details:**

### Props
```typescript
type Props = {
  updateInfo: UpdateInfo;
  onDismiss: () => void;
  resolveDownloadUrl: (assetUrl: string) => Promise<string>;
};
```

### Component structure
- `Modal` with `visible={true}`, `animationType="fade"`
- If `isForced`: solid white background (not transparent), no dismiss
- If optional: semi-transparent backdrop, dismiss on backdrop press or "Later" button
- White card centered: 400px max width, rounded-xl, padding 24
- Title: "Required Update" or "Update Available" — uses `fontFamily: "Bold"`
- Version text: "Version X.Y.Z is available" — `fontFamily: "Regular"`
- Release notes in gray smaller text (if present)
- "Update Now" button: blue (`#0D87E1`) background, calls `handleUpdate`
- "Later" button: gray text, only shown if not forced

### Download + install flow (`handleUpdate`)
1. Set `downloading: true`, show `ActivityIndicator` + progress %
2. Call `resolveDownloadUrl(updateInfo.downloadUrl)` to get temporary S3 URL
3. Use `FileSystem.createDownloadResumable(url, cacheDirectory + "update.apk", {}, progressCallback)` to download
4. On complete, get content URI via `FileSystem.getContentUriAsync(result.uri)`
5. Open Android installer: `IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data: contentUri, flags: 1, type: "application/vnd.android.package-archive" })`

**Verification:** Render with mock data, confirm dialog renders correctly and dismiss works for optional.

---

## Task 7: React Native — `AppUpdateProvider` Wrapper + Integration into App.tsx

**Goal:** Wire updater hook and dialog into the app root.

**File to create:** `apps/native/src/features/updater/components/AppUpdateProvider.tsx`

**File to modify:** `apps/native/App.tsx`

### AppUpdateProvider
```typescript
import React from "react";
import { useAppUpdater } from "../hooks/useAppUpdater";
import { UpdateDialog } from "./UpdateDialog";

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const { updateInfo, dismiss, resolveDownloadUrl } = useAppUpdater();

  return (
    <>
      {children}
      {updateInfo && (
        <UpdateDialog
          updateInfo={updateInfo}
          onDismiss={dismiss}
          resolveDownloadUrl={resolveDownloadUrl}
        />
      )}
    </>
  );
}
```

### App.tsx modification
Wrap content inside `AuthProvider` with `AppUpdateProvider`:

```diff
 import { AuthProvider } from "./src/features/auth";
+import { AppUpdateProvider } from "./src/features/updater/components/AppUpdateProvider";

 <KeyboardProvider>
   <ConvexClientProvider>
     <AuthProvider>
+      <AppUpdateProvider>
         <View style={{ flex: 1 }}>
           ...
         </View>
+      </AppUpdateProvider>
     </AuthProvider>
   </ConvexClientProvider>
 </KeyboardProvider>
```

**Verification:** Launch app, confirm no crash. The updater hook fires silently if no GitHub release exists yet.

---

## Task 8: Android Manifest — Install Packages Permission

**Goal:** Allow the app to install APK packages on Android 8+.

**File to modify:** `apps/native/android/app/src/main/AndroidManifest.xml`

**Details:**

Add inside the `<manifest>` tag (before `<application>`):
```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

**Verification:** Build APK, confirm the permission appears in the merged manifest.

---

## Execution Order

```
Task 1 (install deps) ─────────┐
                                ├──→ Task 5 (hook) ──→ Task 6 (dialog) ──→ Task 7 (integration)
Task 2 (bump script)            │
                                │
Task 3 (schema) ──→ Task 4 (backend action) ─┘

Task 8 (manifest) ── can run anytime, independent
```

- Tasks 1, 2, 3, 8 can all run in parallel
- Task 4 depends on Task 3 (schema must exist)
- Task 5 depends on Tasks 1, 4 (deps installed, API exists)
- Task 6 depends on Task 5 (uses types from hook)
- Task 7 depends on Task 6 (uses dialog component)

## Post-Implementation: User Actions Required

1. **Convex dashboard** — Add environment variables:
   - `GITHUB_TOKEN` — GitHub PAT with `repo` scope or fine-grained token with "Contents: Read"
   - `GITHUB_REPO` — e.g. `pmgt-it-consultancy/pmgt-flow-suite`

2. **GitHub Release workflow** — To release an update:
   1. `cd apps/native && yarn version:patch` (or `:minor` / `:major`)
   2. `git add -A && git commit -m "release: v1.0.1"`
   3. `git tag v1.0.1`
   4. Build APK: `cd apps/native && pnpm build:apk:production`
   5. Create GitHub Release for tag `v1.0.1`, attach the `.apk` file from `android/app/build/outputs/apk/production/release/`
   6. (Optional) To force update: call `setMinRequiredVersion({ version: "1.0.1" })` from Convex dashboard or admin UI

## File Summary

| Action | File |
|--------|------|
| INSTALL | `expo-file-system`, `expo-intent-launcher` |
| CREATE | `apps/native/scripts/bump-version.js` |
| CREATE | `packages/backend/convex/appUpdate.ts` |
| CREATE | `apps/native/src/features/updater/hooks/useAppUpdater.ts` |
| CREATE | `apps/native/src/features/updater/index.ts` |
| CREATE | `apps/native/src/features/updater/components/UpdateDialog.tsx` |
| CREATE | `apps/native/src/features/updater/components/AppUpdateProvider.tsx` |
| EDIT | `apps/native/package.json` (add version scripts) |
| EDIT | `packages/backend/convex/schema.ts` (add appConfig table) |
| EDIT | `apps/native/App.tsx` (wrap with AppUpdateProvider) |
| EDIT | `apps/native/android/app/src/main/AndroidManifest.xml` (add permission) |
