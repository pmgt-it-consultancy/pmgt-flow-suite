# Implementation Plan: Product Modifiers

## Overview
Add a modifier system allowing restaurants to define reusable modifier groups (Size, Sweetness, Add-ons, etc.) with options, assign them to products or categories, and capture selected modifiers on order items.

## Design Summary
- **Modifier Groups**: store-level, reusable, with selection type (single/multi), min/max, sort order
- **Modifier Options**: belong to a group, ordered, priced (fixed, can be $0), toggleable availability, default flag
- **Assignment**: to products directly OR to categories (products inherit from category)
- **Override**: product-level assignment overrides category-level for same group
- **Order snapshot**: selected modifiers + prices captured at order time

---

## Phase 1: Backend Schema & CRUD

### Task 1.1: Add modifier tables to schema
**File:** `packages/backend/convex/schema.ts`

Add 3 new tables after the `products` table definition (around line 91):

```typescript
// ===== MODIFIERS =====
modifierGroups: defineTable({
  storeId: v.id("stores"),
  name: v.string(),
  selectionType: v.union(v.literal("single"), v.literal("multi")),
  minSelections: v.number(), // 0 = optional, 1+ = required
  maxSelections: v.optional(v.number()), // null/undefined = unlimited
  sortOrder: v.number(),
  isActive: v.boolean(),
  createdAt: v.number(),
})
  .index("by_store", ["storeId"])
  .index("by_store_active", ["storeId", "isActive"]),

modifierOptions: defineTable({
  modifierGroupId: v.id("modifierGroups"),
  name: v.string(),
  priceAdjustment: v.number(), // can be 0
  isDefault: v.boolean(),
  isAvailable: v.boolean(),
  sortOrder: v.number(),
  createdAt: v.number(),
})
  .index("by_group", ["modifierGroupId"])
  .index("by_group_available", ["modifierGroupId", "isAvailable"]),

// Join table: assigns modifier groups to products or categories
modifierGroupAssignments: defineTable({
  storeId: v.id("stores"),
  modifierGroupId: v.id("modifierGroups"),
  // Exactly one of these should be set
  productId: v.optional(v.id("products")),
  categoryId: v.optional(v.id("categories")),
  sortOrder: v.number(), // display order of this group on the product/category
  // Optional overrides (if not set, use group defaults)
  minSelectionsOverride: v.optional(v.number()),
  maxSelectionsOverride: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_product", ["productId"])
  .index("by_category", ["categoryId"])
  .index("by_modifierGroup", ["modifierGroupId"])
  .index("by_store", ["storeId"]),
```

**Verification:** Run `npm run typecheck` from root — schema changes should compile.

---

### Task 1.2: Add order item modifier snapshot to schema
**File:** `packages/backend/convex/schema.ts`

Add a new table after `orderItems` (around line 168):

```typescript
orderItemModifiers: defineTable({
  orderItemId: v.id("orderItems"),
  modifierGroupName: v.string(), // snapshot
  modifierOptionName: v.string(), // snapshot
  priceAdjustment: v.number(), // snapshot at order time
})
  .index("by_orderItem", ["orderItemId"]),
```

**Verification:** Run `npm run typecheck`.

---

### Task 1.3: Create modifierGroups.ts backend functions
**File:** `packages/backend/convex/modifierGroups.ts` (new file)

Create CRUD functions following the exact pattern from `categories.ts`:
- `list` query — args: `{ storeId, includeInactive? }`, returns array of groups with option count
- `get` query — args: `{ modifierGroupId }`, returns group with its options
- `create` mutation — args: `{ storeId, name, selectionType, minSelections, maxSelections?, sortOrder? }`, permission: `"modifiers.manage"`
- `update` mutation — args: `{ modifierGroupId, name?, selectionType?, minSelections?, maxSelections?, isActive?, sortOrder? }`, permission: `"modifiers.manage"`
- `reorder` mutation — args: `{ modifierGroupIds }`, permission: `"modifiers.manage"`

Follow these patterns from the existing code:
- Use `requireAuth(ctx)` and `requirePermission(ctx, user._id, "modifiers.manage")`
- Import from `"./_generated/server"` and `"convex/values"`
- Use `withIndex()` not `filter()` for queries
- Auto-calculate `sortOrder` if not provided (same pattern as `categories.ts:create`)
- All functions use object-based syntax with `returns` validator

**Verification:** Run `npm run typecheck`.

---

### Task 1.4: Create modifierOptions.ts backend functions
**File:** `packages/backend/convex/modifierOptions.ts` (new file)

