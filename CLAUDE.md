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
cd apps/native && pnpm start
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

Money handling follows the current app behavior, not the older centavo-only assumption:
- Product prices, modifier adjustments, discounts, and tendered cash are treated as peso amounts with decimals.
- Store VAT is often entered in admin forms as a whole percent such as `12`; `packages/backend/convex/lib/taxCalculations.ts` normalizes that to `0.12` before computing VAT and SC/PWD discounts.
- Tax and discount calculations round to centavo precision.

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

#### Admin Table Filter Pattern

For admin pages with filterable tables, use an inline filter bar inside a `Card` above the data table:

```tsx
<Card>
  <CardContent className="pt-6">
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input placeholder="Search..." value={searchQuery} onChange={...} className="pl-10" />
      </div>
      <Select value={filter1} onValueChange={setFilter1}>
        <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
        <SelectContent>...</SelectContent>
      </Select>
      {/* Additional filters as needed */}
    </div>
  </CardContent>
</Card>
```

- Search input takes `flex-1`, filter dropdowns have fixed widths (`w-[140px]` to `w-[200px]`)
- Filtering is client-side on the already-loaded Convex query data
- Status filters default to "Active" to hide inactive items by default
- `CardDescription` shows contextual counts (e.g., "12 of 45 product(s)")

#### Colocated Page Architecture

For complex pages, use colocated folders with underscore prefix (ignored by Next.js routing):

```
app/(admin)/stores/
├── page.tsx              # Main page component (kept minimal)
├── _components/          # Page-specific components
│   ├── index.ts
│   ├── StoreFormDialog.tsx
│   └── StoresTable.tsx
├── _hooks/               # Page-specific hooks
│   ├── index.ts
│   └── useStoreMutations.ts
└── _stores/              # Page-specific Zustand stores
    └── useStoreFormStore.ts
```

**Rules:**
- Keep `page.tsx` minimal — it should compose components, not contain business logic
- Use Zustand for client-side state management (form state, UI state, selections)
- Extract mutations/queries into custom hooks when they have complex logic
- Use barrel exports (`index.ts`) in each folder
- Prefix folders with `_` so Next.js ignores them as routes

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

The native app uses Tamagui with `@tamagui/config/v5` plus `@tamagui/config/v5-reanimated`. Config lives in `apps/native/tamagui.config.ts`.

Current config notes:
- `createTamagui` must be imported from `"tamagui"`, not `@tamagui/core`
- `defaultConfig` is used as the base config
- animations come from `@tamagui/config/v5-reanimated`
- `onlyAllowShorthands: false`
- `allowedStyleValues: false`
- `defaultPosition: "relative"`

**Critical Tamagui gotchas:**
- **NEVER import `createTamagui` from `@tamagui/core`** — always import from `"tamagui"`. Mixing `tamagui` and `@tamagui/core` imports can create duplicate module instances where the config set by one isn't visible to the other, causing "Can't find Tamagui configuration" runtime errors.
- **Don't re-export non-UI components from `ui/index.ts`** barrel file — importing shared components that themselves import from `ui/` creates require cycles that can cause uninitialized values at runtime.
- **Metro config** (`metro.config.js`) pins `@tamagui/core` via `extraNodeModules` to prevent duplicate resolution, and adds `mjs` to source extensions.

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
- **Auth**: `@convex-dev/auth` with auth tables spread into schema; most functions use `requireAuth`, `getAuthenticatedUser`, or `getAuthenticatedUserWithRole` from `packages/backend/convex/lib/auth.ts`
- **Store scoping**: Most queries/mutations take `storeId` and use `by_store` indexes
- **Tax model**: Philippine VAT (12%) with vatable/non-vat/VAT-exempt classification; calculations in `lib/taxCalculations.ts`
  - VAT rates may be stored as either `12` or `0.12`; normalize before using them in formulas
  - Money values are currently treated as peso amounts with decimal precision, not integer centavos
  - SC/PWD discounts should preserve centavo precision
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
- Be careful with money math: round at centavo precision, not whole-number precision

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

### Touch Target Sizing

