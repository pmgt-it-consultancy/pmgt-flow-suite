# Void Paid Orders (Refund & Re-ring) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable voiding paid orders by creating a replacement order with the remaining items, auto-settling it, and recording the refund.

**Architecture:** Extends the existing void system (`voids.ts` / `voidsHelpers.ts`) with a new `voidType: "refund"`. A new action `voidPaidOrder` handles PIN verification, voids the original paid order, clones remaining items/modifiers/discounts into a new auto-settled order, and records the refund details. Native and web UIs get a "Refund Item" flow on paid order detail screens.

**Tech Stack:** Convex (backend mutations/actions), React Native + Tamagui (native UI), Next.js + Radix UI (web admin)

**Spec:** `docs/superpowers/specs/2026-03-28-void-paid-orders-design.md`

---

## File Structure

### Backend (packages/backend/convex/)

| File | Action | Responsibility |
|------|--------|----------------|
| `schema.ts` | Modify | Add `refund` to `orderVoids.voidType`, add `refundMethod` + `replacementOrderId` to `orderVoids`, add `refundedFromOrderId` to `orders` |
| `helpers/voidsHelpers.ts` | Modify | Add `voidPaidOrderInternal` internalMutation — the core re-ring logic |
| `voids.ts` | Modify | Add `voidPaidOrder` action with PIN verification, update `getOrderVoids` return type for `refund` |
| `orders.ts` | Modify | Update `orders.get` return type to include `refund` void type and `refundedFromOrderId` |

### Native App (apps/native/src/)

| File | Action | Responsibility |
|------|--------|----------------|
| `features/order-history/screens/OrderDetailScreen.tsx` | Modify | Add "Refund Item" button for paid orders, integrate RefundItemModal |
| `features/order-history/components/RefundItemModal.tsx` | Create | Modal for selecting items to refund, entering reason, choosing refund method |

### Web Admin (apps/web/src/)

| File | Action | Responsibility |
|------|--------|----------------|
| `app/(admin)/orders/page.tsx` | Modify | Add refund flow to order detail dialog for paid orders, show "Refund" badge on voided-via-refund orders |
| `app/(admin)/orders/_components/RefundItemDialog.tsx` | Create | Dialog for selecting items, reason, refund method |
| `app/(admin)/orders/_components/index.ts` | Modify | Export new component |

---

## Chunk 1: Backend — Schema & Core Logic

### Task 1: Update schema for refund void type

**Files:**
- Modify: `packages/backend/convex/schema.ts:263-274` (orderVoids table)
- Modify: `packages/backend/convex/schema.ts:162-219` (orders table)

- [ ] **Step 1: Add `refund` to `orderVoids.voidType` union and add refund fields**

In `packages/backend/convex/schema.ts`, update the `orderVoids` table definition:

```typescript
orderVoids: defineTable({
  orderId: v.id("orders"),
  voidType: v.union(v.literal("full_order"), v.literal("item"), v.literal("refund")),
  orderItemId: v.optional(v.id("orderItems")),
  reason: v.string(),
  approvedBy: v.id("users"),
  requestedBy: v.id("users"),
  amount: v.number(),
  createdAt: v.number(),
  // Refund-specific fields
  refundMethod: v.optional(v.union(v.literal("cash"), v.literal("card_ewallet"))),
  replacementOrderId: v.optional(v.id("orders")),
})
  .index("by_order", ["orderId"])
  .index("by_createdAt", ["createdAt"]),
```

- [ ] **Step 2: Add `refundedFromOrderId` to orders table**

In the `orders` table definition, add after the `requestId` field:

```typescript
refundedFromOrderId: v.optional(v.id("orders")), // Points back to voided original
```

- [ ] **Step 3: Run typecheck to verify schema changes**

