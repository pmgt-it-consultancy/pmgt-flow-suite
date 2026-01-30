# Implementation Plan: Discount & Receipt Enhancements

## Overview
Enhance receipts to show product modifiers, per-discount detail lines with discountee info, and support multiple SC/PWD discounts on the same item (shared by quantity across seniors).

---

## Task 1: Backend — Allow multiple SC/PWD discounts on same item

**File:** `packages/backend/convex/discounts.ts`

### 1a. Change `applyScPwdDiscount` validation (lines 62-70)

Replace the "item already has a discount" check with a quantity-based check:

```typescript
// OLD (lines 62-70):
const existingDiscount = await ctx.db
  .query("orderDiscounts")
  .withIndex("by_orderItem", (q) => q.eq("orderItemId", args.orderItemId))
  .first();
if (existingDiscount) {
  throw new Error("Item already has a discount applied");
}

// NEW:
const existingDiscounts = await ctx.db
  .query("orderDiscounts")
  .withIndex("by_orderItem", (q) => q.eq("orderItemId", args.orderItemId))
  .collect();
const totalDiscountedQty = existingDiscounts.reduce((sum, d) => sum + d.quantityApplied, 0);
if (totalDiscountedQty + args.quantityApplied > orderItem.quantity) {
  throw new Error(
    `Cannot apply discount: only ${orderItem.quantity - totalDiscountedQty} undiscounted quantity remaining`
  );
}
```

### 1b. Change `recalculateOrderTotalsWithDiscounts` to sum multiple discounts per item (lines 264-274)

Replace the single-discount map with a quantity-summing map:

```typescript
// OLD (lines 264-274):
const itemDiscounts = new Map<string, Doc<"orderDiscounts">>();
...
for (const discount of discounts) {
  if (discount.orderItemId) {
    itemDiscounts.set(discount.orderItemId, discount);
  } else {
    orderLevelDiscountAmount += discount.discountAmount;
  }
}

// NEW:
const itemDiscountQty = new Map<string, number>();
let orderLevelDiscountAmount = 0;
for (const discount of discounts) {
  if (discount.orderItemId) {
    const current = itemDiscountQty.get(discount.orderItemId) ?? 0;
    itemDiscountQty.set(discount.orderItemId, current + discount.quantityApplied);
  } else {
    orderLevelDiscountAmount += discount.discountAmount;
  }
}
```

Then update the item calculation loop (lines 282-290):

```typescript
// OLD:
const discount = itemDiscounts.get(item._id);
const scPwdQuantity =
  discount && (discount.discountType === "senior_citizen" || discount.discountType === "pwd")
    ? discount.quantityApplied
    : 0;

// NEW:
const scPwdQuantity = itemDiscountQty.get(item._id) ?? 0;
```

### Verification
- Apply 2 SC discounts to a 3-qty item (each qty=1). Should succeed.
- Apply a 3rd discount with qty=1 to the same item. Should succeed (total=3).
- Apply a 4th discount with qty=1. Should fail with "only 0 undiscounted quantity remaining".

---

## Task 2: Frontend — Update DiscountModal to not fully block items with partial discounts

**File:** `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`

### 2a. Change `appliedDiscountItemIds` computation (lines 90-93)

Currently builds a flat list of item IDs that have ANY discount, fully blocking them. Change to track remaining quantity per item:

```typescript
// OLD (lines 90-93):
const appliedDiscountItemIds = useMemo(
  () => (discounts?.map((d) => d.orderItemId).filter(Boolean) as Id<"orderItems">[]) ?? [],
  [discounts],
);

// NEW:
const discountedQtyByItem = useMemo(() => {
  const map = new Map<string, number>();
  for (const d of discounts ?? []) {
    if (d.orderItemId) {
      map.set(d.orderItemId, (map.get(d.orderItemId) ?? 0) + d.quantityApplied);
    }
  }
  return map;
}, [discounts]);
```

### 2b. Update DiscountModal props

**File:** `apps/native/src/features/checkout/components/DiscountModal.tsx`

Change the `appliedDiscountItemIds` prop to `discountedQtyByItem: Map<string, number>`:

```typescript
// In interface DiscountModalProps, replace:
appliedDiscountItemIds: Id<"orderItems">[];
// With:
discountedQtyByItem: Map<string, number>;
```

Update `availableItems` filter (line 52):

