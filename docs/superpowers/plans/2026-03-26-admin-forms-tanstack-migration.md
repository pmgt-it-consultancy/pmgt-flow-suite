# Admin Forms TanStack Form Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 7 admin CRUD pages to TanStack Form + Zod + shadcn Field components with colocated file structure, adding Save & Create Another, Duplicate, inline creation from selects, and combined modifier group + options form.

**Architecture:** Each page gets a colocated folder with `_components/`, `_hooks/`, `_schemas/` directories. Form state is managed by TanStack Form's `useForm` hook with Zod validators (onBlur + onSubmit). All forms wrap fields in a native `<form>` element for Enter key submission. shadcn Field components handle labels, error display, and accessibility.

**Tech Stack:** @tanstack/react-form 1.27.x, zod, shadcn/ui (field, textarea components), Convex (queries/mutations)

**Spec:** `docs/superpowers/specs/2026-03-26-admin-forms-tanstack-migration-design.md`

---

## File Map

### New shadcn components
- `apps/web/src/components/ui/field.tsx` — Field, FieldGroup, FieldLabel, FieldError, FieldDescription
- `apps/web/src/components/ui/textarea.tsx` — Textarea component

### Removed files
- `apps/web/src/components/ui/form.tsx` — Old React Hook Form wrapper (unused)
- `apps/web/src/app/(admin)/stores/_stores/useStoreFormStore.ts` — Zustand form store (replaced by TanStack Form)

### Per-page structure (7 pages)

Each page follows this pattern. Files marked (new) are created; (rewrite) replaces existing content.

**Tables** (simplest — pattern reference):
- `apps/web/src/app/(admin)/tables/page.tsx` (rewrite)
- `apps/web/src/app/(admin)/tables/_components/index.ts` (new)
- `apps/web/src/app/(admin)/tables/_components/TableFormDialog.tsx` (new)
- `apps/web/src/app/(admin)/tables/_components/TablesDataTable.tsx` (new)
- `apps/web/src/app/(admin)/tables/_components/TabNameDialog.tsx` (new)
- `apps/web/src/app/(admin)/tables/_hooks/index.ts` (new)
- `apps/web/src/app/(admin)/tables/_hooks/useTableMutations.ts` (new)
- `apps/web/src/app/(admin)/tables/_schemas/index.ts` (new)
- `apps/web/src/app/(admin)/tables/_schemas/tableSchema.ts` (new)

**Roles:**
- `apps/web/src/app/(admin)/roles/page.tsx` (rewrite)
- `apps/web/src/app/(admin)/roles/_components/index.ts` (new)
- `apps/web/src/app/(admin)/roles/_components/RoleFormDialog.tsx` (new)
- `apps/web/src/app/(admin)/roles/_components/RolesDataTable.tsx` (new)
- `apps/web/src/app/(admin)/roles/_hooks/index.ts` (new)
- `apps/web/src/app/(admin)/roles/_hooks/useRoleMutations.ts` (new)
- `apps/web/src/app/(admin)/roles/_schemas/index.ts` (new)
- `apps/web/src/app/(admin)/roles/_schemas/roleSchema.ts` (new)

**Categories:**
- `apps/web/src/app/(admin)/categories/page.tsx` (rewrite)
- `apps/web/src/app/(admin)/categories/_components/index.ts` (new)
- `apps/web/src/app/(admin)/categories/_components/CategoryFormDialog.tsx` (new)
- `apps/web/src/app/(admin)/categories/_components/CategoriesDataTable.tsx` (new)
- `apps/web/src/app/(admin)/categories/_hooks/index.ts` (new)
- `apps/web/src/app/(admin)/categories/_hooks/useCategoryMutations.ts` (new)
- `apps/web/src/app/(admin)/categories/_schemas/index.ts` (new)
- `apps/web/src/app/(admin)/categories/_schemas/categorySchema.ts` (new)

**Stores:**
- `apps/web/src/app/(admin)/stores/page.tsx` (rewrite)
- `apps/web/src/app/(admin)/stores/_components/StoreFormDialog.tsx` (rewrite)
- `apps/web/src/app/(admin)/stores/_components/StoresTable.tsx` (keep, rename to StoresDataTable.tsx)
- `apps/web/src/app/(admin)/stores/_components/index.ts` (update)
- `apps/web/src/app/(admin)/stores/_hooks/useStoreMutations.ts` (rewrite)
- `apps/web/src/app/(admin)/stores/_hooks/index.ts` (keep)
- `apps/web/src/app/(admin)/stores/_schemas/index.ts` (new)
- `apps/web/src/app/(admin)/stores/_schemas/storeSchema.ts` (new)

**Modifiers:**
- `apps/web/src/app/(admin)/modifiers/page.tsx` (rewrite)
- `apps/web/src/app/(admin)/modifiers/_components/index.ts` (new)
- `apps/web/src/app/(admin)/modifiers/_components/ModifierGroupFormDialog.tsx` (new)
- `apps/web/src/app/(admin)/modifiers/_components/ModifiersDataTable.tsx` (new)
- `apps/web/src/app/(admin)/modifiers/_hooks/index.ts` (new)
- `apps/web/src/app/(admin)/modifiers/_hooks/useModifierMutations.ts` (new)
- `apps/web/src/app/(admin)/modifiers/_schemas/index.ts` (new)
- `apps/web/src/app/(admin)/modifiers/_schemas/modifierGroupSchema.ts` (new)

