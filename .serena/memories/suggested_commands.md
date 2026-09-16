# Suggested Commands

## Development Commands

### Installation
```bash
pnpm install
```

### Running Development Servers
```bash
pnpm dev                # Run ALL apps (web, native, backend) with Turbo
```

### Individual App Commands
```bash
# Web app
cd apps/web && pnpm dev
cd apps/web && pnpm lint

# Native app
cd apps/native && pnpm ios
cd apps/native && pnpm android
cd apps/native && pnpm start

# Backend
cd packages/backend && pnpm vitest          # Watch mode
cd packages/backend && pnpm vitest run      # Single run
```

### Android (Kotlin) — Gradle, NOT pnpm/turbo
```bash
cd apps/android
./gradlew :app:testDebugUnitTest    # host unit tests — the fast gate
./gradlew :app:lintDebug            # must stay at 0 errors
./gradlew :app:installDebug         # build + install on connected tablet
./gradlew :app:assembleStaging      # staging variant
./gradlew :app:assembleRelease      # release variant (needs signing config)

# WARNING: this UNINSTALLS the app under test, wiping its data
./gradlew :app:connectedDebugAndroidTest
```
The Android instrumented suite is NOT reliably green (tracked in #42). Host tests + lint are the
gate to trust.

### Code Quality
```bash
pnpm typecheck          # TypeScript checking across all packages
pnpm lint               # Biome linting
pnpm format             # Biome formatting
pnpm check              # lint + format combined
pnpm build              # Build all packages
```

### Adding Dependencies
```bash
cd apps/web && pnpm add package-name
cd apps/native && pnpm add package-name
# or: cd apps/native && npx expo install package-name
cd packages/backend && pnpm add package-name
```

## Environment Variables

### Convex Dashboard
- `OPENAI_API_KEY` — Optional, for AI summaries

### apps/web/.env.local
- `NEXT_PUBLIC_CONVEX_URL`

### apps/native/.env.local
- `EXPO_PUBLIC_CONVEX_URL`

### apps/android/local.properties (gitignored; Gradle properties also work)
- `sdk.dir`
- `CONVEX_URL` (or `CONVEX_URL_DEVELOPMENT`), `CONVEX_URL_STAGING`, `CONVEX_URL_PRODUCTION`
- `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` — release signing only

NOTE: there is no separate staging Convex deployment. `packages/backend/.env.local` has both a
`# Production` and a `# Staging` block and both point at the dev deployment, so the Android
`staging` variant falls back to the dev URL unless `CONVEX_URL_STAGING` is set.

## Deployment
```bash
# Vercel (from apps/web)
cd ../../packages/backend && npx convex deploy --cmd 'cd ../../apps/web && turbo run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

## Pre-Commit
```bash
pnpm typecheck && pnpm check
# plus, if apps/android changed:
cd apps/android && ./gradlew :app:testDebugUnitTest :app:lintDebug
```

## Convex CLI asymmetry (dangerous)
- `npx convex deploy` defaults to **PRODUCTION** and does not accept `--prod`. Never run it bare.
- `npx convex run` / `import` / `data` default to whatever `.env.local` points at (dev).
- Pass `--prod` explicitly and deliberately for production reads.