CRUD for modifier options:
- `list` query — args: `{ modifierGroupId }`, returns options sorted by sortOrder, filtered by isAvailable optionally
- `create` mutation — args: `{ modifierGroupId, name, priceAdjustment, isDefault?, sortOrder? }`, validates group exists, permission: `"modifiers.manage"`
- `update` mutation — args: `{ modifierOptionId, name?, priceAdjustment?, isDefault?, isAvailable?, sortOrder? }`, permission: `"modifiers.manage"`
- `reorder` mutation — args: `{ modifierOptionIds }`, permission: `"modifiers.manage"`
- `toggleAvailability` mutation — args: `{ modifierOptionId }`, permission: `"modifiers.manage"` — quick toggle for "out of stock today"

**Verification:** Run `npm run typecheck`.

---

### Task 1.5: Create modifierAssignments.ts backend functions
**File:** `packages/backend/convex/modifierAssignments.ts` (new file)

Assignment management + resolution logic:
- `assign` mutation — args: `{ storeId, modifierGroupId, productId?, categoryId?, sortOrder?, minSelectionsOverride?, maxSelectionsOverride? }` — validates exactly one of productId/categoryId is set, permission: `"modifiers.manage"`
- `unassign` mutation — args: `{ assignmentId }`, permission: `"modifiers.manage"`
- `updateAssignment` mutation — args: `{ assignmentId, sortOrder?, minSelectionsOverride?, maxSelectionsOverride? }`, permission: `"modifiers.manage"`
- `getForProduct` query — **KEY FUNCTION** — args: `{ productId }`, returns merged list of modifier groups (product-level + inherited from category), each with their options. Resolution logic:
  1. Get product's direct assignments
  2. Get product's category, then get category assignments
  3. Merge: product-level overrides category-level for same modifierGroupId
  4. For each group, fetch active/available options sorted by sortOrder
  5. Return array of `{ groupId, groupName, selectionType, minSelections, maxSelections, sortOrder, options: [{ optionId, name, priceAdjustment, isDefault }] }`

**Verification:** Run `npm run typecheck`.

---

## Phase 2: Order Integration

### Task 2.1: Update addItem mutation to accept modifiers
**File:** `packages/backend/convex/orders.ts`

Modify `addItem` mutation (line 424):
- Add arg: `modifiers: v.optional(v.array(v.object({ modifierGroupId: v.id("modifierGroups"), modifierGroupName: v.string(), modifierOptionId: v.id("modifierOptions"), modifierOptionName: v.string(), priceAdjustment: v.number() })))`
- After inserting the orderItem, insert into `orderItemModifiers` for each selected modifier
- Update `productPrice` snapshot to remain the base product price
- The modifier price adjustments are stored separately in `orderItemModifiers`

**No changes to the `orderItems` table structure** — modifiers are stored in the separate `orderItemModifiers` table.

---

### Task 2.2: Update recalculateOrderTotals to include modifier prices
**File:** `packages/backend/convex/orders.ts`

Modify `recalculateOrderTotals` (line 595):
- For each active order item, also query `orderItemModifiers` by `orderItemId`
- Sum the `priceAdjustment` values and add to the item's effective price:
  ```typescript
  const modifiers = await ctx.db
    .query("orderItemModifiers")
    .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
    .collect();
  const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
  const effectivePrice = item.productPrice + modifierTotal;
  return calculateItemTotals(effectivePrice, item.quantity, isVatable, 0);
  ```

---

### Task 2.3: Update order get query to include modifiers on items
**File:** `packages/backend/convex/orders.ts`

Modify the `get` query (line 114) to include modifiers in each item's return object:
- For each order item, fetch `orderItemModifiers` by `orderItemId`
- Add to item return: `modifiers: [{ groupName, optionName, priceAdjustment }]`
- Update `lineTotal` calculation to include modifier totals: `(item.productPrice + modifierTotal) * item.quantity`
- Update the `returns` validator to include the modifiers array

---

### Task 2.4: Update createAndSendToKitchen to accept modifiers
**File:** `packages/backend/convex/orders.ts`

Modify `createAndSendToKitchen` (line 993):
- Update items arg to include optional modifiers array (same shape as addItem)
- After inserting each orderItem, insert corresponding `orderItemModifiers`

---

## Phase 3: Native App — Modifier Selection UI

### Task 3.1: Create ModifierSelectionModal component
**File:** `apps/native/src/features/orders/components/ModifierSelectionModal.tsx` (new file)

A modal that appears when tapping a product that has modifiers. Design:
- Title: product name + base price
- For each modifier group (sorted):
  - Group header: name + required/optional badge
  - If single-select: radio-style list of options (highlight selected, show price adjustment like "+₱50")
  - If multi-select: checkbox-style list of options
  - Default option pre-selected
