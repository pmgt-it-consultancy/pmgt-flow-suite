# POS Android Build Workflow

## GitHub Secrets Setup

Add the following secrets in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `CONVEX_URL_STAGING` | Staging Convex deployment URL |
| `CONVEX_URL_PRODUCTION` | Production Convex deployment URL |
| `KEYSTORE_BASE64` | Base64-encoded release keystore |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias (use `pmgt-flow`) |
| `KEY_PASSWORD` | Key password |

## Generate Release Keystore

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore apps/native/android/app/pmgt-flow-release.keystore \
  -alias pmgt-flow \
  -keyalg RSA -keysize 2048
```

## Encode Keystore for GitHub Secret

```bash
base64 -i apps/native/android/app/pmgt-flow-release.keystore | pbcopy
```

Paste the clipboard contents as the `KEYSTORE_BASE64` secret.

## Build Triggers

- Push to `staging` → builds **Staging** APK (`com.pmgtitconsultancy.pmgtflow.stg`)
- Push to `main` → builds **Production** APK (`com.pmgtitconsultancy.pmgtflow`)

## Local Build Commands

```bash
# Staging debug
pnpm --filter pmgt-flow-native run android:staging

# Staging release APK
pnpm --filter pmgt-flow-native run build:apk:staging

# Production release APK
pnpm --filter pmgt-flow-native run build:apk:production

# Production AAB (Play Store)
pnpm --filter pmgt-flow-native run build:aab:production
```
