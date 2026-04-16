# Project Overview

## Purpose
pmgt-flow-suite is a fullstack POS (Point of Sale) system for restaurant operations. It features order management, product catalog with modifiers, table management, takeout workflows, discount/void processing, receipt printing (Bluetooth ESC/POS), audit logging, and sales reporting.

## Tech Stack
- **Monorepo Management**: Turborepo
- **Package Manager**: pnpm (workspaces)
- **Language**: TypeScript (100%)

### Web App (apps/web)
- Next.js 16 with App Router
- Tailwind CSS v4
- Radix UI components
- React Hook Form + Zod (legacy pages), TanStack Form (migrated admin pages)
- Zustand for client-side state

### Native App (apps/native)
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
│   └── native/           # React Native POS app (Expo)
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
