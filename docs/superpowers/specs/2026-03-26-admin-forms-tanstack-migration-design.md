# Admin Portal Forms Migration — TanStack Form + shadcn/ui

**Date:** 2026-03-26
**Status:** Approved

## Problem

Admin portal CRUD forms use manual `useState` with no schema validation, no error messages, and no Enter key support. Validation is limited to disabling the submit button. Forms are monolithic (products page: 667 lines). Creating related entities (products → categories → modifiers) requires page-hopping.

## Decision

Migrate all 7 admin CRUD pages to TanStack Form + Zod validation with shadcn Field components. Colocate all pages. Add efficiency features: Save & Create Another, Duplicate, inline creation from selects, combined modifier group + options form.

## Approach

Direct TanStack Form usage per page (no shared abstraction). Each page owns its form, schema, and mutations. shadcn Field components provide visual consistency and error display.

## Scope

### Pages to Migrate (7)

| Page | Inline Create | Duplicate | Save & Create Another |
|------|---------------|-----------|----------------------|
| Products | Category, Modifier Group | Yes | Yes |
| Categories | Modifier Group | Yes | Yes |
| Stores | — | Yes | Yes |
| Modifiers | — | Yes | Yes |
| Tables | — | Yes | Yes |
| Users | Role | Yes | Yes |
| Roles | — | Yes | Yes |

### Component Changes

**Install:**
- shadcn `field` components (Field, FieldGroup, FieldLabel, FieldError, FieldDescription)
- shadcn `textarea` (if missing)

**Remove:**
- `components/ui/form.tsx` (unused React Hook Form wrapper)

**No new dependencies** — `@tanstack/react-form` and `zod` already in package.json.

## File Structure (per page)

```
app/(admin)/<entity>/
├── page.tsx                  # Minimal — composes components
├── _components/
│   ├── index.ts
│   ├── <Entity>FormDialog.tsx
│   └── <Entity>Table.tsx
├── _hooks/
│   ├── index.ts
│   └── use<Entity>Mutations.ts
└── _schemas/
    ├── index.ts
    └── <entity>Schema.ts
```

## Form Pattern

Each form dialog:
- Wraps fields in a native `<form>` element (Enter key submission)
- Uses `useForm` from `@tanstack/react-form` with Zod validators
- Validation triggers: `onBlur` + `onSubmit`
- Auto-focuses the first field on open
- Uses shadcn Field components for labels, errors, descriptions
- `data-invalid` on Field, `aria-invalid` on controls

### Footer Actions

- **Edit mode:** Cancel, Save
- **Create mode:** Cancel, Save, Save & Create Another

"Save & Create Another" resets the form and keeps the dialog open.

## Inline Creation from Selects

When a Select dropdown needs an entity that doesn't exist yet:
- A "+ Create New ..." option at the bottom of the Select
- Selecting it opens a small stacked dialog with essential fields only
- On save: entity is created, auto-selected in the parent form's field, stacked dialog closes
- Parent form state is preserved throughout

Applies to: Category select (products), Modifier Group select (products, categories), Role select (users).

## Combined Modifier Group + Options Form

Single dialog for creating/editing a modifier group with all its options:
- Group fields: name, required, min/max selections
- Options: dynamic array field (name + price adjustment per row)
- Add/remove option rows inline
- Zod validates at least 1 option
- On save: create group + batch-create options
- On edit: diff and sync added/removed options

## Duplicate Action

Every data table row gets a "Duplicate" option in its action dropdown:
- Opens the Create dialog pre-filled with source item's data
- Name appended with " (Copy)"
- No ID carried over — creates a new entity
- Modifier groups: duplicates group + all options
- Products: duplicates all fields including modifier assignments
- Auto-focuses name field for immediate renaming

## Zustand Removal

Existing Zustand form stores (e.g., `useStoreFormStore`) are removed. TanStack Form manages form state. Dialog open/close and editing ID use local `useState`.

## What Stays the Same

- Table/filter pattern (Card with search + filter dropdowns)
- Convex queries/mutations (same API)
- Toast notifications via Sonner
- Dialog shell (shadcn Dialog)
- Admin table filter pattern from CLAUDE.md
