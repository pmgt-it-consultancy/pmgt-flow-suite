# Products Admin: Category, Status & Inactive Filtering

**Date:** 2026-03-25
**Scope:** `apps/web/src/app/(admin)/products/page.tsx`

## Problem

The products admin page only supports text search by name. With a growing catalog, staff cannot quickly narrow products by category or status, making product management inefficient.

## Solution

Add an inline filter row to the existing search card with three new controls: a category dropdown, a status dropdown, and a "Show inactive" checkbox. All filtering is client-side — no backend changes required.

## Design

### New State

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `categoryFilter` | `Id<"categories"> \| "all"` | `"all"` | Selected category |
| `statusFilter` | `"all" \| "active" \| "inactive"` | `"all"` | Status filter |
| `showInactive` | `boolean` | `false` | Whether to include inactive products |

### Filter Bar Layout

Replace the current search-only `Card` content with a horizontal row:

```
[ Search input (flex-1) ] [ Category ▾ ] [ Status ▾ ] [ ] Show inactive
```

- All controls in a single `flex items-center gap-3` container
- Search input retains its search icon and takes remaining space via `flex-1`
- Category `Select`: "All Categories" + categories from existing `categories` query, with `└` prefix for subcategories (matching the form dialog pattern)
- Status `Select`: "All" / "Active" / "Inactive"
- `Checkbox` + `Label` for "Show inactive"

### Filter Logic

Applied as a chain on the client-side `products` array:

```
products
  → filter by showInactive (hide inactive unless checked)
  → filter by categoryFilter (match categoryId if not "all")
  → filter by statusFilter (match isActive if not "all")
  → filter by searchQuery (name includes search text, case-insensitive)
```

**Interaction between `showInactive` and `statusFilter`:**
- When `showInactive` is **unchecked** (default): inactive products are always hidden, regardless of the status dropdown. The status dropdown only shows "All" and effectively has no effect since only active products are visible.
- When `showInactive` is **checked**: all products are shown and the status dropdown can be used to filter to "Active" only or "Inactive" only.

### Count Display

Update `CardDescription` from:
```
"12 product(s) found"
```
to:
```
"12 of 45 product(s)"
```
showing filtered count vs total count. When no filters are active, show just `"45 product(s)"`.

### Empty State

When filters produce zero results but products exist, show:
```
"No products match your filters."
```
distinct from the existing "No products found. Create your first product." message for an empty catalog.

## What Does NOT Change

- No backend/Convex changes
- No changes to the create/edit product dialog
- No changes to table columns or row rendering
- The existing `categories` query is reused (already loaded for the form)
- No new queries or mutations

## Components Used

All from existing imports — no new dependencies:
- `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` (already imported)
- `Input` with search icon (already present)
- Native `<input type="checkbox">` + `Label` (checkbox pattern already used in the form for `isOpenPrice`)
