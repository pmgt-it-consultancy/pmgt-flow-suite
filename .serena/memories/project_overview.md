# Project Overview

## Purpose
pmgt-flow-suite is a fullstack monorepo note-taking application with AI summarization. It features both web and mobile frontends that share a common backend.

## Tech Stack
- **Monorepo Management**: Turborepo 2.6.2
- **Package Manager**: Yarn 1.22.22
- **Node.js**: >= 20.19.4
- **Language**: TypeScript 5.9.3 (100% TypeScript)

### Web App (apps/web)
- React 19.2.2
- Next.js 16.0.9 with App Router
- Tailwind CSS v4
- Clerk authentication (@clerk/nextjs)
- Radix UI components

### Native App (apps/native)
- React Native 0.82.1
- Expo 54.0.25
- React Navigation
- Clerk authentication (@clerk/clerk-expo)

### Backend (packages/backend)
- Convex 1.29.3 (hosted backend with reactive database)
- OpenAI 6.9.1 (for AI note summarization)

## Monorepo Structure
```
pmgt-flow-suite/
├── apps/
│   ├── web/              # Next.js web application
│   └── native/           # React Native (Expo) mobile app
├── packages/
│   └── backend/          # Convex backend (database + functions)
├── turbo.json            # Turborepo configuration
└── package.json          # Root workspace config
```

## Data Flow
1. Both frontends import `@packages/backend` for type-safe API access
2. Convex client hooks (`useQuery`, `useMutation`) provide real-time data
3. Authentication flows through Clerk with JWT tokens validated by Convex
4. AI summarization runs as scheduled Convex actions using OpenAI

## Database Schema
Located in `packages/backend/convex/schema.ts`:
- `notes` table: userId (string), title (string), content (string), summary (optional string)
