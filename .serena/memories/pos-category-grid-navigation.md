# POS Category Grid Navigation

## Overview

The POS product selection UI uses a **drill-down category grid** instead of horizontal category pills. This was implemented to handle 80+ products efficiently.

## Navigation Flow

```
Level 0: Category Grid (landing, always shown first)
  → Tap category
Level 1: Subcategory tiles + direct products (same grid, subcategories first)
  → Tap subcategory
Level 2: Products only (filtered to that subcategory)
```

Max depth: 2 levels. Back button returns one level up. Search bar on every level searches globally across all products.

## Key Files

- `apps/native/src/features/orders/components/CategoryGrid.tsx` — Main drill-down component. Manages nav state (level 0/1/2), renders mixed grid of CategoryTiles and ProductCards. Uses `api.categories.getTree` for hierarchy.
- `apps/native/src/features/orders/components/CategoryTile.tsx` — Blue-tinted tile with folder icon for categories/subcategories. Visually distinct from ProductCard (white bg, price badge).
- `apps/native/src/features/orders/screens/OrderScreen.tsx` — Dine-in orders, uses `<CategoryGrid>`
- `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx` — Takeout orders, also uses `<CategoryGrid>`

## Backend

- `packages/backend/convex/categories.ts` — `getTree` query returns root categories with children and product counts. Schema supports `parentId` on categories (1 level of nesting).
- No schema changes were needed — `parentId` and `by_parent`/`by_store_parent` indexes already existed.

## Design Decisions

- CategoryTile: `bg-blue-50`, `border-blue-200`, folder icon — signals "drills deeper"
- ProductCard: `bg-white`, `border-gray-200`, price badge — signals "adds to cart"
- Navigation state is local to `CategoryGrid` component
- Search overrides navigation (shows flat results), clearing returns to current nav position
- The old `CategoryFilter.tsx` (horizontal pills + "More" modal) was deleted
