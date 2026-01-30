# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A fullstack monorepo note-taking app with AI summarization, featuring web (Next.js 16) and mobile (React Native/Expo) frontends sharing a Convex backend.

## Commands

```bash
# Install dependencies (requires yarn)
yarn

# Run all apps in development (web, native, backend)
npm run dev

# Initial Convex setup (run once)
npm run setup --workspace packages/backend

# Type checking across all packages
npm run typecheck

# Format code
npm run format

# Build all packages
npm run build

# Per-app commands (from their directories)
cd apps/web && npm run lint      # ESLint for web
cd apps/native && npm run ios    # iOS simulator
cd apps/native && npm run android # Android simulator
```

## Architecture

### Monorepo Structure
- **apps/web** - Next.js 16 with App Router, Tailwind CSS v4, Clerk auth
- **apps/native** - React Native with Expo, React Navigation
- **packages/backend** - Convex backend (database + server functions)

### Data Flow
Both frontends import `@packages/backend` and use Convex client hooks (`useQuery`, `useMutation`) for real-time data. Authentication flows through Clerk, with JWT tokens validated by Convex.

### Backend (Convex)
- Schema defined in `packages/backend/convex/schema.ts`
- Public functions in `notes.ts` (queries, mutations)
- Internal functions in `openai.ts` (AI summarization via scheduled actions)
- Functions use file-based routing: `api.notes.getNotes` references `convex/notes.ts:getNotes`

### Key Patterns
- **Auth**: `getUserId(ctx)` extracts user from Clerk JWT via `ctx.auth.getUserIdentity()`
- **Async AI**: `createNote` schedules `internal.openai.summary` to run after insert
- **Real-time**: All queries auto-subscribe to updates via Convex reactivity

## Convex Development Guidelines

These rules are critical when writing Convex functions:

### Function Syntax
Always use the object-based syntax with validators:
```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myQuery = query({
  args: { id: v.id("notes") },
  returns: v.null(),  // Required - use v.null() if no return
  handler: async (ctx, args) => { ... }
});
```

### Function Types
- `query`/`mutation`/`action` - Public API (exposed to clients)
- `internalQuery`/`internalMutation`/`internalAction` - Private (only callable from other functions)

### Database Queries
- Use `withIndex()` instead of `filter()` for performance
- Define indexes in schema with names like `by_field1_and_field2`
- Query order must match index field order

### Actions
- Add `"use node";` at top of files using Node.js modules
- Actions cannot use `ctx.db` - call queries/mutations via `ctx.runQuery`/`ctx.runMutation`

### Type Safety
- Use `Id<'tableName'>` from `./_generated/dataModel` for document IDs
- Use `Doc<'tableName'>` for full document types

## Environment Variables

Required in Convex dashboard:
- `CLERK_ISSUER_URL` - From Clerk JWT template
- `OPENAI_API_KEY` - Optional, for AI summaries

Required in `apps/web/.env.local` and `apps/native/.env.local`:
- `NEXT_PUBLIC_CONVEX_URL` / `EXPO_PUBLIC_CONVEX_URL`
- Clerk publishable and secret keys

## Workflow

After completing a planning or implementation task, always save a summary to Serena memory using `write_memory` (activate the `pmgt-flow-suite` project first if needed). Include: what was done, files changed, key patterns used, and the commit hash.

## Deployment

Web deploys to Vercel with custom build command that deploys Convex first:
```bash
cd ../../packages/backend && npx convex deploy --cmd 'cd ../../apps/web && turbo run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```