**Products:**
- `apps/web/src/app/(admin)/products/page.tsx` (rewrite)
- `apps/web/src/app/(admin)/products/_components/index.ts` (new)
- `apps/web/src/app/(admin)/products/_components/ProductFormDialog.tsx` (new)
- `apps/web/src/app/(admin)/products/_components/ProductsDataTable.tsx` (new)
- `apps/web/src/app/(admin)/products/_components/QuickCreateCategoryDialog.tsx` (new)
- `apps/web/src/app/(admin)/products/_hooks/index.ts` (new)
- `apps/web/src/app/(admin)/products/_hooks/useProductMutations.ts` (new)
- `apps/web/src/app/(admin)/products/_schemas/index.ts` (new)
- `apps/web/src/app/(admin)/products/_schemas/productSchema.ts` (new)

**Users:**
- `apps/web/src/app/(admin)/users/page.tsx` (rewrite)
- `apps/web/src/app/(admin)/users/_components/index.ts` (new)
- `apps/web/src/app/(admin)/users/_components/UserFormDialog.tsx` (new)
- `apps/web/src/app/(admin)/users/_components/UsersDataTable.tsx` (new)
- `apps/web/src/app/(admin)/users/_components/ResetPasswordDialog.tsx` (new)
- `apps/web/src/app/(admin)/users/_components/PinManagementDialog.tsx` (new)
- `apps/web/src/app/(admin)/users/_components/QuickCreateRoleDialog.tsx` (new)
- `apps/web/src/app/(admin)/users/_hooks/index.ts` (new)
- `apps/web/src/app/(admin)/users/_hooks/useUserMutations.ts` (new)
- `apps/web/src/app/(admin)/users/_schemas/index.ts` (new)
- `apps/web/src/app/(admin)/users/_schemas/userSchema.ts` (new)

---

## Chunk 1: Foundation Setup

### Task 1: Install shadcn field and textarea components

**Files:**
- Create: `apps/web/src/components/ui/field.tsx` (via CLI)
- Create: `apps/web/src/components/ui/textarea.tsx` (via CLI)
- Modify: `apps/web/src/components/ui/label.tsx` (overwritten by CLI — formatting only)
- Modify: `apps/web/src/components/ui/separator.tsx` (overwritten by CLI — formatting only)

- [ ] **Step 1: Install field component**

```bash
cd apps/web && pnpm dlx shadcn@latest add field --overwrite
```

Expected: Creates `src/components/ui/field.tsx`, updates label.tsx and separator.tsx (formatting only).

- [ ] **Step 2: Install textarea component**

```bash
cd apps/web && pnpm dlx shadcn@latest add textarea
```

Expected: Creates `src/components/ui/textarea.tsx`.

- [ ] **Step 3: Verify installed components**

```bash
ls apps/web/src/components/ui/field.tsx apps/web/src/components/ui/textarea.tsx
```

Expected: Both files exist.

- [ ] **Step 4: Remove old form.tsx (unused React Hook Form wrapper)**

```bash
rm apps/web/src/components/ui/form.tsx
```

Verify no imports reference it:
```bash
cd apps/web && grep -r "components/ui/form" src/ --include="*.tsx" --include="*.ts"
```

Expected: No results (form.tsx is unused).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat(web): install shadcn field + textarea, remove unused form.tsx"
```

---

## Chunk 2: Tables Page Migration (Pattern Reference)

This is the simplest page and establishes the pattern all other pages follow.

### Task 2: Create table schema

**Files:**
- Create: `apps/web/src/app/(admin)/tables/_schemas/tableSchema.ts`
- Create: `apps/web/src/app/(admin)/tables/_schemas/index.ts`

- [ ] **Step 1: Create schema file**

```typescript
// apps/web/src/app/(admin)/tables/_schemas/tableSchema.ts
import { z } from "zod";

