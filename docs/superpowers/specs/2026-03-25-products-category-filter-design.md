# Products Admin: Category & Status Filtering

**Date:** 2026-03-25
**Scope:** `apps/web/src/app/(admin)/products/page.tsx`

## Problem

The products admin page only supports text search by name. With a growing catalog, staff cannot quickly narrow products by category or status, making product management inefficient.

## Solution

Add an inline filter row to the existing search card with two new controls: a category dropdown and a status dropdown. The status dropdown defaults to "Active", effectively hiding inactive products unless the user explicitly chooses to see them. All filtering is client-side — no backend changes required.

**Why client-side filtering:** The backend `products.list` query supports `categoryId` and `includeInactive` args, but the page already loads all products for the table. Client-side filtering avoids additional query subscriptions and keeps reactivity instant. If catalog sizes grow large enough to warrant server-side filtering, that can be a future optimization.

## Design

### New State

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `categoryFilter` | `Id<"categories"> \| "all"` | `"all"` | Selected category |
| `statusFilter` | `"all" \| "active" \| "inactive"` | `"active"` | Status filter (defaults to active-only) |

No separate "show inactive" toggle — the status dropdown handles this:
- **"Active"** (default) — shows only active products
- **"Inactive"** — shows only inactive products
- **"All"** — shows both active and inactive products

### Filter Bar Layout

Replace the current search-only `Card` content with a horizontal row:

```
[ Search input (flex-1) ] [ All Categories ▾ ] [ Active ▾ ]
```

- All controls in a single `flex items-center gap-3` container
- Search input retains its search icon and takes remaining space via `flex-1`
- Category `Select`: "All Categories" + categories from existing `categories` query, with `└` prefix for subcategories (matching the form dialog pattern at lines 323-329). Sort order matches the backend response (same as the form dialog).
- Status `Select`: "Active" / "Inactive" / "All"

### Filter Logic

Applied as a chain on the client-side `products` array:

```
products
  → filter by statusFilter (match isActive; skip if "all")
  → filter by categoryFilter (match categoryId; skip if "all")
  → filter by searchQuery (name includes search text, case-insensitive)
```

No contradictory states are possible — each control is independent.

### Count Display

Update `CardDescription` to show filtered vs total:
- **Filters active:** `"12 of 45 product(s)"` — where 45 is the total product count (all statuses)
- **No filters active** (category = "All", status = "All", search empty): `"45 product(s)"`
- **Only default status filter active** (status = "Active", nothing else): `"40 active product(s)"` — makes it clear the default hides some products

### Empty State

When filters produce zero results but products exist in the store, show:
```
"No products match your filters."
```
This is distinct from the existing "No products found. Create your first product." message for a truly empty catalog.

### Search Placeholder

Fix the existing placeholder from `"Search products by name or SKU..."` to `"Search products by name..."` since there is no SKU field.

## What Does NOT Change

- No backend/Convex changes
- No changes to the create/edit product dialog
- No changes to table columns or row rendering
- The existing `categories` query is reused (already loaded for the form)
- No new queries or mutations
- No URL persistence for filter state (filters reset on page refresh — acceptable for this admin panel)

## Components Used

All from existing imports — no new dependencies:
- `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` (already imported)
- `Input` with search icon (already present)