Run: `cd packages/backend && pnpm exec convex dev --once 2>&1 | head -30` or `pnpm typecheck`
Expected: No type errors from schema changes

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add refund void type and refundedFromOrderId to schema"
```

---

### Task 2: Implement `voidPaidOrderInternal` mutation

**Files:**
- Modify: `packages/backend/convex/helpers/voidsHelpers.ts`

This is the core re-ring logic. It must:
1. Validate the order is `paid`
2. Identify items to keep (not in the refund list)
3. Void the original order
4. Create a new order with remaining items (if any)
5. Copy modifiers for kept items
6. Reapply discounts
7. Recalculate tax totals
8. Auto-settle the new order with payment records
9. Record the void/refund

- [ ] **Step 1: Add the `voidPaidOrderInternal` internalMutation**

At the end of `packages/backend/convex/helpers/voidsHelpers.ts`, add:

```typescript
// Internal mutation to void a paid order and create replacement with remaining items
export const voidPaidOrderInternal = internalMutation({
  args: {
    orderId: v.id("orders"),
    refundedItemIds: v.array(v.id("orderItems")),
    reason: v.string(),
    refundMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
    requestedBy: v.id("users"),
    approvedBy: v.id("users"),
  },
  returns: v.object({
    voidId: v.id("orderVoids"),
    replacementOrderId: v.optional(v.id("orders")),
    refundAmount: v.number(),
  }),
  handler: async (ctx, args) => {
    const { calculateItemTotals, aggregateOrderTotals } = await import("../lib/taxCalculations");
    const { getPHTDayBoundaries } = await import("../lib/dateUtils");

    // 1. Get and validate order
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "paid") throw new Error("Can only refund paid orders");

    // 2. Get all items for this order
    const allItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q: any) => q.eq("orderId", args.orderId))
      .collect();

    const activeItems = allItems.filter((i: any) => !i.isVoided);

    // Validate refunded item IDs
    const refundedIdSet = new Set(args.refundedItemIds.map((id) => id.toString()));
    for (const itemId of args.refundedItemIds) {
      const item = activeItems.find((i: any) => i._id.toString() === itemId.toString());
      if (!item) throw new Error(`Item ${itemId} not found or already voided`);
    }

    const remainingItems = activeItems.filter(
      (i: any) => !refundedIdSet.has(i._id.toString()),
    );

    const now = Date.now();
    let replacementOrderId: Id<"orders"> | undefined;
    let refundAmount: number;

    if (remainingItems.length === 0) {
      // All items refunded — full refund, no replacement order
      refundAmount = order.netSales;
    } else {
      // Partial refund — create replacement order

      // Get store for VAT rate
      const store = await ctx.db.get(order.storeId);
      const vatRate = store?.vatRate ?? 0.12;

      // Generate new order number
      const prefix = order.orderType === "dine_in" ? "D" : "T";
      const { startOfDay, endOfDay } = getPHTDayBoundaries();
      const todaysOrders = await ctx.db
        .query("orders")
        .withIndex("by_store_createdAt", (q: any) =>
          q.eq("storeId", order.storeId).gte("createdAt", startOfDay),
        )
        .filter((q: any) =>
          q.and(
            q.lt(q.field("createdAt"), endOfDay),
            q.eq(q.field("orderType"), order.orderType),
          ),
        )
        .collect();

      let maxNumber = 0;
      for (const o of todaysOrders) {
        const match = o.orderNumber?.match(/\d+$/);
        if (match) {
          maxNumber = Math.max(maxNumber, Number.parseInt(match[0], 10));
        }
      }
      const orderNumber = `${prefix}-${(maxNumber + 1).toString().padStart(3, "0")}`;

      // Create new order (initially with zero totals, will be recalculated)
      replacementOrderId = await ctx.db.insert("orders", {
        storeId: order.storeId,
        orderNumber,
        orderType: order.orderType,
        orderChannel: order.orderChannel,
        tableId: order.tableId,
        customerName: order.customerName,
        orderCategory: order.orderCategory,
        tableMarker: order.tableMarker,
        pax: order.pax,
        status: "paid",
        grossSales: 0,
        vatableSales: 0,
        vatAmount: 0,
        vatExemptSales: 0,
        nonVatSales: 0,
        discountAmount: 0,
        netSales: 0,
        createdBy: args.approvedBy,
        createdAt: now,
        paidAt: now,
        paidBy: args.approvedBy,
        refundedFromOrderId: args.orderId,
      });

      // Copy remaining items and their modifiers
      const oldItemToNewItem = new Map<string, Id<"orderItems">>();

      for (const item of remainingItems) {
        const newItemId = await ctx.db.insert("orderItems", {
          orderId: replacementOrderId,
          productId: item.productId,
          productName: item.productName,
          productPrice: item.productPrice,
          quantity: item.quantity,
          notes: item.notes,
          isVoided: false,
          isSentToKitchen: item.isSentToKitchen,
        });
        oldItemToNewItem.set(item._id.toString(), newItemId);

        // Copy modifiers
        const modifiers = await ctx.db
          .query("orderItemModifiers")
          .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item._id))
          .collect();

        for (const mod of modifiers) {
          await ctx.db.insert("orderItemModifiers", {
            orderItemId: newItemId,
            modifierGroupName: mod.modifierGroupName,
            modifierOptionName: mod.modifierOptionName,
            priceAdjustment: mod.priceAdjustment,
          });
        }
      }

      // Copy applicable discounts (only for items that were kept)
      const originalDiscounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_order", (q: any) => q.eq("orderId", args.orderId))
        .collect();

      for (const discount of originalDiscounts) {
        if (discount.orderItemId) {
          // Item-level discount — only copy if item was kept
          const newItemId = oldItemToNewItem.get(discount.orderItemId.toString());
          if (newItemId) {
            await ctx.db.insert("orderDiscounts", {
              orderId: replacementOrderId,
              orderItemId: newItemId,
              discountType: discount.discountType,
              customerName: discount.customerName,
              customerId: discount.customerId,
              quantityApplied: discount.quantityApplied,
              discountAmount: discount.discountAmount,
              vatExemptAmount: discount.vatExemptAmount,
              approvedBy: discount.approvedBy,
              createdAt: now,
            });
          }
        } else {
          // Order-level discount — copy as-is
          await ctx.db.insert("orderDiscounts", {
            orderId: replacementOrderId,
            orderItemId: undefined,
            discountType: discount.discountType,
            customerName: discount.customerName,
            customerId: discount.customerId,
            quantityApplied: discount.quantityApplied,
            discountAmount: discount.discountAmount,
            vatExemptAmount: discount.vatExemptAmount,
            approvedBy: discount.approvedBy,
            createdAt: now,
          });
        }
      }

      // Recalculate new order totals (reuses discount recalculation logic)
      // Get all new items and discounts to compute proper totals
      const newItems = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (q: any) => q.eq("orderId", replacementOrderId))
        .collect();

      const newDiscounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_order", (q: any) => q.eq("orderId", replacementOrderId))
        .collect();

      const itemDiscountQty = new Map<string, number>();
      let orderLevelDiscountAmount = 0;

      for (const discount of newDiscounts) {
        if (discount.orderItemId) {
          const current = itemDiscountQty.get(discount.orderItemId.toString()) ?? 0;
          itemDiscountQty.set(
            discount.orderItemId.toString(),
            current + discount.quantityApplied,
          );
        } else {
          orderLevelDiscountAmount += discount.discountAmount;
        }
      }

      const itemCalculations = await Promise.all(
        newItems.map(async (item: any) => {
          const product = await ctx.db.get(item.productId);
          const isVatable = product?.isVatable ?? true;

          const modifiers = await ctx.db
            .query("orderItemModifiers")
            .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item._id))
            .collect();
          const modifierTotal = modifiers.reduce(
            (sum: number, m: any) => sum + m.priceAdjustment,
            0,
          );
          const effectivePrice = item.productPrice + modifierTotal;
          const scPwdQuantity = itemDiscountQty.get(item._id.toString()) ?? 0;

          return calculateItemTotals(
            effectivePrice,
            item.quantity,
            isVatable,
            scPwdQuantity,
            vatRate,
          );
        }),
      );

      const totals = aggregateOrderTotals(itemCalculations);
      const netSales = totals.netSales - orderLevelDiscountAmount;
      const totalDiscountAmount = totals.discountAmount + orderLevelDiscountAmount;

      await ctx.db.patch(replacementOrderId, {
        grossSales: totals.grossSales,
        vatableSales: totals.vatableSales,
        vatAmount: totals.vatAmount,
        vatExemptSales: totals.vatExemptSales,
        nonVatSales: totals.nonVatSales,
        discountAmount: totalDiscountAmount,
        netSales: netSales,
      });

      // Create payment record for the new order
      await ctx.db.insert("orderPayments", {
        orderId: replacementOrderId,
        storeId: order.storeId,
        paymentMethod: "cash", // Auto-settled, payment method is nominal
        amount: netSales,
        createdAt: now,
        createdBy: args.approvedBy,
      });

      // Refund amount = original netSales - new netSales
      refundAmount = order.netSales - netSales;
    }

    // Void the original order
    await ctx.db.patch(args.orderId, {
      status: "voided",
      ...(order.orderType === "takeout" ? { takeoutStatus: "cancelled" } : {}),
    });

    // Create void record
    const voidId = await ctx.db.insert("orderVoids", {
      orderId: args.orderId,
      voidType: "refund",
      orderItemId: undefined,
      reason: args.reason,
      approvedBy: args.approvedBy,
      requestedBy: args.requestedBy,
      amount: refundAmount,
      createdAt: now,
      refundMethod: args.refundMethod,
      replacementOrderId,
    });

    // Audit log
    const refundedItems = activeItems.filter((i: any) =>
      refundedIdSet.has(i._id.toString()),
    );
    await ctx.db.insert("auditLogs", {
      storeId: order.storeId,
      action: "refund_order",
      entityType: "order",
      entityId: args.orderId,
      details: JSON.stringify({
        orderNumber: order.orderNumber,
        refundedItems: refundedItems.map((i: any) => ({
          name: i.productName,
          quantity: i.quantity,
          price: i.productPrice,
        })),
        refundAmount,
        refundMethod: args.refundMethod,
        replacementOrderId,
        replacementOrderNumber: replacementOrderId ? undefined : null, // Will be set after
        reason: args.reason,
      }),
      userId: args.approvedBy,
      createdAt: now,
    });

    return { voidId, replacementOrderId, refundAmount };
  },
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/helpers/voidsHelpers.ts
git commit -m "feat(backend): add voidPaidOrderInternal mutation for refund re-ring"
```

---

### Task 3: Add `voidPaidOrder` action with PIN verification

**Files:**
- Modify: `packages/backend/convex/voids.ts`

- [ ] **Step 1: Add `VoidPaidOrderResult` type and the action**

At the top of `voids.ts`, add a new result type after the existing ones:

```typescript
type VoidPaidOrderResult =
  | {
      success: true;
      voidId: Id<"orderVoids">;
      replacementOrderId?: Id<"orders">;
      refundAmount: number;
    }
  | { success: false; error: string };