- Running total at bottom: base price + sum of selected modifier adjustments × quantity
- Quantity selector (reuse existing pattern from AddItemModal)
- Notes field (reuse existing pattern)
- "Add to Order" button — disabled if required groups don't meet min selections
- "Cancel" button

Use existing UI components: `Modal`, `Text`, `Button`, `IconButton` from `features/shared/components/ui`.
Use `uniwind` className styling consistent with existing components.

---

### Task 3.2: Create useProductModifiers hook
**File:** `apps/native/src/features/orders/hooks/useProductModifiers.ts` (new file)

Custom hook that:
- Takes a `productId`
- Calls `useQuery(api.modifierAssignments.getForProduct, { productId })`
- Returns `{ modifierGroups, isLoading, hasModifiers }`
- `hasModifiers` = true if any groups are returned (used to decide whether to show modifier modal vs simple add)

---

### Task 3.3: Update ProductCard to indicate modifiers
**File:** `apps/native/src/features/orders/components/ProductCard.tsx`

Add a small visual indicator when a product has modifiers:
- Add optional `hasModifiers` prop
- If true, show a small badge/tag like "Customizable" or a small icon below the price
- Keep existing onPress behavior — the parent screen handles routing to the correct modal

---

### Task 3.4: Update OrderScreen to handle modifier flow
**File:** `apps/native/src/features/orders/screens/OrderScreen.tsx`

Modify the product tap flow:
- When a product is tapped, check if it has modifiers (using `getForProduct` query or prefetched data)
- If **no modifiers**: show existing `AddItemModal` (unchanged behavior)
- If **has modifiers**: show new `ModifierSelectionModal`
- When confirming from `ModifierSelectionModal`, call `addItem` with the selected modifiers array
- For draft mode (local state before send), store selected modifiers alongside the draft item

Update draft item type to include:
```typescript
interface DraftItem {
  productId: Id<"products">;
  productName: string;
  productPrice: number;
  quantity: number;
  notes: string;
  modifiers?: Array<{
    modifierGroupId: Id<"modifierGroups">;
    modifierGroupName: string;
    modifierOptionId: Id<"modifierOptions">;
    modifierOptionName: string;
    priceAdjustment: number;
  }>;
}
```

---

### Task 3.5: Update TakeoutOrderScreen to handle modifier flow
**File:** `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`

Same changes as OrderScreen (Task 3.4) — integrate modifier modal into the takeout ordering flow.

---

### Task 3.6: Update CartItem to display selected modifiers
**File:** `apps/native/src/features/orders/components/CartItem.tsx`

Show selected modifiers under the product name in the cart:
- Below product name, show each selected modifier in smaller gray text: "Large (+₱50)", "Extra shot (+₱80)"
- Update line total display to include modifier price adjustments

---

## Phase 4: Receipt & Kitchen Print Integration

### Task 4.1: Update kitchen ticket formatting
**File:** `apps/native/src/features/settings/services/escposFormatter.ts`

Update the kitchen ticket format to include modifiers under each item:
```
1x Iced Americano
   > Large
   > Extra shot
   > 50% sweetness
```

---

### Task 4.2: Update receipt formatting
**File:** `apps/native/src/features/settings/services/escposFormatter.ts`

Update receipt to show modifiers with prices:
```
Iced Americano (L)        ₱150.00
  + Extra shot              ₱80.00
```

Or a simpler format that fits thermal receipt width.

---

## Phase 5: Admin CRUD (if web admin exists)

### Task 5.1: Check if web admin needs modifier management pages
Investigate `apps/web` to determine if there are existing product/category management pages. If so, create corresponding modifier management pages:
- Modifier Groups list + create/edit
- Modifier Options management within a group
- Assignment UI on product/category edit screens

---

## Implementation Order & Dependencies

```
Phase 1 (Backend):
  1.1 Schema → 1.2 Schema → 1.3 Groups CRUD → 1.4 Options CRUD → 1.5 Assignments CRUD

Phase 2 (Order Integration) — depends on Phase 1:
  2.1 addItem → 2.2 recalculate → 2.3 get query → 2.4 createAndSendToKitchen

Phase 3 (Native UI) — depends on Phase 2:
  3.1 ModifierSelectionModal + 3.2 useProductModifiers hook (parallel)
  → 3.3 ProductCard indicator
  → 3.4 OrderScreen + 3.5 TakeoutOrderScreen (parallel)
  → 3.6 CartItem display

Phase 4 (Printing) — depends on Phase 3:
  4.1 Kitchen ticket + 4.2 Receipt (parallel)

Phase 5 (Admin) — can run parallel to Phase 3/4
```

## Permission
Add `"modifiers.manage"` to the permissions system. Check `packages/backend/convex/lib/permissions.ts` for how permissions are defined and ensure this new permission is included in appropriate roles.
