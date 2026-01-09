# Suggested Commands

## System Commands (Windows)
- `dir` - List directory contents (or `ls` if Git Bash/PowerShell alias)
- `type` - Display file contents (like `cat`)
- `findstr` - Search text in files (like `grep`)
- `where` - Find executable location (like `which`)
- `cd` - Change directory
- `mkdir` - Create directory
- `del` - Delete file
- `rmdir /s` - Delete directory recursively

## Development Commands

### Installation
```bash
yarn                    # Install all dependencies
```

### Running Development Servers
```bash
npm run dev             # Run ALL apps (web, native, backend) with Turbo TUI
                        # Use arrow keys to switch between logs
```

### Individual App Commands
```bash
# Web app
cd apps/web
npm run dev             # Next.js dev server
npm run build           # Production build
npm run lint            # ESLint

# Native app
cd apps/native
npm run dev             # Expo start
npm run ios             # iOS simulator
npm run android         # Android simulator

# Backend
cd packages/backend
npm run dev             # Convex dev server
npm run setup           # Initial Convex setup (run once)
```

### Code Quality
```bash
npm run typecheck       # TypeScript checking across all packages
npm run format          # Prettier formatting
npm run build           # Build all packages
npm run clean           # Clean all build artifacts and node_modules
```

### Convex Backend
```bash
cd packages/backend
npm run dev             # Start Convex dev server (hot reload)
npm run setup           # Initial setup (creates project, waits for env vars)
npx convex deploy       # Deploy to production
```

### Adding Dependencies
```bash
cd apps/web && yarn add package-name        # Add to web app
cd apps/native && yarn add package-name     # Add to native app
cd packages/backend && yarn add package-name # Add to backend
```

## Environment Variables

### Convex Dashboard (Required)
- `CLERK_ISSUER_URL` - From Clerk JWT template
- `OPENAI_API_KEY` - For AI summaries (optional)

### apps/web/.env.local
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

### apps/native/.env.local
- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`

## Deployment
```bash
# Vercel deployment (from apps/web)
cd ../../packages/backend && npx convex deploy --cmd 'cd ../../apps/web && turbo run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```
