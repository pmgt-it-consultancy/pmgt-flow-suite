# Style and Conventions

## Code Formatting & Linting
- **Biome** for both linting and formatting (NOT ESLint/Prettier)
- Run: `pnpm lint`, `pnpm format`, `pnpm check` (lint + format combined)
- `lint-staged` runs `biome check --write --no-errors-on-unmatched` on staged JS/TS/JSON files during commit

## TypeScript
- Strict mode enabled
- Use `Id<'tableName'>` from Convex for document IDs
- Use `Doc<'tableName'>` for full document types

## Convex Function Conventions

### Always Use Object-Based Syntax with Validators
```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myFunction = query({
  args: { id: v.id("orders") },
  returns: v.null(),  // REQUIRED
  handler: async (ctx, args) => { ... }
});
```

### Function Types
- `query`, `mutation`, `action` — Public API
- `internalQuery`, `internalMutation`, `internalAction` — Private functions

### Database Best Practices
- Use `withIndex()` instead of `filter()` for all queries
- Index names: `by_field1_and_field2` format
- Query field order must match index definition order
- Actions cannot use `ctx.db` — call via `ctx.runQuery`/`ctx.runMutation`
- Add `"use node";` at top of files using Node.js modules

### Authentication Pattern
```typescript
const { user, store } = await getAuthenticatedUser(ctx);
// or: await getAuthenticatedUserWithRole(ctx, args.storeId, "admin");
```
Auth helpers in `packages/backend/convex/lib/auth.ts`.

## Android App (Kotlin/Compose) — apps/android

**It is a 1:1 port of apps/native.** Read the RN source before changing behaviour. Several source
quirks are preserved deliberately (kitchen button gated on the receipt printer; raw
`cardPaymentType` on the receipt header; store socials never printed). See memory:
kotlin-pos-migration.

- Package root `com.pmgt.pos`; packages mirror the RN feature folders.
- Colors are hex `Color(0xFF...)` matching the RN palette; icons are the Ionicons font.
- Every Compose `Dialog` must call `HideSystemBarsInDialog()` — a dialog window does not inherit
  the activity's immersive flags.
- Never key a `Dialog` on a value that can change while it is open; the key change destroys and
  rebuilds the window (visible dismiss/reopen).
- Rethrow `CancellationException` **before** any generic `catch`, or disposal surfaces as a bogus
  user-facing error.
- Landscape is mandatory: `sensorLandscape` plus
  `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` (Android 16 ignores the former alone).
- Never substitute SQLDelight's logical `Schema.create` — use the generated `LegacyDdl.kt`.
- Biome does NOT touch Kotlin; `ktfmt`/Gradle formatting applies. `lint-staged` only covers JS/TS/JSON.

## Native App Styling (Tamagui)
- Layouts: `XStack` (flex-row), `YStack` (flex-column) from `tamagui`
- RN primitives: `TouchableOpacity`, `TextInput`, `FlatList`, `ScrollView`, `Modal` from `react-native`
- UI primitives in `src/features/shared/components/ui/`: `Text`, `Button`, `Badge`, `Card`, `Input`, `Chip`, `IconButton`, `Modal`, `Separator`
- Icons: `@expo/vector-icons` Ionicons
- Apply styles as Tamagui props, not className
- Colors use hex values directly or Tamagui tokens
- **NEVER import `createTamagui` from `@tamagui/core`** — always from `"tamagui"`

## Web App Conventions
- Admin pages use colocated folder architecture: `page.tsx`, `_components/`, `_hooks/`, `_stores/`
- Admin table filter pattern: inline filter bar inside Card above data table
- Zustand for client-side state management

## Git
- Conventional commit style: `feat(scope):`, `fix(scope):`, `chore:`, `refactor:`, `perf:`
- Main integration branch: `main`