```typescript
// OLD:
const availableItems = items.filter((item) => !appliedDiscountItemIds.includes(item._id));

// NEW:
const availableItems = items.filter((item) => {
  const discountedQty = discountedQtyByItem.get(item._id) ?? 0;
  return discountedQty < item.quantity;
});
```

### 2c. Update CheckoutScreen to pass new prop

In `CheckoutScreen.tsx`, change the `DiscountModal` usage (line 386):

```typescript
// OLD:
appliedDiscountItemIds={appliedDiscountItemIds}

// NEW:
discountedQtyByItem={discountedQtyByItem}
```

### Verification
- Item with qty=3 and 1 discount applied should still appear in the item list.
- Item with qty=1 and 1 discount applied should NOT appear.

---

## Task 3: Receipt data model — Support multiple discounts

**File:** `apps/native/src/features/shared/utils/receipt.ts`

### 3a. Extend `ReceiptDiscount` interface (lines 12-16)

```typescript
// OLD:
export interface ReceiptDiscount {
  type: "sc" | "pwd" | "custom";
  description: string;
  amount: number;
}

// NEW:
export interface ReceiptDiscount {
  type: "sc" | "pwd" | "custom";
  customerName: string;
  customerId: string;
  itemName: string;
  amount: number;
}
```

### 3b. Change `ReceiptData.discount` to `discounts` array (line 28)

```typescript
// OLD:
discount?: ReceiptDiscount;

// NEW:
discounts: ReceiptDiscount[];
```

### Verification
- TypeScript compilation should flag all usages of `data.discount` that need updating.

---

## Task 4: Receipt HTML generation — Show modifiers and per-discount lines

**File:** `apps/native/src/features/shared/utils/receipt.ts`

### 4a. Modifiers already render in HTML (lines 77-84) — No change needed

The `generateReceiptHtml` already renders modifiers as indented rows with prices. This is done.

### 4b. Update discount section in HTML (lines 97-104 and 316-325)

Replace single discount line with per-discount breakdown in the items table:

```typescript
// OLD (lines 97-104):
const discountHtml = data.discount
  ? `<tr class="discount">...</tr>`
  : "";

// NEW:
const discountsHtml = data.discounts.length > 0
  ? data.discounts.map((d) => `
    <tr class="discount">
      <td colspan="4" style="padding-top:4px;">
        ${d.type === "sc" ? "SC" : d.type === "pwd" ? "PWD" : "Discount"}: ${d.customerName}
      </td>
    </tr>
    <tr class="discount">
      <td colspan="4" style="font-size:10px;">ID: ${d.customerId}</td>
    </tr>
    <tr class="discount">
      <td colspan="3" style="font-size:10px;">${d.itemName}</td>
      <td class="right">-${formatCurrency(d.amount)}</td>
    </tr>
  `).join("")
  : "";
```

Update the totals section (lines 316-325) to use total discount amount:

```typescript
// Replace the old single discount div with:
${data.discounts.length > 0 ? `
  <div class="total-row discount">
    <span>Less: Discount</span>
    <span>-${formatCurrency(data.discounts.reduce((sum, d) => sum + d.amount, 0))}</span>
  </div>
` : ""}
```

Insert the per-discount detail rows into the items table after `${itemsHtml}`, before closing `</tbody>`:

```
${discountsHtml}
```

### Verification
- Print receipt with 2 SC discounts. Each should show name, ID, item, and amount on separate lines.

---

## Task 5: Receipt preview modal — Show modifiers and per-discount lines

**File:** `apps/native/src/features/checkout/components/ReceiptPreviewModal.tsx`

### 5a. Add modifier sub-lines under each item (lines 183-198)

Wrap each item in a container View and add modifier rows:

```tsx
{receiptData.items.map((item, index) => (
  <View key={index}>
    <View className="flex-row mb-1">
      <Text size="xs" className="flex-1" numberOfLines={1}>{item.name}</Text>
      <Text size="xs" className="w-6 text-center">{item.quantity}</Text>
      <Text size="xs" className="w-14 text-right">{formatCurrency(item.price)}</Text>
      <Text size="xs" className="w-14 text-right">{formatCurrency(item.total)}</Text>
    </View>
    {item.modifiers?.map((mod, modIndex) => (
      <View key={modIndex} className="flex-row mb-0.5 pl-3">
        <Text size="xs" variant="muted" className="flex-1">
          + {mod.optionName}
        </Text>
        {mod.priceAdjustment > 0 && (
          <Text size="xs" variant="muted" className="w-14 text-right">
            +{formatCurrency(mod.priceAdjustment)}
          </Text>
        )}
      </View>
    ))}
  </View>
))}
```