export const tableSchema = z.object({
  name: z.string().min(1, "Table name is required"),
  capacity: z.number().int().min(1, "Capacity must be at least 1"),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export type TableFormValues = z.infer<typeof tableSchema>;

export const tableDefaults: TableFormValues = {
  name: "",
  capacity: 4,
  sortOrder: 0,
  isActive: true,
};
```

- [ ] **Step 2: Create barrel export**

```typescript
// apps/web/src/app/(admin)/tables/_schemas/index.ts
export { tableSchema, type TableFormValues, tableDefaults } from "./tableSchema";
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/tables/_schemas/
git commit -m "feat(web): add Zod schema for tables form"
```

### Task 3: Create table mutations hook

**Files:**
- Create: `apps/web/src/app/(admin)/tables/_hooks/useTableMutations.ts`
- Create: `apps/web/src/app/(admin)/tables/_hooks/index.ts`

- [ ] **Step 1: Create mutations hook**

```typescript
// apps/web/src/app/(admin)/tables/_hooks/useTableMutations.ts
"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { TableFormValues } from "../_schemas";

export function useTableMutations() {
  const createTable = useMutation(api.tables.create);
  const updateTable = useMutation(api.tables.update);

  const handleCreate = useCallback(
    async (values: TableFormValues, storeId: Id<"stores">) => {
      await createTable({
        storeId,
        name: values.name,
        capacity: values.capacity,
        sortOrder: values.sortOrder,
      });
      toast.success("Table created successfully");
    },
    [createTable],
  );

  const handleUpdate = useCallback(
    async (values: TableFormValues, tableId: Id<"tables">) => {
      await updateTable({
        tableId,
        name: values.name,
        capacity: values.capacity,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
      });
      toast.success("Table updated successfully");
    },
    [updateTable],
  );

  return { handleCreate, handleUpdate };
}
```

- [ ] **Step 2: Create barrel export**

```typescript
// apps/web/src/app/(admin)/tables/_hooks/index.ts
export { useTableMutations } from "./useTableMutations";
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/tables/_hooks/
git commit -m "feat(web): add table mutations hook"
```

### Task 4: Create TableFormDialog component

**Files:**
- Create: `apps/web/src/app/(admin)/tables/_components/TableFormDialog.tsx`

This is the **reference implementation** for all other form dialogs.

- [ ] **Step 1: Create the form dialog**

```tsx
// apps/web/src/app/(admin)/tables/_components/TableFormDialog.tsx
"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAdminStore } from "@/stores/useAdminStore";
import { useTableMutations } from "../_hooks";
import { tableDefaults, tableSchema, type TableFormValues } from "../_schemas";

interface TableFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"tables"> | null;
  initialValues?: TableFormValues;
}

export function TableFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
}: TableFormDialogProps) {
  const { selectedStoreId } = useAdminStore();
  const { handleCreate, handleUpdate } = useTableMutations();
  const saveAndCreateAnotherRef = useRef(false);

  const form = useForm({
    defaultValues: initialValues ?? tableDefaults,
    validators: {
      onBlur: tableSchema,
      onSubmit: tableSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        if (editingId) {
          await handleUpdate(value, editingId);
        } else {
          await handleCreate(value, selectedStoreId!);
        }

        if (saveAndCreateAnotherRef.current) {
          form.reset();
          saveAndCreateAnotherRef.current = false;
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        // Error already toasted in mutation hook
      }
    },
  });

  const isEditing = !!editingId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Table" : "Create Table"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the table details below."
              : "Fill in the details to create a new table."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              name="name"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>Table Name</FieldLabel>
                    <Input
                      id={field.name}
                      autoFocus
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="e.g., Table 1, Booth A"
                      aria-invalid={isInvalid || undefined}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                );
              }}
            />

            <div className="grid grid-cols-2 gap-4">
              <form.Field
                name="capacity"
                children={(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid || undefined}>
                      <FieldLabel htmlFor={field.name}>Capacity (seats)</FieldLabel>
                      <Input
                        id={field.name}
                        type="number"
                        min={1}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 1)}
                        aria-invalid={isInvalid || undefined}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  );
                }}
              />

              <form.Field
                name="sortOrder"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>Sort Order</FieldLabel>
                    <Input
                      id={field.name}
                      type="number"
                      min={0}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 0)}
                    />
                  </Field>
                )}
              />
            </div>

            {isEditing && (
              <form.Field
                name="isActive"
                children={(field) => (
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor={field.name}>Active</FieldLabel>
                    <Switch
                      id={field.name}
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />
                  </Field>
                )}
              />
            )}
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={form.state.isSubmitting}
            >
              Cancel
            </Button>
            {!isEditing && (
              <Button
                type="button"
                variant="outline"
                disabled={form.state.isSubmitting}
                onClick={() => {
                  saveAndCreateAnotherRef.current = true;
                  form.handleSubmit();
                }}
              >
                {form.state.isSubmitting ? "Saving..." : "Save & Create Another"}
              </Button>
            )}
            <Button type="submit" disabled={form.state.isSubmitting}>
              {form.state.isSubmitting ? "Saving..." : isEditing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
cd apps/web && pnpm typecheck
```

Expected: No type errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/tables/_components/TableFormDialog.tsx
git commit -m "feat(web): add TableFormDialog with TanStack Form + Zod validation"
```

### Task 5: Create TablesDataTable and TabNameDialog components

**Files:**
- Create: `apps/web/src/app/(admin)/tables/_components/TablesDataTable.tsx`
- Create: `apps/web/src/app/(admin)/tables/_components/TabNameDialog.tsx`
- Create: `apps/web/src/app/(admin)/tables/_components/index.ts`

- [ ] **Step 1: Create TablesDataTable**

Extract the table rendering, expand/collapse logic, and status badges from the current page.tsx into this component. It receives `tablesWithOrders` data, `onEdit` callback, and `onDuplicate` callback as props. Include "Duplicate" in the actions column alongside "Edit" using a DropdownMenu.

The component should include:
- The card with header showing table count
- The data table with expand/collapse for tabs
- Loading/empty states
- DropdownMenu on each row with Edit and Duplicate actions

- [ ] **Step 2: Create TabNameDialog**

Extract the tab name editing dialog. Simple component with:
- Props: `editingTab` state, `onClose`, `onSave`, `onReset`
- An Input for the tab name
- Uses a native `<form>` for Enter key support

- [ ] **Step 3: Create barrel export**

```typescript
// apps/web/src/app/(admin)/tables/_components/index.ts
export { TableFormDialog } from "./TableFormDialog";
export { TablesDataTable } from "./TablesDataTable";
export { TabNameDialog } from "./TabNameDialog";
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/tables/_components/
git commit -m "feat(web): add TablesDataTable and TabNameDialog components"
```

### Task 6: Rewrite tables page.tsx

**Files:**
- Modify: `apps/web/src/app/(admin)/tables/page.tsx`

- [ ] **Step 1: Rewrite page.tsx to compose components**

The page becomes minimal — it owns the dialog state, queries the data, and passes callbacks:

```tsx
// apps/web/src/app/(admin)/tables/page.tsx
"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAdminStore } from "@/stores/useAdminStore";
import { TableFormDialog, TablesDataTable, TabNameDialog } from "./_components";
import { tableDefaults, type TableFormValues } from "./_schemas";

export default function TablesPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<TableFormValues>(tableDefaults);

  // Tab name editing state
  const [editingTab, setEditingTab] = useState<{
    orderId: Id<"orders">;
    tabName: string;
    tabNumber: number;
  } | null>(null);

  // Queries
  const tablesWithOrders = useQuery(
    api.tables.listWithOrders,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const updateTabName = useMutation(api.orders.updateTabName);

  const handleOpenCreate = () => {
    const maxSortOrder = tablesWithOrders?.reduce((max, t) => Math.max(max, t.sortOrder), -1) ?? -1;
    setEditingId(null);
    setFormInitialValues({ ...tableDefaults, sortOrder: maxSortOrder + 1 });
    setIsFormOpen(true);
  };

  const handleOpenEdit = (table: NonNullable<typeof tablesWithOrders>[number]) => {
    setEditingId(table._id);
    setFormInitialValues({
      name: table.name,
      capacity: table.capacity ?? 4,
      sortOrder: table.sortOrder ?? 0,
      isActive: true,
    });
    setIsFormOpen(true);
  };

  const handleDuplicate = (table: NonNullable<typeof tablesWithOrders>[number]) => {
    setEditingId(null);
    setFormInitialValues({
      name: `${table.name} (Copy)`,
      capacity: table.capacity ?? 4,
      sortOrder: table.sortOrder ?? 0,
      isActive: true,
    });
    setIsFormOpen(true);
  };

  const handleSaveTabName = async (newTabName: string) => {
    if (!editingTab) return;
    try {
      await updateTabName({
        orderId: editingTab.orderId,
        tabName: newTabName.trim() || `Tab ${editingTab.tabNumber}`,
      });
      toast.success("Tab name updated");
      setEditingTab(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tab name");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tables</h1>
          <p className="text-gray-500">Manage restaurant tables for dine-in orders</p>
        </div>
        <Button onClick={handleOpenCreate} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Table
        </Button>
      </div>

      <TablesDataTable
        tablesWithOrders={tablesWithOrders}
        selectedStoreId={selectedStoreId}
        onEdit={handleOpenEdit}
        onDuplicate={handleDuplicate}
        onEditTab={setEditingTab}
      />

      <TableFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
        initialValues={formInitialValues}
      />

      <TabNameDialog
        editingTab={editingTab}
        onClose={() => setEditingTab(null)}
        onSave={handleSaveTabName}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck and dev server**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 3: Manual test in browser**

1. Navigate to /tables
2. Click "Add Table" — dialog opens, cursor auto-focused in name field
3. Type a name, press Enter — form submits
4. Verify validation: blur name field without typing → error message appears
5. Click "Save & Create Another" — saves, form resets, dialog stays open
6. Edit a table — verify fields populate correctly
7. Duplicate a table — verify name has " (Copy)" suffix

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/tables/
git commit -m "feat(web): migrate tables page to TanStack Form with colocated structure"
```

---

## Chunk 3: Roles Page Migration

### Task 7: Create role schema

**Files:**
- Create: `apps/web/src/app/(admin)/roles/_schemas/roleSchema.ts`
- Create: `apps/web/src/app/(admin)/roles/_schemas/index.ts`

- [ ] **Step 1: Create schema**

```typescript
// apps/web/src/app/(admin)/roles/_schemas/roleSchema.ts
import { z } from "zod";

export const roleSchema = z.object({
  name: z.string().min(1, "Role name is required"),
  scopeLevel: z.enum(["system", "parent", "branch"]),
  permissions: z.array(z.string()).min(1, "Select at least one permission"),
});

export type RoleFormValues = z.infer<typeof roleSchema>;

export const roleDefaults: RoleFormValues = {
  name: "",
  scopeLevel: "branch",
  permissions: [],
};
```

- [ ] **Step 2: Create barrel export**

- [ ] **Step 3: Commit**

### Task 8: Create role mutations hook

**Files:**
- Create: `apps/web/src/app/(admin)/roles/_hooks/useRoleMutations.ts`
- Create: `apps/web/src/app/(admin)/roles/_hooks/index.ts`

- [ ] **Step 1: Create hook**

Uses `api.roles.create` and `api.roles.update`. The `handleCreate` takes `RoleFormValues`, the `handleUpdate` takes `RoleFormValues` + `roleId: Id<"roles">`. Both toast on success.

- [ ] **Step 2: Barrel export and commit**

### Task 9: Create RoleFormDialog component

**Files:**
- Create: `apps/web/src/app/(admin)/roles/_components/RoleFormDialog.tsx`

- [ ] **Step 1: Create form dialog**

Same pattern as TableFormDialog but with:
- Name input (autoFocus)
- Scope level Select (branch/parent/system — system only if user has system scope)
- Permissions section: grid of Cards by category, each containing Switch toggles
- Permissions field uses TanStack Form array handling — the `permissions` field value is `string[]`
- Toggle permission: if checked, push to array; if unchecked, filter out
- FieldError shows "Select at least one permission" from Zod if empty on submit
- Save & Create Another button in create mode
- Dialog has `max-h-[90vh] max-w-4xl overflow-y-auto` for the large permissions grid
- Receives `user` prop (for scope check) and `permissionCategories` (computed from PERMISSIONS)

- [ ] **Step 2: Typecheck and commit**

### Task 10: Create RolesDataTable and rewrite page.tsx

**Files:**
- Create: `apps/web/src/app/(admin)/roles/_components/RolesDataTable.tsx`
- Create: `apps/web/src/app/(admin)/roles/_components/index.ts`
- Modify: `apps/web/src/app/(admin)/roles/page.tsx`

- [ ] **Step 1: Create RolesDataTable**

Extracts: search filter card, roles table with badges, DropdownMenu with Edit/Duplicate actions. Receives `roles`, `searchQuery`, `onSearchChange`, `onEdit`, `onDuplicate` props.

- [ ] **Step 2: Rewrite page.tsx**

Minimal page composing RolesDataTable + RoleFormDialog. Owns dialog state, queries, and permission check. Passes `handleEdit`, `handleDuplicate`, `handleOpenCreate` callbacks.

For duplicate: copies role name + " (Copy)", scopeLevel, and full permissions array.

- [ ] **Step 3: Typecheck and manual test**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/roles/
git commit -m "feat(web): migrate roles page to TanStack Form with colocated structure"
```

---

## Chunk 4: Categories Page Migration

### Task 11: Create category schema

**Files:**
- Create: `apps/web/src/app/(admin)/categories/_schemas/categorySchema.ts`
- Create: `apps/web/src/app/(admin)/categories/_schemas/index.ts`

- [ ] **Step 1: Create schema**

```typescript
// apps/web/src/app/(admin)/categories/_schemas/categorySchema.ts
import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(1, "Category name is required"),
  parentId: z.string().optional(),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;

export const categoryDefaults: CategoryFormValues = {
  name: "",
  parentId: undefined,
  sortOrder: 0,
  isActive: true,
};
```

- [ ] **Step 2: Barrel export and commit**

### Task 12: Create category mutations hook

**Files:**
- Create: `apps/web/src/app/(admin)/categories/_hooks/useCategoryMutations.ts`
- Create: `apps/web/src/app/(admin)/categories/_hooks/index.ts`

- [ ] **Step 1: Create hook**

Uses `api.categories.create` and `api.categories.update`. The create handler takes `CategoryFormValues` + `storeId`. Handles the `parentId` conversion (undefined if "none").

- [ ] **Step 2: Barrel export and commit**

### Task 13: Create CategoryFormDialog

**Files:**
- Create: `apps/web/src/app/(admin)/categories/_components/CategoryFormDialog.tsx`

- [ ] **Step 1: Create form dialog**

Pattern matches TableFormDialog with additions:
- Name input (autoFocus)
- Parent category Select (with "No Parent (Main Category)" option) — filters out self when editing
- Sort order input
- Status Select (edit only)
- Modifier group assignments section (edit only) — keeps existing assign/unassign pattern using `api.modifierAssignments`
  - This section lives OUTSIDE the TanStack Form since it uses separate mutations (assign/unassign happen immediately, not on form submit)
  - Modifier group Select includes a `+ Create New Modifier Group` option that triggers the inline creation stacked dialog
- Save & Create Another in create mode

**Inline creation:** The modifier group quick-create triggers a small stacked Dialog (see Task 18 in Chunk 5 for the shared component — for now, just add the "+ Create" option in the select and wire it up later).

- [ ] **Step 2: Typecheck and commit**

### Task 14: Create CategoriesDataTable and rewrite page.tsx

**Files:**
- Create: `apps/web/src/app/(admin)/categories/_components/CategoriesDataTable.tsx`
- Create: `apps/web/src/app/(admin)/categories/_components/index.ts`
- Modify: `apps/web/src/app/(admin)/categories/page.tsx`

- [ ] **Step 1: Create CategoriesDataTable**

Table with columns: Name (with folder/tag icons), Type, Parent, Products count, Sort Order, Status, Actions (DropdownMenu with Edit/Duplicate).

- [ ] **Step 2: Rewrite page.tsx**

Minimal composer. Duplicate copies name + " (Copy)", parentId, sortOrder.

- [ ] **Step 3: Typecheck and manual test**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/categories/
git commit -m "feat(web): migrate categories page to TanStack Form with colocated structure"
```

---

## Chunk 5: Modifiers Page Migration (Combined Group + Options Form)

### Task 15: Create modifier group schema

**Files:**
- Create: `apps/web/src/app/(admin)/modifiers/_schemas/modifierGroupSchema.ts`
- Create: `apps/web/src/app/(admin)/modifiers/_schemas/index.ts`

- [ ] **Step 1: Create schema with nested options array**

```typescript
// apps/web/src/app/(admin)/modifiers/_schemas/modifierGroupSchema.ts
import { z } from "zod";

export const modifierOptionSchema = z.object({
  id: z.string().optional(), // Existing option ID for edit diffing
  name: z.string().min(1, "Option name is required"),
  priceAdjustment: z.number(),
  isDefault: z.boolean(),
});

export const modifierGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  selectionType: z.enum(["single", "multi"]),
  minSelections: z.number().int().min(0),
  maxSelections: z.number().int().min(0).optional(),
  isActive: z.boolean(),
  options: z.array(modifierOptionSchema).min(1, "At least one option is required"),
});

export type ModifierOptionFormValues = z.infer<typeof modifierOptionSchema>;
export type ModifierGroupFormValues = z.infer<typeof modifierGroupSchema>;

export const modifierGroupDefaults: ModifierGroupFormValues = {
  name: "",
  selectionType: "single",
  minSelections: 0,
  maxSelections: undefined,
  isActive: true,
  options: [{ name: "", priceAdjustment: 0, isDefault: false }],
};
```

- [ ] **Step 2: Barrel export and commit**

### Task 16: Create modifier mutations hook

**Files:**
- Create: `apps/web/src/app/(admin)/modifiers/_hooks/useModifierMutations.ts`
- Create: `apps/web/src/app/(admin)/modifiers/_hooks/index.ts`

- [ ] **Step 1: Create hook**

The hook handles the combined save logic:
- **Create flow:** Call `api.modifierGroups.create`, then batch `api.modifierOptions.create` for each option
- **Update flow:** Call `api.modifierGroups.update`, then diff options:
  - New options (no `id`): create
  - Existing options (has `id`): update
  - Missing options (had `id` in initial but not in current): delete/mark unavailable
- Uses `api.modifierOptions.toggleAvailability` for toggling

- [ ] **Step 2: Barrel export and commit**

### Task 17: Create ModifierGroupFormDialog (combined form)

**Files:**
- Create: `apps/web/src/app/(admin)/modifiers/_components/ModifierGroupFormDialog.tsx`

- [ ] **Step 1: Create the combined group + options form dialog**

This is the most complex form. Key features:
- Group fields: name (autoFocus), selectionType Select, min/max selections, status (edit only)
- Options section: dynamic array field using `form.Field` with `mode="array"`
  - Each row: name Input + priceAdjustment number Input + isDefault Switch + remove Button
  - `field.pushValue()` to add new option rows
  - `field.removeValue(index)` to delete
  - "Add Option" button at the bottom
  - Minimum 1 option enforced by Zod schema
- FieldError at the options array level shows "At least one option is required"
- Save & Create Another in create mode
- On edit: loads group data + existing options (with their IDs)

- [ ] **Step 2: Typecheck and commit**

### Task 18: Create ModifiersDataTable and rewrite page.tsx

**Files:**
- Create: `apps/web/src/app/(admin)/modifiers/_components/ModifiersDataTable.tsx`
- Create: `apps/web/src/app/(admin)/modifiers/_components/index.ts`
- Modify: `apps/web/src/app/(admin)/modifiers/page.tsx`

- [ ] **Step 1: Create ModifiersDataTable**

Table with columns: Name, Selection type, Min/Max, Options count, Status, Actions (DropdownMenu with Edit/Duplicate).

The old separate "manage options" panel is removed — options are now managed within the group form dialog.

- [ ] **Step 2: Rewrite page.tsx**

Minimal page composer.
- Queries: `api.modifierGroups.list`
- For edit: also queries `api.modifierGroups.get` to load options into the form
- Duplicate: copies group fields + all options (stripping option IDs so they're created as new)

- [ ] **Step 3: Typecheck and manual test**

Test specifically:
1. Create group with 3 options → all saved
2. Edit group → options load correctly
3. Add option during edit → new option created
4. Remove option during edit → option removed
5. Duplicate → group + all options copied with " (Copy)" name

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/modifiers/
git commit -m "feat(web): migrate modifiers page with combined group + options form"
```

---

## Chunk 6: Stores Page Migration

### Task 19: Create store schema

**Files:**
- Create: `apps/web/src/app/(admin)/stores/_schemas/storeSchema.ts`
- Create: `apps/web/src/app/(admin)/stores/_schemas/index.ts`

- [ ] **Step 1: Create schema**

```typescript
// apps/web/src/app/(admin)/stores/_schemas/storeSchema.ts
import { z } from "zod";

const socialSchema = z.object({
  platform: z.string().min(1, "Platform is required"),
  url: z.string().min(1, "URL is required"),
});

export const storeSchema = z.object({
  name: z.string().min(1, "Store name is required"),
  parentId: z.string().optional(),
  address1: z.string().min(1, "Address is required"),
  address2: z.string().optional(),
  tin: z.string().min(1, "TIN is required"),
  min: z.string().optional(),
  vatRate: z.number().min(0),
  contactNumber: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  website: z.string().optional(),
  socials: z.array(socialSchema),
  footer: z.string().optional(),
  isActive: z.boolean(),
});

export type StoreFormValues = z.infer<typeof storeSchema>;

export const storeDefaults: StoreFormValues = {
  name: "",
  parentId: undefined,
  address1: "",
  address2: "",
  tin: "",
  min: "",
  vatRate: 12,
  contactNumber: "",
  telephone: "",
  email: "",
  website: "",
  socials: [],
  footer: "",
  isActive: true,
};
```

- [ ] **Step 2: Barrel export and commit**

### Task 20: Rewrite StoreFormDialog with TanStack Form

**Files:**
- Modify: `apps/web/src/app/(admin)/stores/_components/StoreFormDialog.tsx`
- Modify: `apps/web/src/app/(admin)/stores/_hooks/useStoreMutations.ts`
- Delete: `apps/web/src/app/(admin)/stores/_stores/useStoreFormStore.ts`

- [ ] **Step 1: Rewrite useStoreMutations**

Remove Zustand dependency. The hook now receives values directly:
- `handleCreate(values: StoreFormValues)` → calls `api.stores.create`
- `handleUpdate(values: StoreFormValues, storeId: Id<"stores">)` → calls `api.stores.update`

- [ ] **Step 2: Rewrite StoreFormDialog**

Replace Zustand state with TanStack Form `useForm`. Key considerations:
- Social links use `form.Field` with `mode="array"` — add/remove rows dynamically
- Maskito inputs for TIN and phone number still work — bind via `field.state.value` and `field.handleChange`
- Textarea for receipt footer (use new shadcn textarea component)
- AutoFocus on store name field
- Save & Create Another in create mode

- [ ] **Step 3: Delete Zustand store**

```bash
rm apps/web/src/app/\(admin\)/stores/_stores/useStoreFormStore.ts
rmdir apps/web/src/app/\(admin\)/stores/_stores/ 2>/dev/null
```

Update any imports in the stores folder that referenced the Zustand store.

- [ ] **Step 4: Update page.tsx**

The page now manages dialog open/close state with `useState` instead of Zustand. Passes `editingId`, `initialValues`, `open`, `onOpenChange` to StoreFormDialog.

Add duplicate handler: copies all store fields with " (Copy)" name suffix.

- [ ] **Step 5: Typecheck and manual test**

Test: Maskito masks still work, social links add/remove, validation errors show.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(admin\)/stores/
git commit -m "feat(web): migrate stores page to TanStack Form, remove Zustand form store"
```

---

## Chunk 7: Products Page Migration

### Task 21: Create product schema

**Files:**
- Create: `apps/web/src/app/(admin)/products/_schemas/productSchema.ts`
- Create: `apps/web/src/app/(admin)/products/_schemas/index.ts`

- [ ] **Step 1: Create schema with conditional validation**

```typescript
// apps/web/src/app/(admin)/products/_schemas/productSchema.ts
import { z } from "zod";

export const productSchema = z
  .object({
    categoryId: z.string().min(1, "Category is required"),
    name: z.string().min(1, "Product name is required"),
    isOpenPrice: z.boolean(),
    price: z.number(),
    minPrice: z.number(),
    maxPrice: z.number(),
    sortOrder: z.number().int().min(0),
    isVatable: z.boolean(),
    isActive: z.boolean(),
  })
  .refine(
    (data) => {
      if (!data.isOpenPrice) return data.price > 0;
      return true;
    },
    { message: "Price must be greater than 0", path: ["price"] },
  )
  .refine(
    (data) => {
      if (data.isOpenPrice) return data.minPrice > 0;
      return true;
    },
    { message: "Minimum price must be greater than 0", path: ["minPrice"] },
  )
  .refine(
    (data) => {
      if (data.isOpenPrice) return data.maxPrice > 0;
      return true;
    },
    { message: "Maximum price must be greater than 0", path: ["maxPrice"] },
  )
  .refine(
    (data) => {
      if (data.isOpenPrice) return data.minPrice < data.maxPrice;
      return true;
    },
    { message: "Min price must be less than max price", path: ["maxPrice"] },
  );

export type ProductFormValues = z.infer<typeof productSchema>;

export const productDefaults: ProductFormValues = {
  categoryId: "",
  name: "",
  isOpenPrice: false,
  price: 0,
  minPrice: 0,
  maxPrice: 0,
  sortOrder: 0,
  isVatable: true,
  isActive: true,
};
```

- [ ] **Step 2: Barrel export and commit**

### Task 22: Create product mutations hook

**Files:**
- Create: `apps/web/src/app/(admin)/products/_hooks/useProductMutations.ts`
- Create: `apps/web/src/app/(admin)/products/_hooks/index.ts`

- [ ] **Step 1: Create hook**

Wraps `api.products.create` and `api.products.update`. Handles the conditional open-price field mapping.

- [ ] **Step 2: Barrel export and commit**

### Task 23: Create QuickCreateCategoryDialog

**Files:**
- Create: `apps/web/src/app/(admin)/products/_components/QuickCreateCategoryDialog.tsx`

- [ ] **Step 1: Create inline creation dialog**

Small stacked dialog for quick category creation:
- Props: `open`, `onOpenChange`, `onCreated(categoryId: Id<"categories">)`
- Fields: Category name (required, autoFocus), Parent category (optional)
- Uses its own `useForm` with a minimal Zod schema
- On save: creates category via `api.categories.create`, calls `onCreated` with the new ID, closes

```tsx
interface QuickCreateCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (categoryId: Id<"categories">) => void;
}
```

- [ ] **Step 2: Commit**

### Task 24: Create ProductFormDialog

**Files:**
- Create: `apps/web/src/app/(admin)/products/_components/ProductFormDialog.tsx`

- [ ] **Step 1: Create form dialog**

Key features:
- Category Select with `+ Create New Category` option → triggers `QuickCreateCategoryDialog`
  - When category is created, `onCreated` sets the form field value to the new category ID
- Name input (autoFocus)
- Open Price checkbox (uses `form.Field` for isOpenPrice boolean)
- Conditional fields: price/sortOrder when not open-price, minPrice/maxPrice/sortOrder when open-price
- VAT status Select
- Status Select (edit only)
- Modifier group assignments section (edit only) — same pattern as current, lives outside TanStack Form
- VAT breakdown display (read-only computed section)
- Save & Create Another in create mode

- [ ] **Step 2: Typecheck and commit**

### Task 25: Create ProductsDataTable and rewrite page.tsx

**Files:**
- Create: `apps/web/src/app/(admin)/products/_components/ProductsDataTable.tsx`
- Create: `apps/web/src/app/(admin)/products/_components/index.ts`
- Modify: `apps/web/src/app/(admin)/products/page.tsx`

- [ ] **Step 1: Create ProductsDataTable**

Includes:
- Filter card (search input + category dropdown + status dropdown) — same admin filter pattern
- Data table with columns and DropdownMenu actions (Edit/Duplicate)
- Loading/empty states

- [ ] **Step 2: Rewrite page.tsx**

Minimal composer. Duplicate copies all product fields + " (Copy)" name.

- [ ] **Step 3: Typecheck and manual test**

Test specifically:
1. Create product → select "+ Create New Category" → small dialog opens → create → auto-selected
2. Open price toggle → conditional fields appear/disappear
3. Validation: submit without category → error shown
4. Duplicate product → all fields copied

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/products/
git commit -m "feat(web): migrate products page with inline category creation"
```

---

## Chunk 8: Users Page Migration

### Task 26: Create user schema

**Files:**
- Create: `apps/web/src/app/(admin)/users/_schemas/userSchema.ts`
- Create: `apps/web/src/app/(admin)/users/_schemas/index.ts`

- [ ] **Step 1: Create schemas**

```typescript
// apps/web/src/app/(admin)/users/_schemas/userSchema.ts
import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  roleId: z.string().min(1, "Role is required"),
  storeId: z.string().optional(),
  isActive: z.boolean(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().optional(), // Not used for update, but keeps form shape consistent
  roleId: z.string().min(1, "Role is required"),
  storeId: z.string().optional(),
  isActive: z.boolean(),
});

export type UserFormValues = z.infer<typeof createUserSchema>;

export const userDefaults: UserFormValues = {
  name: "",
  email: "",
  password: "",
  roleId: "",
  storeId: undefined,
  isActive: true,
};

export const resetPasswordSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export const pinSchema = z.object({
  pin: z
    .string()
    .min(4, "PIN must be 4-6 digits")
    .max(6, "PIN must be 4-6 digits")
    .regex(/^\d+$/, "PIN must contain only digits"),
});

export type PinFormValues = z.infer<typeof pinSchema>;
```

- [ ] **Step 2: Barrel export and commit**

### Task 27: Create user mutations hook

**Files:**
- Create: `apps/web/src/app/(admin)/users/_hooks/useUserMutations.ts`
- Create: `apps/web/src/app/(admin)/users/_hooks/index.ts`

- [ ] **Step 1: Create hook**

Wraps all user operations:
- `handleCreate` → `useAction(api.users.create)` — note: this is an `action`, not a `mutation`
- `handleUpdate` → `useMutation(api.helpers.usersHelpers.update)`
- `handleResetPassword` → `useAction(api.users.resetPassword)`
- `handleSetPin` → `useAction(api.users.setPin)`
- `handleClearPin` → `useAction(api.users.clearPin)`

- [ ] **Step 2: Barrel export and commit**

### Task 28: Create UserFormDialog, ResetPasswordDialog, PinManagementDialog, QuickCreateRoleDialog

**Files:**
- Create: `apps/web/src/app/(admin)/users/_components/UserFormDialog.tsx`
- Create: `apps/web/src/app/(admin)/users/_components/ResetPasswordDialog.tsx`
- Create: `apps/web/src/app/(admin)/users/_components/PinManagementDialog.tsx`
- Create: `apps/web/src/app/(admin)/users/_components/QuickCreateRoleDialog.tsx`

- [ ] **Step 1: Create UserFormDialog**

Fields:
- Name input (autoFocus)
- Email input (disabled on edit, with helper text)
- Password input (create mode only)
- Role Select with `+ Create New Role` → triggers QuickCreateRoleDialog
- Store Select (with "No Store (System-wide)" option)
- Status Select (edit only)
- Uses `createUserSchema` for create mode, `updateUserSchema` for edit mode (dynamic validator)
- Save & Create Another in create mode

- [ ] **Step 2: Create ResetPasswordDialog**

Simple form with:
- Password input (autoFocus)
- Uses `resetPasswordSchema`
- Native `<form>` element for Enter key

- [ ] **Step 3: Create PinManagementDialog**

Fields:
- PIN status Badge display
- PIN input (numeric, 4-6 digits, autoFocus)
- Uses `pinSchema`
- "Remove PIN" destructive button (when PIN exists)
- "Save PIN" primary button

- [ ] **Step 4: Create QuickCreateRoleDialog**

Small stacked dialog:
- Role name input (autoFocus)
- Scope level Select
- Minimal set of permission checkboxes (or just name + scope, full permissions editing later)
- On save: creates role, calls `onCreated(roleId)`, closes

- [ ] **Step 5: Typecheck and commit**

### Task 29: Create UsersDataTable and rewrite page.tsx

**Files:**
- Create: `apps/web/src/app/(admin)/users/_components/UsersDataTable.tsx`
- Create: `apps/web/src/app/(admin)/users/_components/index.ts`
- Modify: `apps/web/src/app/(admin)/users/page.tsx`

- [ ] **Step 1: Create UsersDataTable**

Includes search card, data table, DropdownMenu with Edit/Duplicate/Reset Password/Manage PIN actions.

- [ ] **Step 2: Rewrite page.tsx**

Minimal composer managing all 4 dialog states. Duplicate copies name + " (Copy)", roleId, storeId.

- [ ] **Step 3: Typecheck and manual test**

Test:
1. Create user → validates email, password, role required
2. Edit user → email disabled, password hidden
3. Reset password → Enter key works
4. PIN management → 4-6 digit validation
5. "+ Create Role" → stacked dialog → auto-selects new role

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/users/
git commit -m "feat(web): migrate users page with inline role creation"
```

---

## Chunk 9: Wire Up Cross-Page Inline Creation + Final Cleanup

### Task 30: Wire modifier group inline creation in categories and products

**Files:**
- Modify: `apps/web/src/app/(admin)/categories/_components/CategoryFormDialog.tsx`
- Modify: `apps/web/src/app/(admin)/products/_components/ProductFormDialog.tsx`

- [ ] **Step 1: Create a shared QuickCreateModifierGroupDialog**

Create in a shared location since both categories and products need it:
`apps/web/src/app/(admin)/_shared/QuickCreateModifierGroupDialog.tsx`

Small stacked dialog:
- Group name (autoFocus)
- Selection type Select
- Starts with 1 option row (name + price adjustment)
- Can add more option rows
- On save: creates group + options, calls `onCreated(groupId)`, closes

- [ ] **Step 2: Wire into CategoryFormDialog**

Add `+ Create New Modifier Group` option in the modifier group Select. When selected, opens QuickCreateModifierGroupDialog. On created, auto-assigns the new group.

- [ ] **Step 3: Wire into ProductFormDialog**

Same pattern as categories.

- [ ] **Step 4: Typecheck and commit**

```bash
git add apps/web/src/app/\(admin\)/_shared/ apps/web/src/app/\(admin\)/categories/ apps/web/src/app/\(admin\)/products/
git commit -m "feat(web): add inline modifier group creation to categories and products"
```

### Task 31: Final cleanup and verification

- [ ] **Step 1: Remove unused imports**

Check all modified pages for unused imports (old Label, old form patterns). Run:

```bash
cd apps/web && pnpm lint
```

Fix any lint issues.

- [ ] **Step 2: Full typecheck**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 3: Verify all pages work end-to-end**

Navigate through each admin page and verify:
1. Tables: Create, Edit, Duplicate, Tab name edit, Enter key, Save & Create Another
2. Roles: Create, Edit, Duplicate, Permission toggles, Enter key
3. Categories: Create, Edit, Duplicate, Modifier assignment, Inline modifier group creation
4. Modifiers: Create with options, Edit with option changes, Duplicate group + options
5. Stores: Create, Edit, Duplicate, Masked inputs, Social links, Textarea
6. Products: Create, Edit, Duplicate, Inline category creation, Open price toggle, Modifier assignment
7. Users: Create, Edit, Duplicate, Reset password, PIN management, Inline role creation

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix(web): cleanup lint and typecheck issues from forms migration"
```

- [ ] **Step 5: Final commit summary**

```bash
git log --oneline -15
```

Verify the commit history tells a clean story of the migration.
