# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A fullstack POS (Point of Sale) system for restaurant operations, built as a monorepo with web (Next.js 16) and mobile (React Native/Expo) frontends sharing a Convex backend. Features order management, product catalog with modifiers, table management, takeout workflows, discount/void processing, receipt printing, audit logging, and sales reporting.

## Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Run all apps in development (web, native, backend)
pnpm dev

# Type checking across all packages
pnpm typecheck

# Lint and format (uses Biome, not ESLint/Prettier)
pnpm lint
pnpm format
pnpm check              # lint + format combined

# Build all packages
pnpm build

# Run backend tests (Vitest + convex-test)
cd packages/backend && pnpm vitest
cd packages/backend && pnpm vitest run    # single run, no watch

# Per-app commands
cd apps/web && pnpm lint
cd apps/native && pnpm ios
cd apps/native && pnpm android
```

## Architecture

### Monorepo Structure
- **apps/web** — Next.js 16 App Router, Tailwind CSS v4, Radix UI components, React Hook Form + Zod
- **apps/native** — React Native 0.81 + Expo 54, React Navigation (bottom tabs + stack), Zustand for local state, Bluetooth ESC/POS receipt printing
- **packages/backend** — Convex backend (schema, queries, mutations, actions, tests)
- **packages/shared** — Shared utilities

Managed with **Turborepo** (`turbo.json`) and **pnpm** workspaces.

### Data Flow
Both frontends import from `@packages/backend` and use Convex client hooks (`useQuery`, `useMutation`) for real-time data. Authentication uses `@convex-dev/auth` with Convex Auth tables.

### Backend (Convex)

Schema in `packages/backend/convex/schema.ts`. Key domain tables: `stores`, `products`, `categories`, `modifierGroups`, `modifierOptions`, `modifierGroupAssignments`, `orders`, `orderItems`, `orderItemModifiers`, `orderDiscounts`, `orderVoids`, `tables`, `roles`, `auditLogs`, `dailyReports`, `settings`.

Function files organized by domain:
- **orders.ts** — Order lifecycle (create, add/remove items, void)
- **checkout.ts** — Payment settlement with tax calculation
- **products.ts** / **categories.ts** — Product catalog CRUD
- **modifierGroups.ts** / **modifierOptions.ts** / **modifierAssignments.ts** — Modifier system
- **tables.ts** — Dine-in table management
- **discounts.ts** — Senior/PWD/promo/manual discounts
- **voids.ts** — Order and item void processing
- **reports.ts** — Sales and daily reports
- **auditLogs.ts** — Audit trail
- **users.ts** / **roles.ts** — User management and RBAC
- **stores.ts** — Multi-store support
- **lib/auth.ts** — Auth helpers
- **lib/permissions.ts** — Permission checking
- **lib/taxCalculations.ts** — Philippine VAT calculations

### Web App (apps/web/src)
- `app/(admin)/` — Admin panel routes: dashboard, orders, products, categories, modifiers, tables, reports, audit-logs, users, stores
- `components/` — Reusable UI components
- `hooks/` — Custom React hooks
- `stores/` — Zustand stores

### Native App (apps/native/src)
Feature-based organization under `src/features/`:
- `home/` — Active orders list
- `tables/` — Table management with quick actions
- `orders/` — Order entry with line items and modifiers
- `checkout/` — Payment processing
- `takeout/` — Takeout order workflow
- `order-history/` — Past orders
- `settings/` — Printer settings (Bluetooth ESC/POS)
- `shared/` — Shared components, hooks, UI primitives

### Key Patterns
- **Auth**: `@convex-dev/auth` with auth tables spread into schema; `getUserId(ctx)` extracts user identity
- **Store scoping**: Most queries/mutations take `storeId` and use `by_store` indexes
- **Tax model**: Philippine VAT (12%) with vatable/non-vat/VAT-exempt classification; calculations in `lib/taxCalculations.ts`
- **Modifier system**: Groups assigned to products or categories via join table (`modifierGroupAssignments`), with optional min/max override
- **Order snapshots**: Product names and prices are snapshotted into order items at creation time
- **Audit logging**: Operations tracked in `auditLogs` table with store, action, entity references

## Convex Development Guidelines

### Function Syntax
Always use object-based syntax with validators. Every function must have `returns` validator:
```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myQuery = query({
  args: { id: v.id("orders") },
  returns: v.null(),
  handler: async (ctx, args) => { ... }
});
```

### Critical Rules
- Use `withIndex()` instead of `filter()` for all database queries
- Index names follow `by_field1_and_field2` convention; query order must match index field order
- `internalQuery`/`internalMutation`/`internalAction` for private functions; `query`/`mutation`/`action` for public API
- Actions cannot use `ctx.db` — call queries/mutations via `ctx.runQuery`/`ctx.runMutation`
- Add `"use node";` at top of files using Node.js modules
- Use `Id<'tableName'>` and `Doc<'tableName'>` from `./_generated/dataModel` for type safety
- Function references: `api.orders.getOrder` (public), `internal.orders.getOrder` (private)

## Environment Variables

Required in Convex dashboard:
- `OPENAI_API_KEY` — Optional, for AI summaries

Required in `apps/web/.env.local`:
- `NEXT_PUBLIC_CONVEX_URL`

Required in `apps/native/.env.local`:
- `EXPO_PUBLIC_CONVEX_URL`

## Deployment

Web deploys to Vercel with custom build command that deploys Convex first:
```bash
cd ../../packages/backend && npx convex deploy --cmd 'cd ../../apps/web && turbo run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```