### 5b. Update discount display (lines 207-216)

Replace single discount with per-discount breakdown:

```tsx
// OLD:
{receiptData.discount && (
  <View className="flex-row justify-between mb-1">
    <Text size="xs" className="text-red-500">{receiptData.discount.description}</Text>
    <Text size="xs" className="text-red-500">-{formatCurrency(receiptData.discount.amount)}</Text>
  </View>
)}

// NEW:
{receiptData.discounts.length > 0 && (
  <>
    {receiptData.discounts.map((d, i) => (
      <View key={i} className="mb-2">
        <Text size="xs" className="text-red-500 font-medium">
          {d.type === "sc" ? "SC" : "PWD"}: {d.customerName}
        </Text>
        <Text size="xs" className="text-red-500">
          ID: {d.customerId}
        </Text>
        <View className="flex-row justify-between">
          <Text size="xs" className="text-red-500">{d.itemName}</Text>
          <Text size="xs" className="text-red-500">-{formatCurrency(d.amount)}</Text>
        </View>
      </View>
    ))}
    <View className="flex-row justify-between mb-1">
      <Text size="xs" className="text-red-500 font-medium">Total Discount</Text>
      <Text size="xs" className="text-red-500 font-medium">
        -{formatCurrency(receiptData.discounts.reduce((s, d) => s + d.amount, 0))}
      </Text>
    </View>
  </>
)}
```

### Verification
- Preview receipt with modifiers — should show indented "+ Extra Cheese  +P25.00" lines.
- Preview receipt with 2 discounts — each discount block should show name, ID, item, amount.

---

## Task 6: Wire up receipt data building in CheckoutScreen

**File:** `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`

### 6a. Update `createReceiptData` discount building (lines 180-192)

```typescript
// OLD:
const discountInfo = discounts && discounts.length > 0
  ? { type: ..., description: ..., amount: ... }
  : undefined;

// NEW:
const discountsList: ReceiptDiscount[] = (discounts ?? []).map((d) => ({
  type: d.discountType === "senior_citizen" ? ("sc" as const) : d.discountType === "pwd" ? ("pwd" as const) : ("custom" as const),
  customerName: d.customerName,
  customerId: d.customerId,
  itemName: d.itemName ?? "Order",
  amount: d.discountAmount,
}));
```

Update the return object:

```typescript
// OLD:
discount: discountInfo,

// NEW:
discounts: discountsList,
```

### 6b. Update items mapping to include modifiers (lines 206-211)

```typescript
// OLD:
items: activeItems.map((item) => ({
  name: item.productName,
  quantity: item.quantity,
  price: item.productPrice,
  total: item.lineTotal,
})),

// NEW:
items: activeItems.map((item) => ({
  name: item.productName,
  quantity: item.quantity,
  price: item.productPrice,
  total: item.lineTotal,
  modifiers: item.modifiers?.map((m) => ({
    optionName: m.optionName,
    priceAdjustment: m.priceAdjustment,
  })),
})),
```

### 6c. Remove old `customerName`/`customerId` from receipt root (lines 225-226)

These were pulling from `discounts?.[0]` only. Now the per-discount info is in the `discounts` array, so remove:

```typescript
// REMOVE these lines:
customerName: discounts?.[0]?.customerName,
customerId: discounts?.[0]?.customerId,
```

### Verification
- Build the app. No TypeScript errors.
- Complete a checkout with SC discount applied. Receipt preview and print should show the full discount detail.

---

## Task 7: Check thermal printer formatter for `discount` field usage

Search for `data.discount` or `.discount` in the thermal printer/ESC-POS formatter files. If the thermal printer store accesses `data.discount`, update it to `data.discounts`.

### Verification
- Full end-to-end: apply 2 SC discounts on different items, complete payment, preview receipt, print receipt. All should show correct per-discount details with modifiers.

---

## Execution Order

1. **Task 1** (Backend) — No dependencies
2. **Task 3** (Receipt types) — No dependencies
3. **Task 2** (DiscountModal) — Depends on Task 1 conceptually
4. **Task 4** (Receipt HTML) — Depends on Task 3
5. **Task 5** (Receipt preview) — Depends on Task 3
6. **Task 6** (Wire up) — Depends on Tasks 3, 4, 5
7. **Task 7** (Other consumers) — Depends on Task 3

Tasks 1 and 3 can run in parallel. Tasks 4 and 5 can run in parallel after Task 3.
