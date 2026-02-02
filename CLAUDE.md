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
- **apps/native** — React Native 0.81 + Expo 54, Tamagui (UI/styling), React Navigation (bottom tabs + stack), Zustand for local state, Bluetooth ESC/POS receipt printing
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

### Native App Styling (Tamagui)

The native app uses **Tamagui v2 RC** with **v5 config** (`@tamagui/config/v5`). Config is in `apps/native/tamagui.config.ts`. Brand color: `#0D87E1`.

**Config setup:** Uses `defaultConfig` from `@tamagui/config/v5` as base, with `@tamagui/config/v5-reanimated` for animations. Key overrides: `onlyAllowShorthands: false` (allows full prop names like `backgroundColor` instead of only `bg`), `allowedStyleValues: false` (allows any values, not just tokens), `defaultPosition: "relative"` (RN-friendly). Custom color tokens added for brand/gray/badge colors.

**Critical Tamagui gotchas:**
- **NEVER import `createTamagui` from `@tamagui/core`** — always import from `"tamagui"`. Mixing `tamagui` and `@tamagui/core` imports can create duplicate module instances where the config set by one isn't visible to the other, causing "Can't find Tamagui configuration" runtime errors.
- **Don't re-export non-UI components from `ui/index.ts`** barrel file — importing shared components that themselves import from `ui/` creates require cycles that can cause uninitialized values at runtime.
- **Metro config** (`metro.config.js`) pins `@tamagui/core` via `extraNodeModules` to prevent duplicate resolution, and adds `mjs` to source extensions.
- **Babel plugin** is optional (build-time optimizer). If it causes issues, it can be removed — Tamagui works at runtime without it.

**Layout:** Use `XStack` (flex-row) and `YStack` (flex-column) from `tamagui` for layout containers. Use React Native primitives (`TouchableOpacity`, `TextInput`, `FlatList`, `ScrollView`, `Modal`, etc.) directly from `react-native`.

**UI primitives** in `src/features/shared/components/ui/`:
- `Text` — `styled(SizableText)` with `variant` (default/heading/subheading/muted/error/success) and `size` (xs/sm/base/lg/xl/2xl/3xl). Note: size uses `"base"` not `"md"`.
- `Button` — RN `TouchableOpacity` with `variant` (primary/secondary/outline/ghost/destructive/success) and `size` (sm/md/lg)
- `Badge` — `XStack` with `variant` and `size` props
- `Card` — `YStack` with `variant` (default/outlined/elevated)
- `Input`, `Chip`, `IconButton`, `Modal`, `Separator`

**Styling rules:**
- Apply styles as Tamagui props (`backgroundColor`, `padding`, `borderRadius`, etc.) on `XStack`/`YStack`, not via `className`
- For custom UI components, use explicit prop interfaces (don't extend RN `ViewProps` and spread onto Tamagui components — causes type conflicts)
- Colors use hex values directly (e.g., `"#F3F4F6"`) or Tamagui tokens (e.g., `"$gray100"`)

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

## UI Design Principles (POS)

This is a POS system used by restaurant staff. Every UI decision must prioritize efficiency:
- **Use all available space** — flex-fill layouts, no dead whitespace. Buttons and interactive elements should expand to fill their containers.
- **Large touch targets** — staff tap quickly and repeatedly. Buttons must be large enough to hit without precision.
- **Glanceable data** — clocks, stats, order counts must be readable at arm's length. Use large, bold font sizes for key numbers.
- **Information density over aesthetics** — pack useful info into every screen. Combine sections side-by-side (e.g. clock + stats in one row, buttons + order list side-by-side) rather than stacking vertically with margins.

## Deployment

Web deploys to Vercel with custom build command that deploys Convex first:
```bash
cd ../../packages/backend && npx convex deploy --cmd 'cd ../../apps/web && turbo run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```