```

Before the `getOrderVoids` action, add the new action:

```typescript
// Action: Void a paid order (refund & re-ring) with PIN verification
export const voidPaidOrder = action({
  args: {
    orderId: v.id("orders"),
    refundedItemIds: v.array(v.id("orderItems")),
    reason: v.string(),
    refundMethod: v.union(v.literal("cash"), v.literal("card_ewallet")),
    managerId: v.id("users"),
    managerPin: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      voidId: v.id("orderVoids"),
      replacementOrderId: v.optional(v.id("orders")),
      refundAmount: v.number(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<VoidPaidOrderResult> => {
    // Get authenticated user
    const requesterId = await ctx.runQuery(
      internal.helpers.voidsHelpers.getAuthenticatedUserId,
      {},
    );
    if (!requesterId) {
      return { success: false as const, error: "Authentication required" };
    }

    // Verify manager PIN
    const manager = await ctx.runQuery(internal.helpers.voidsHelpers.getManagerWithPin, {
      managerId: args.managerId,
    });
    if (!manager || !manager.isActive) {
      return { success: false as const, error: "Manager not found or inactive" };
    }
    if (!manager.pin) {
      return { success: false as const, error: "Manager PIN not set" };
    }

    const pinValid = await bcrypt.compare(args.managerPin, manager.pin);
    if (!pinValid) {
      return { success: false as const, error: "Invalid manager PIN" };
    }

    // Validate at least one item selected
    if (args.refundedItemIds.length === 0) {
      return { success: false as const, error: "No items selected for refund" };
    }

    // Perform refund
    try {
      const result = await ctx.runMutation(
        internal.helpers.voidsHelpers.voidPaidOrderInternal,
        {
          orderId: args.orderId,
          refundedItemIds: args.refundedItemIds,
          reason: args.reason,
          refundMethod: args.refundMethod,
          requestedBy: requesterId,
          approvedBy: args.managerId,
        },
      );

      return {
        success: true as const,
        voidId: result.voidId,
        replacementOrderId: result.replacementOrderId,
        refundAmount: result.refundAmount,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to process refund",
      };
    }
  },
});
```

- [ ] **Step 2: Update `getOrderVoids` return type to include `refund`**

In the `getOrderVoids` action and the `OrderVoidRecord` type, update the `voidType` to include `"refund"`:

Update the `OrderVoidRecord` type:
```typescript
type OrderVoidRecord = {
  _id: Id<"orderVoids">;
  voidType: "full_order" | "item" | "refund";
  orderItemId?: Id<"orderItems">;
  reason: string;
  amount: number;
  approvedByName: string;
  requestedByName: string;
  createdAt: number;
};
```

Update the `getOrderVoids` return validator:
```typescript
voidType: v.union(v.literal("full_order"), v.literal("item"), v.literal("refund")),
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/voids.ts
git commit -m "feat(backend): add voidPaidOrder action with PIN verification"
```

---

### Task 4: Update `orders.get` query return type

**Files:**
- Modify: `packages/backend/convex/orders.ts:379-578`

The `orders.get` query returns void records in the `voids` array. The `voidType` validator needs updating to include `"refund"`. Also add `refundedFromOrderId` to the return type.

- [ ] **Step 1: Update the `voids` array validator in `orders.get` return type**

In the return type of `orders.get` (around line 465-476), update:

```typescript
voids: v.array(
  v.object({
    _id: v.id("orderVoids"),
    voidType: v.union(v.literal("full_order"), v.literal("item"), v.literal("refund")),
    orderItemId: v.optional(v.id("orderItems")),
    reason: v.string(),
    amount: v.number(),
    approvedByName: v.string(),
    requestedByName: v.string(),
    createdAt: v.number(),
  }),
),
```

- [ ] **Step 2: Add `refundedFromOrderId` to the return type**

After `tableMarker` in the return type, add:

```typescript
refundedFromOrderId: v.optional(v.id("orders")),
```

And in the return object of the handler (around line 578), add:

```typescript
refundedFromOrderId: order.refundedFromOrderId,
```

- [ ] **Step 3: Also update the `getOrderVoidsInternal` return validator in voidsHelpers.ts**

In `packages/backend/convex/helpers/voidsHelpers.ts`, update `getOrderVoidsInternal` return type:

```typescript
voidType: v.union(v.literal("full_order"), v.literal("item"), v.literal("refund")),
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts packages/backend/convex/helpers/voidsHelpers.ts
git commit -m "feat(backend): update orders.get and voids query for refund type"
```

---

## Chunk 2: Native App — Refund Item UI

### Task 5: Create RefundItemModal component

**Files:**
- Create: `apps/native/src/features/order-history/components/RefundItemModal.tsx`

This modal allows staff to:
1. See the list of active items with checkboxes to select which to refund
2. Enter a reason
3. Select refund method (cash or card)
4. Confirm

Follow the existing modal patterns from `VoidItemModal.tsx` and the UI guidelines in CLAUDE.md.

- [ ] **Step 1: Create the RefundItemModal component**

```tsx
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useState } from "react";
import { ScrollView, TextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface OrderItem {
  _id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
}

interface RefundItemModalProps {
  visible: boolean;
  items: OrderItem[];
  onConfirm: (
    refundedItemIds: Id<"orderItems">[],
    reason: string,
    refundMethod: "cash" | "card_ewallet",
  ) => Promise<void>;
  onClose: () => void;
}

export const RefundItemModal = ({
  visible,
  items,
  onConfirm,
  onClose,
}: RefundItemModalProps) => {
  const formatCurrency = useFormatCurrency();
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card_ewallet">("cash");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const refundTotal = items
    .filter((i) => selectedItemIds.has(i._id.toString()))
    .reduce((sum, i) => sum + i.lineTotal, 0);

  const canSubmit = selectedItemIds.size > 0 && reason.trim().length > 0 && !isSubmitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const ids = Array.from(selectedItemIds).map((id) => id as Id<"orderItems">);
      await onConfirm(ids, reason.trim(), refundMethod);
      handleReset();
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedItemIds(new Set());
    setReason("");
    setRefundMethod("cash");
    setIsSubmitting(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  return (
    <Modal visible={visible} onClose={handleClose} title="Refund Items" position="bottom">
      <YStack gap={16}>
        {/* Item selection */}
        <YStack>
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Select items to refund
          </Text>
          <ScrollView style={{ maxHeight: 250 }}>
            {items.map((item) => {
              const isSelected = selectedItemIds.has(item._id.toString());
              return (
                <TouchableOpacity
                  key={item._id}
                  onPress={() => toggleItem(item._id.toString())}
                  activeOpacity={0.7}
                  style={{ minHeight: 52 }}
                >
                  <XStack
                    paddingVertical={12}
                    paddingHorizontal={12}
                    borderRadius={10}
                    backgroundColor={isSelected ? "#DBEAFE" : "#F9FAFB"}
                    borderWidth={1}
                    borderColor={isSelected ? "#0D87E1" : "#E5E7EB"}
                    marginBottom={8}
                    alignItems="center"
                    gap={12}
                  >
                    <YStack
                      width={24}
                      height={24}
                      borderRadius={6}
                      borderWidth={2}
                      borderColor={isSelected ? "#0D87E1" : "#D1D5DB"}
                      backgroundColor={isSelected ? "#0D87E1" : "transparent"}
                      justifyContent="center"
                      alignItems="center"
                    >
                      {isSelected && (
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                      )}
                    </YStack>
                    <YStack flex={1}>
                      <Text style={{ color: "#111827", fontSize: 15, fontWeight: "500" }}>
                        {item.quantity}x {item.productName}
                      </Text>
                    </YStack>
                    <Text style={{ color: "#111827", fontWeight: "600", fontSize: 14 }}>
                      {formatCurrency(item.lineTotal)}
                    </Text>
                  </XStack>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </YStack>

        {/* Reason */}
        <YStack>
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Reason for refund
          </Text>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: "#E5E7EB",
              borderRadius: 10,
              padding: 12,
              fontSize: 15,
              color: "#111827",
              minHeight: 70,
            }}
            placeholder="Enter reason..."
            placeholderTextColor="#9CA3AF"
            value={reason}
            onChangeText={setReason}
            multiline
            textAlignVertical="top"
          />
        </YStack>

        {/* Refund method */}
        <YStack>
          <Text
            style={{
              color: "#6B7280",
              fontWeight: "600",
              fontSize: 12,
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Refund method
          </Text>
          <XStack gap={10}>
            <TouchableOpacity
              onPress={() => setRefundMethod("cash")}
              style={{ flex: 1, minHeight: 48 }}
              activeOpacity={0.7}
            >
              <XStack
                flex={1}
                paddingVertical={12}
                borderRadius={10}
                borderWidth={1.5}
                borderColor={refundMethod === "cash" ? "#0D87E1" : "#E5E7EB"}
                backgroundColor={refundMethod === "cash" ? "#DBEAFE" : "#F9FAFB"}
                justifyContent="center"
                alignItems="center"
                gap={8}
              >
                <Ionicons
                  name="cash-outline"
                  size={20}
                  color={refundMethod === "cash" ? "#0D87E1" : "#6B7280"}
                />
                <Text
                  style={{
                    fontWeight: "600",
                    fontSize: 14,
                    color: refundMethod === "cash" ? "#0D87E1" : "#374151",
                  }}
                >
                  Cash
                </Text>
              </XStack>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setRefundMethod("card_ewallet")}
              style={{ flex: 1, minHeight: 48 }}
              activeOpacity={0.7}
            >
              <XStack
                flex={1}
                paddingVertical={12}
                borderRadius={10}
                borderWidth={1.5}
                borderColor={refundMethod === "card_ewallet" ? "#0D87E1" : "#E5E7EB"}
                backgroundColor={refundMethod === "card_ewallet" ? "#DBEAFE" : "#F9FAFB"}
                justifyContent="center"
                alignItems="center"
                gap={8}
              >
                <Ionicons
                  name="card-outline"
                  size={20}
                  color={refundMethod === "card_ewallet" ? "#0D87E1" : "#6B7280"}
                />
                <Text
                  style={{
                    fontWeight: "600",
                    fontSize: 14,
                    color: refundMethod === "card_ewallet" ? "#0D87E1" : "#374151",
                  }}
                >
                  Card / E-Wallet
                </Text>
              </XStack>
            </TouchableOpacity>
          </XStack>
        </YStack>

        {/* Refund summary */}
        {selectedItemIds.size > 0 && (
          <XStack
            backgroundColor="#FEF2F2"
            borderRadius={10}
            padding={14}
            justifyContent="space-between"
            alignItems="center"
          >
            <Text style={{ color: "#DC2626", fontWeight: "500", fontSize: 14 }}>
              Refund Amount ({selectedItemIds.size} item{selectedItemIds.size > 1 ? "s" : ""})
            </Text>
            <Text style={{ color: "#DC2626", fontWeight: "700", fontSize: 18 }}>
              {formatCurrency(refundTotal)}
            </Text>
          </XStack>
        )}

        {/* Actions */}
        <XStack gap={12}>
          <YStack flex={1}>
            <Button variant="outline" size="lg" onPress={handleClose}>
              <Text style={{ color: "#374151", fontWeight: "500" }}>Cancel</Text>
            </Button>
          </YStack>
          <YStack flex={1}>
            <Button
              variant="destructive"
              size="lg"
              disabled={!canSubmit}
              onPress={handleConfirm}
              loading={isSubmitting}
              style={!canSubmit ? { opacity: 0.4 } : undefined}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "500" }}>Continue</Text>
            </Button>
          </YStack>
        </XStack>
      </YStack>
    </Modal>
  );
};
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/order-history/components/RefundItemModal.tsx
git commit -m "feat(native): add RefundItemModal component for paid order refunds"
```

---

### Task 6: Integrate refund flow into OrderDetailScreen

**Files:**
- Modify: `apps/native/src/features/order-history/screens/OrderDetailScreen.tsx`

Add the "Refund Item" button for paid orders and wire it to the RefundItemModal + ManagerPinModal flow.

- [ ] **Step 1: Add imports and state for refund flow**

Add to imports:
```typescript
import { RefundItemModal } from "../components/RefundItemModal";
```

Add to state variables (after `showVoidReasonModal`):
```typescript
const [showRefundModal, setShowRefundModal] = useState(false);
const [refundData, setRefundData] = useState<{
  itemIds: Id<"orderItems">[];
  reason: string;
  refundMethod: "cash" | "card_ewallet";
} | null>(null);
const [showRefundPinModal, setShowRefundPinModal] = useState(false);
```

Add the action hook:
```typescript
const voidPaidOrderAction = useAction(api.voids.voidPaidOrder);
```

- [ ] **Step 2: Add refund handlers**

After `handleManagerPinSuccess`, add:

```typescript
const handleRefundConfirm = useCallback(
  async (
    itemIds: Id<"orderItems">[],
    reason: string,
    refundMethod: "cash" | "card_ewallet",
  ) => {
    setRefundData({ itemIds, reason, refundMethod });
    setShowRefundModal(false);
    setShowRefundPinModal(true);
  },
  [],
);

const handleRefundPinSuccess = useCallback(
  async (managerId: Id<"users">, pin: string) => {
    if (!refundData) return;
    setShowRefundPinModal(false);
    try {
      const result = await voidPaidOrderAction({
        orderId,
        refundedItemIds: refundData.itemIds,
        reason: refundData.reason,
        refundMethod: refundData.refundMethod,
        managerId,
        managerPin: pin,
      });

      if (result.success) {
        const successResult = result as {
          success: true;
          refundAmount: number;
          replacementOrderId?: Id<"orders">;
        };
        Alert.alert(
          "Refund Processed",
          `Refund of ${formatCurrency(successResult.refundAmount)} has been processed.${
            successResult.replacementOrderId
              ? " A new order has been created with the remaining items."
              : ""
          }`,
          [{ text: "OK", onPress: () => navigation.goBack() }],
        );
      } else {
        const errorResult = result as { success: false; error: string };
        Alert.alert("Error", errorResult.error);
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to process refund");
    } finally {
      setRefundData(null);
    }
  },
  [voidPaidOrderAction, orderId, refundData, formatCurrency, navigation],
);
```

- [ ] **Step 3: Add "Refund Item" button to the actions bar**

Replace the existing paid actions section (the `{isPaid ? (` block around lines 422-453) with:

```tsx
{isPaid ? (
  <XStack
    padding={16}
    backgroundColor="#FFFFFF"
    borderTopWidth={1}
    borderColor="#E5E7EB"
    gap={12}
  >
    <Button
      variant="primary"
      size="lg"
      style={{ flex: 1 }}
      loading={isReprinting}
      disabled={isReprinting}
      onPress={handleReprint}
    >
      <XStack alignItems="center">
        <Ionicons name="print-outline" size={20} color="#FFF" />
        <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
          Reprint
        </Text>
      </XStack>
    </Button>

    <Button
      variant="outline"
      size="lg"
      style={{ flex: 1 }}
      onPress={() => setShowRefundModal(true)}
    >
      <XStack alignItems="center">
        <Ionicons name="return-down-back-outline" size={20} color="#0D87E1" />
        <Text style={{ color: "#0D87E1", fontWeight: "600", marginLeft: 8 }}>
          Refund Item
        </Text>
      </XStack>
    </Button>

    <Button variant="destructive" size="lg" style={{ flex: 1 }} onPress={handleVoidPress}>
      <XStack alignItems="center">
        <Ionicons name="close-circle-outline" size={20} color="#FFF" />
        <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>Void</Text>
      </XStack>
    </Button>
  </XStack>
) : null}
```

- [ ] **Step 4: Add RefundItemModal and refund ManagerPinModal to the JSX**

After the existing Manager PIN Modal (before `</YStack>`), add:

```tsx
{/* Refund Item Modal */}
<RefundItemModal
  visible={showRefundModal}
  items={activeItems.map((i) => ({
    _id: i._id,
    productName: i.productName,
    productPrice: i.productPrice,
    quantity: i.quantity,
    lineTotal: i.lineTotal,
  }))}
  onConfirm={handleRefundConfirm}
  onClose={() => setShowRefundModal(false)}
/>

{/* Refund Manager PIN Modal */}
<ManagerPinModal
  visible={showRefundPinModal}
  title="Approve Refund"
  description="Manager PIN required to process this refund"
  onClose={() => {
    setShowRefundPinModal(false);
    setRefundData(null);
  }}
  onSuccess={handleRefundPinSuccess}
/>
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/order-history/screens/OrderDetailScreen.tsx
git commit -m "feat(native): integrate refund flow into OrderDetailScreen"
```

---

## Chunk 3: Web Admin — Refund Item UI

### Task 7: Create RefundItemDialog component

**Files:**
- Create: `apps/web/src/app/(admin)/orders/_components/RefundItemDialog.tsx`
- Modify: `apps/web/src/app/(admin)/orders/_components/index.ts`

- [ ] **Step 1: Create RefundItemDialog**

```tsx
"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";

interface OrderItem {
  _id: Id<"orderItems">;
  productName: string;
  productPrice: number;
  quantity: number;
  lineTotal: number;
  isVoided: boolean;
}

interface RefundItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OrderItem[];
  onConfirm: (
    refundedItemIds: Id<"orderItems">[],
    reason: string,
    refundMethod: "cash" | "card_ewallet",
  ) => void;
}

export function RefundItemDialog({
  open,
  onOpenChange,
  items,
  onConfirm,
}: RefundItemDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card_ewallet">("cash");

  const activeItems = items.filter((i) => !i.isVoided);

  const toggleItem = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const refundTotal = activeItems
    .filter((i) => selectedIds.has(i._id.toString()))
    .reduce((sum, i) => sum + i.lineTotal, 0);

  const canSubmit = selectedIds.size > 0 && reason.trim().length > 0;

  const handleConfirm = () => {
    if (!canSubmit) return;
    const ids = Array.from(selectedIds).map((id) => id as Id<"orderItems">);
    onConfirm(ids, reason.trim(), refundMethod);
    handleReset();
  };

  const handleReset = () => {
    setSelectedIds(new Set());
    setReason("");
    setRefundMethod("cash");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleReset();
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refund Items</DialogTitle>
          <DialogDescription>
            Select items to remove from this order. A new order will be created with the
            remaining items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Item selection */}
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {activeItems.map((item) => (
              <label
                key={item._id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedIds.has(item._id.toString())
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <Checkbox
                  checked={selectedIds.has(item._id.toString())}
                  onCheckedChange={() => toggleItem(item._id.toString())}
                />
                <span className="flex-1 text-sm font-medium">
                  {item.quantity}x {item.productName}
                </span>
                <span className="text-sm font-semibold">{formatCurrency(item.lineTotal)}</span>
              </label>
            ))}
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label>Reason for refund</Label>
            <Textarea
              placeholder="Enter reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          {/* Refund method */}
          <div className="space-y-2">
            <Label>Refund method</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={refundMethod === "cash" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setRefundMethod("cash")}
              >
                Cash
              </Button>
              <Button
                type="button"
                variant={refundMethod === "card_ewallet" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setRefundMethod("card_ewallet")}
              >
                Card / E-Wallet
              </Button>
            </div>
          </div>

          {/* Refund total */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-200">
              <span className="text-sm font-medium text-red-800">
                Refund Amount ({selectedIds.size} item{selectedIds.size > 1 ? "s" : ""})
              </span>
              <span className="text-lg font-bold text-red-800">
                {formatCurrency(refundTotal)}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={handleConfirm}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Export from barrel file**

In `apps/web/src/app/(admin)/orders/_components/index.ts`, add:

```typescript
export { RefundItemDialog } from "./RefundItemDialog";
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(admin)/orders/_components/RefundItemDialog.tsx apps/web/src/app/(admin)/orders/_components/index.ts
git commit -m "feat(web): add RefundItemDialog component"
```

---

### Task 8: Integrate refund flow into orders page

**Files:**
- Modify: `apps/web/src/app/(admin)/orders/page.tsx`

- [ ] **Step 1: Add imports and state**

Add to imports:
```typescript
import { useAction } from "convex/react";
import { RefundItemDialog, ManagerPinDialog } from "./_components";
```

(Note: `ManagerPinDialog` is already imported. `useAction` needs to be added to the convex/react import.)

Add state variables inside `OrdersPage`:
```typescript
const [showRefundDialog, setShowRefundDialog] = useState(false);
const [refundOrderId, setRefundOrderId] = useState<Id<"orders"> | null>(null);
const [refundData, setRefundData] = useState<{
  itemIds: Id<"orderItems">[];
  reason: string;
  refundMethod: "cash" | "card_ewallet";
} | null>(null);
const [showRefundPinDialog, setShowRefundPinDialog] = useState(false);
const [isRefunding, setIsRefunding] = useState(false);

const voidPaidOrderAction = useAction(api.voids.voidPaidOrder);
```

- [ ] **Step 2: Add refund handlers**

```typescript
const handleRefundClick = (orderId: Id<"orders">) => {
  setRefundOrderId(orderId);
  setShowRefundDialog(true);
};

const handleRefundConfirm = (
  itemIds: Id<"orderItems">[],
  reason: string,
  refundMethod: "cash" | "card_ewallet",
) => {
  setRefundData({ itemIds, reason, refundMethod });
  setShowRefundDialog(false);
  setShowRefundPinDialog(true);
};

const handleRefundPinSubmit = async (managerId: Id<"users">, pin: string) => {
  if (!refundData || !refundOrderId) return;
  setIsRefunding(true);
  try {
    const result = await voidPaidOrderAction({
      orderId: refundOrderId,
      refundedItemIds: refundData.itemIds,
      reason: refundData.reason,
      refundMethod: refundData.refundMethod,
      managerId,
      managerPin: pin,
    });

    if (result.success) {
      setShowRefundPinDialog(false);
      setSelectedOrderId(null);
      setRefundOrderId(null);
      setRefundData(null);
      // Could add a toast here
    } else {
      const errorResult = result as { success: false; error: string };
      alert(errorResult.error);
    }
  } catch (error: any) {
    alert(error.message || "Failed to process refund");
  } finally {
    setIsRefunding(false);
  }
};
```

- [ ] **Step 3: Add "Refund Item" button to order detail dialog**

Inside the order detail dialog, after the Payment Info section and before the closing `</div>` of the dialog content, add a refund button for paid orders:

```tsx
{/* Refund action for paid orders */}
{orderDetails?.status === "paid" && (
  <Button
    variant="destructive"
    className="w-full"
    onClick={() => handleRefundClick(orderDetails._id)}
  >
    Refund Item
  </Button>
)}
```

- [ ] **Step 4: Add "Refund" badge for voided orders with refund voids**

Update the `getStatusBadge` function to show a "Refund" badge when the order was voided via refund:

```typescript
const getStatusBadge = (status: string, voids?: Array<{ voidType: string }>) => {
  if (status === "voided" && voids?.some((v) => v.voidType === "refund")) {
    return <Badge variant="destructive">Refund</Badge>;
  }
  switch (status) {
    case "open":
      return <Badge variant="secondary">Open</Badge>;
    case "paid":
      return <Badge variant="default">Paid</Badge>;
    case "voided":
      return <Badge variant="destructive">Voided</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};
```

Note: The orders list from `api.orders.list` doesn't include voids, so the badge on the table rows will still show "Voided". The "Refund" badge will only show in the detail dialog where `orderDetails.voids` is available. Update the dialog title badge:

```tsx
{orderDetails && getStatusBadge(orderDetails.status, orderDetails.voids)}
```

- [ ] **Step 5: Add the RefundItemDialog and refund ManagerPinDialog to JSX**

After the existing Order Details Dialog, add:

```tsx
{/* Refund Item Dialog */}
{orderDetails && (
  <RefundItemDialog
    open={showRefundDialog}
    onOpenChange={setShowRefundDialog}
    items={orderDetails.items.map((i) => ({
      _id: i._id,
      productName: i.productName,
      productPrice: i.productPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
      isVoided: i.isVoided,
    }))}
    onConfirm={handleRefundConfirm}
  />
)}

{/* Refund Manager PIN Dialog */}
{selectedStoreId && (
  <ManagerPinDialog
    open={showRefundPinDialog}
    onOpenChange={(open) => {
      setShowRefundPinDialog(open);
      if (!open) setRefundData(null);
    }}
    storeId={selectedStoreId}
    onSubmit={handleRefundPinSubmit}
    isSubmitting={isRefunding}
  />
)}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/(admin)/orders/page.tsx
git commit -m "feat(web): integrate refund flow into orders admin page"
```

---

## Chunk 4: Final Integration & Verification

### Task 9: Update void-related queries for `refund` type compatibility

**Files:**
- Modify: `packages/backend/convex/orders.ts` (list queries that return voids)

Check if any other list/detail queries return `voidType` that needs updating.

- [ ] **Step 1: Search for all `voidType` validators in orders.ts and update them**

Run: Search for `v.literal("full_order"), v.literal("item")` patterns in orders.ts and update all to include `v.literal("refund")`.

- [ ] **Step 2: Run full typecheck across all packages**

Run: `pnpm typecheck`
Expected: PASS with no errors

- [ ] **Step 3: Run lint and format**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: update all voidType validators to include refund type"
```

---

### Task 10: Manual testing verification

- [ ] **Step 1: Start the dev environment**

Run: `pnpm dev`

- [ ] **Step 2: Test the native app refund flow**

1. Create a dine-in order with 3+ items
2. Pay the order (cash)
3. Go to Order History → tap the paid order
4. Tap "Refund Item"
5. Select 1 item → enter reason → choose "Cash" → Continue
6. Enter manager PIN → Approve
7. Verify: original order shows as "Voided", new order appears in history as "Paid" with remaining items
8. Verify: refund amount shown in alert is correct

- [ ] **Step 3: Test the web admin refund flow**

1. Go to Orders admin page
2. Click the eye icon on a paid order
3. Click "Refund Item"
4. Select items → reason → refund method → Continue
5. Enter manager PIN
6. Verify order is voided and replacement created

- [ ] **Step 4: Test edge case — all items refunded**

1. Repeat with a paid order, select ALL items for refund
2. Verify: no replacement order created, full refund amount

- [ ] **Step 5: Test with discounts**

1. Create order → apply SC/PWD discount → pay
2. Refund one of the discounted items
3. Verify: new order has discount reapplied, totals are correct

- [ ] **Step 6: Verify reports**

1. Generate a daily report
2. Verify: refunded order appears in void count/amount
3. Verify: replacement order appears in paid sales
