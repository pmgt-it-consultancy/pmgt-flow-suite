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

## Deployment
```bash
# Vercel (from apps/web)
cd ../../packages/backend && npx convex deploy --cmd 'cd ../../apps/web && turbo run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

## Pre-Commit
```bash
pnpm typecheck && pnpm check
```
