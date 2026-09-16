# Project Overview

## Purpose
pmgt-flow-suite is a fullstack POS (Point of Sale) system for restaurant operations. It features order management, product catalog with modifiers, table management, takeout workflows, discount/void processing, receipt printing (Bluetooth ESC/POS), audit logging, and sales reporting.

## Tech Stack
- **Monorepo Management**: Turborepo
- **Package Manager**: pnpm (workspaces)
- **Languages**: TypeScript (web, backend, legacy native) + Kotlin (apps/android)

### Web App (apps/web)
- Next.js 16 with App Router
- Tailwind CSS v4
- Radix UI components
- React Hook Form + Zod (legacy pages), TanStack Form (migrated admin pages)
- Zustand for client-side state

### Android App (apps/android) — ACTIVE
- Native Kotlin + Jetpack Compose (1:1 port of apps/native)
- SQLDelight over the legacy WatermelonDB file (exact DDL in `LegacyDdl.kt`)
- OkHttp transport to Convex; Classic Bluetooth RFCOMM/SPP ESC/POS printing
- Built with Gradle, outside the pnpm/Turborepo graph
- Ships as its own application `com.pmgt.pos`, alongside the RN app
- See memory: kotlin-pos-migration

### Native App (apps/native) — PORTING REFERENCE, being transitioned away from
- React Native 0.81 + Expo 54
- Tamagui (UI/styling) with `@tamagui/config/v5` + `v5-reanimated`
- React Navigation (bottom tabs + stack)
- Zustand for local state
- Bluetooth ESC/POS receipt printing

### Backend (packages/backend)
- Convex (hosted backend with reactive database)
- `@convex-dev/auth` for authentication
- Vitest + convex-test for testing

## Monorepo Structure
```
pmgt-flow-suite/
├── apps/
│   ├── web/              # Next.js admin panel
│   ├── android/          # Native Kotlin/Compose POS (ACTIVE; Gradle, not pnpm)
│   └── native/           # React Native POS app (Expo) — porting reference
├── packages/
│   ├── backend/          # Convex backend (schema, queries, mutations, actions, tests)
│   └── shared/           # Shared utilities
├── turbo.json
└── package.json
```

## Data Flow
1. Both frontends import `@packages/backend` for type-safe API access
2. Convex client hooks (`useQuery`, `useMutation`) provide real-time data
3. Authentication via `@convex-dev/auth` with Convex Auth tables
4. Money values are peso amounts with decimal precision (not integer centavos)
5. Philippine VAT (12%) with vatable/non-vat/VAT-exempt classification

## Key Domain Tables
`stores`, `products`, `categories`, `modifierGroups`, `modifierOptions`, `modifierGroupAssignments`, `orders`, `orderItems`, `orderItemModifiers`, `orderDiscounts`, `orderPayments`, `orderVoids`, `tables`, `roles`, `auditLogs`, `dailyReports`, `settings`