| Element | Minimum | Recommended |
|---------|---------|-------------|
| Any tappable element | 44px | 48-56px |
| Quantity +/- buttons | 44px | 56x56px |
| Quick action buttons | 44px | 48-52px height |
| Primary action buttons | 48px | 56px height |
| Checkbox/radio rows | 48px | 56px height |
| Modal action buttons | 48px | Full-width, 18px padding |

### Quantity Controls Pattern

Use colored background tints for increment/decrement buttons:
```tsx
// Decrement button (red tint)
<TouchableOpacity style={{
  width: 56, height: 56, borderRadius: 12,
  backgroundColor: "#FEE2E2",  // red-100
  justifyContent: "center", alignItems: "center",
}}>
  <Ionicons name="remove" size={28} color="#EF4444" />
</TouchableOpacity>

// Increment button (green tint)
<TouchableOpacity style={{
  width: 56, height: 56, borderRadius: 12,
  backgroundColor: "#DCFCE7",  // green-100
  justifyContent: "center", alignItems: "center",
}}>
  <Ionicons name="add" size={28} color="#22C55E" />
</TouchableOpacity>

// Quantity display
<YStack backgroundColor="#F3F4F6" borderRadius={12} paddingVertical={12} paddingHorizontal={24}>
  <Text style={{ fontSize: 28, fontWeight: "700" }}>{quantity}</Text>
</YStack>
```

### Modal Layout Pattern (Sticky Footer)

For modals with scrollable content and fixed actions, use this structure:
```tsx
<RNModal visible={visible} transparent animationType="slide">
  <View style={{ flex: 1, justifyContent: "flex-end" }}>
    <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />  {/* Backdrop */}
    <KeyboardAvoidingView behavior="padding" style={{ maxHeight: "92%", backgroundColor: "#FFF", borderTopRadius: 16 }}>
      <View style={{ maxHeight: "100%" }}>
        {/* Fixed Header */}
        <XStack paddingHorizontal={20} paddingTop={20} paddingBottom={16} borderBottomWidth={1}>
          ...
        </XStack>

        {/* Scrollable Content - NO flex:1 on ScrollView style */}
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          ...
        </ScrollView>

        {/* Fixed Footer */}
        <YStack paddingHorizontal={20} paddingTop={16} paddingBottom={24} borderTopWidth={1}>
          ...
        </YStack>
      </View>
    </KeyboardAvoidingView>
  </View>
</RNModal>
```

**Critical:** Do NOT use `style={{ flex: 1 }}` on ScrollView inside KeyboardAvoidingView — it causes the ScrollView to collapse.

### Destructive/Cancel Button Pattern

Use outlined style with light red background for cancel/destructive secondary actions:
```tsx
<TouchableOpacity style={{
  backgroundColor: "#FEF2F2",  // red-50
  borderRadius: 10,
  borderWidth: 1,
  borderColor: "#FECACA",  // red-200
  paddingVertical: 14,
  paddingHorizontal: 20,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
}}>
  <Ionicons name="close-circle-outline" size={20} color="#DC2626" style={{ marginRight: 8 }} />
  <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 15 }}>Cancel Order</Text>
</TouchableOpacity>
```

### Color Conventions

| Purpose | Background | Border | Text/Icon |
|---------|------------|--------|-----------|
| Primary action | `#0D87E1` | - | `#FFFFFF` |
| Success/Confirm | `#22C55E` | - | `#FFFFFF` |
| Increment button | `#DCFCE7` | - | `#22C55E` |
| Decrement button | `#FEE2E2` | - | `#EF4444` |
| Cancel/Destructive | `#FEF2F2` | `#FECACA` | `#DC2626` |
| Selected state | `#DBEAFE` | `#0D87E1` | `#0D87E1` |
| Disabled | `#9CA3AF` | - | `#FFFFFF` |
| Neutral/Default | `#F3F4F6` | `#E5E7EB` | `#374151` |

## Deployment

Web deploys to Vercel with custom build command that deploys Convex first:
```bash
cd ../../packages/backend && npx convex deploy --cmd 'cd ../../apps/web && turbo run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

## Git Notes

- Commit messages in this repo follow conventional commit style such as `feat(scope): summary` or `fix(scope): summary`
- `lint-staged` runs `biome check --write --no-errors-on-unmatched` on staged JS/TS/JSON files during commit
