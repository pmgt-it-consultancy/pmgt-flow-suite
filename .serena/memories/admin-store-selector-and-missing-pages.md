# Admin Store Selector & Missing Pages Implementation

## Date: 2025-01-11

## Overview

Added a global store selector to the admin panel header and built 3 missing pages (Tables, Orders, Audit Logs). Used Zustand for global state management.

## Architecture

### Global State Management

- **Zustand Store**: `apps/web/src/stores/useAdminStore.ts`
  - Stores `selectedStoreId: Id<"stores"> | null`
  - Persists to localStorage under key "admin-store"
  - Single source of truth for selected store across all admin pages

- **Store Access Hook**: `apps/web/src/hooks/useStoreAccess.ts`
  - Returns `{ accessibleStores, canChangeStore, defaultStoreId, isLoading }`
  - Role-based access:
    - Super Admin (system scope): All stores, can change
    - Admin (parent scope): Parent + branch stores, can change
    - Manager/Staff (branch scope): Single store, cannot change (selector disabled)

### Header Store Selector

- Location: `apps/web/src/components/admin/Header.tsx`
- Dropdown in header, left of user info
- Shows current store name or "Select Store"
- Disabled for Managers (shows their store, non-clickable)
- Auto-selects default store on mount if none selected

### New Pages

1. **Tables Page** (`/tables`)
   - CRUD for restaurant tables
   - Fields: name, capacity, sort order, status, isActive
   - Uses Switch component for active toggle

2. **Orders Page** (`/orders`)
   - Order history with search and status filter
   - Order detail modal with items and totals
   - Shows order type badges (dine-in/takeout)

3. **Audit Logs Page** (`/audit-logs`)
   - Activity log viewer
   - Filters: action type, search
   - Shows: timestamp, user, action, reference, details

### Refactored Pages

All existing admin pages were refactored to use global `useAdminStore` instead of local `selectedStoreId` state:
- `/categories`
- `/products`
- `/users`
- `/reports`
- `/dashboard`

Inline store selectors were removed from all pages since the selector is now in the header.

## Key Files

```
apps/web/src/
├── stores/
│   └── useAdminStore.ts        # Zustand store
├── hooks/
│   └── useStoreAccess.ts       # Role-based access hook
├── components/
│   ├── admin/
│   │   ├── Header.tsx          # Store selector dropdown
│   │   └── Sidebar.tsx         # Removed Settings link
│   └── ui/
│       └── switch.tsx          # New Switch component
└── app/(admin)/
    ├── tables/page.tsx         # NEW
    ├── orders/page.tsx         # NEW
    ├── audit-logs/page.tsx     # NEW
    ├── categories/page.tsx     # REFACTORED
    ├── products/page.tsx       # REFACTORED
    ├── users/page.tsx          # REFACTORED
    ├── reports/page.tsx        # REFACTORED
    └── dashboard/page.tsx      # REFACTORED
```

## Dependencies Added

- `zustand` - State management
- `@radix-ui/react-switch` - Switch UI component

## Design Document

Full design document at: `docs/plans/2025-01-11-admin-store-selector-and-missing-pages.md`

## Related Commits

- `e2657f2` - feat(web): add global store selector and missing admin pages
- `5bb342d` - docs: add design for admin store selector and missing pages
