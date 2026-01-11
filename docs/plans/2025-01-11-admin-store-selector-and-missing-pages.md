# Admin Store Selector & Missing Pages Design

**Date:** 2025-01-11
**Status:** Approved

## Overview

Add a global store selector to the admin panel header and build the 3 missing pages (Tables, Orders, Audit Logs). Use Zustand for global state management.

## Problem

1. Each admin page has its own local `selectedStoreId` state
2. Super Admins must re-select store on every page navigation
3. 4 sidebar links lead to non-existent pages (Tables, Orders, Audit Logs, Settings)
4. Inconsistent UX across the admin panel

## Solution

### 1. Zustand Store for Global State

**File:** `apps/web/src/stores/useAdminStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Id } from '@packages/backend/convex/_generated/dataModel';

interface AdminState {
  selectedStoreId: Id<"stores"> | null;
  setSelectedStoreId: (storeId: Id<"stores"> | null) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      selectedStoreId: null,
      setSelectedStoreId: (storeId) => set({ selectedStoreId: storeId }),
    }),
    { name: 'admin-store' }
  )
);
```

- Persists to localStorage
- Single source of truth for selected store

### 2. Role-Based Store Access Hook

**File:** `apps/web/src/hooks/useStoreAccess.ts`

Returns `{ accessibleStores, canChangeStore, defaultStoreId }`

| Role | Store Access | Can Change | Default |
|------|--------------|------------|---------|
| Super Admin | All stores | Yes | First store or null |
| Admin | Parent + branches | Yes | Assigned store |
| Manager | Single store | No | Assigned store (locked) |

### 3. Header Store Selector

**Update:** `apps/web/src/components/admin/Header.tsx`

- Dropdown in header, left of user info
- Shows current store name or "Select Store"
- Filtered by role using `useStoreAccess`
- Disabled for Managers (shows their store, non-clickable)
- Auto-selects default store on mount if none selected

### 4. New Pages

#### Tables Page (`/tables`)

CRUD for restaurant tables:
- List tables for selected store
- Create/edit table (name, capacity, sort order)
- Toggle active/inactive
- Show status (available, occupied, reserved)

#### Orders Page (`/orders`)

Order history viewer:
- List orders with pagination
- Filter by status, date range, order type
- Search by order number
- View order details in modal

#### Audit Logs Page (`/audit-logs`)

Activity log viewer:
- List audit entries with pagination
- Filter by action type, user, date range
- Action types: void_item, void_order, discount_applied, order_completed
- Expandable rows for full details

### 5. Refactor Existing Pages

Remove local `selectedStoreId` state from:
- `/categories`
- `/products`
- `/users`
- `/reports`
- `/dashboard`

All pages use global Zustand store instead.

### 6. Sidebar Cleanup

- Remove Settings link (not implemented)
- Keep Tables, Orders, Audit Logs links

## Files Changed

```
apps/web/
├── package.json                    # Add zustand
├── src/
│   ├── stores/
│   │   └── useAdminStore.ts       # NEW
│   ├── hooks/
│   │   └── useStoreAccess.ts      # NEW
│   ├── components/admin/
│   │   ├── Header.tsx             # MODIFY
│   │   └── Sidebar.tsx            # MODIFY
│   └── app/(admin)/
│       ├── tables/page.tsx        # NEW
│       ├── orders/page.tsx        # NEW
│       ├── audit-logs/page.tsx    # NEW
│       ├── categories/page.tsx    # REFACTOR
│       ├── products/page.tsx      # REFACTOR
│       ├── users/page.tsx         # REFACTOR
│       ├── reports/page.tsx       # REFACTOR
│       └── dashboard/page.tsx     # REFACTOR
```

## Out of Scope

- Settings page (deferred)
- "All Stores" aggregate view for Super Admins
- Drag-to-reorder tables (use manual sort order)

## Dependencies

- `zustand` - State management library
