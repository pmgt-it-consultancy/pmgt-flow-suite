# Bulk SC/PWD Discount Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow staff to enter one SC/PWD ID and apply the discount to multiple selected items in a single flow, instead of repeating per-item.

**Architecture:** Add a new backend mutation `applyBulkScPwdDiscount` that accepts an array of `{orderItemId, quantityApplied}` pairs and creates individual `orderDiscounts` records for each (preserving BIR audit trail). Update the native `DiscountModal` to support multi-item checkbox selection instead of single-item radio selection.

**Tech Stack:** Convex (backend mutation), React Native + Tamagui (UI), TypeScript

---

### Task 1: Add `applyBulkScPwdDiscount` Backend Mutation

**Files:**
- Modify: `packages/backend/convex/discounts.ts`

**Step 1: Add the bulk mutation after `applyScPwdDiscount` (after line 106)**

```typescript
// Apply SC/PWD discount to multiple order items at once
export const applyBulkScPwdDiscount = mutation({
  args: {
    orderId: v.id("orders"),
    items: v.array(
      v.object({
        orderItemId: v.id("orderItems"),
        quantityApplied: v.number(),
      }),
    ),
    discountType: v.union(v.literal("senior_citizen"), v.literal("pwd")),
    customerName: v.string(),
    customerId: v.string(),
    managerId: v.id("users"),
  },
  returns: v.array(v.id("orderDiscounts")),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    await requirePermission(ctx, args.managerId, "discounts.approve");

    if (args.items.length === 0) {
      throw new Error("No items selected for discount");
    }

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") {
      throw new Error("Cannot apply discount to closed order");
    }

    const discountIds: Id<"orderDiscounts">[] = [];

    for (const item of args.items) {
      const orderItem = await ctx.db.get(item.orderItemId);
      if (!orderItem) throw new Error(`Order item not found: ${item.orderItemId}`);
      if (orderItem.orderId !== args.orderId) {
        throw new Error("Item does not belong to this order");
      }
      if (orderItem.isVoided) {
        throw new Error(`Cannot apply discount to voided item: ${orderItem.productName}`);
      }
      if (item.quantityApplied > orderItem.quantity) {
        throw new Error(`Discount quantity exceeds item quantity for ${orderItem.productName}`);
      }

      // Check existing discounts on this item
      const existingDiscounts = await ctx.db
        .query("orderDiscounts")
        .withIndex("by_orderItem", (q) => q.eq("orderItemId", item.orderItemId))
        .collect();
      const totalDiscountedQty = existingDiscounts.reduce((sum, d) => sum + d.quantityApplied, 0);
      if (totalDiscountedQty + item.quantityApplied > orderItem.quantity) {
        throw new Error(
          `Cannot apply discount to ${orderItem.productName}: only ${orderItem.quantity - totalDiscountedQty} undiscounted quantity remaining`,
        );
      }

      // Calculate effective price including modifiers
      const modifiers = await ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q: any) => q.eq("orderItemId", item.orderItemId))
        .collect();
      const modifierTotal = modifiers.reduce((sum: number, m: any) => sum + m.priceAdjustment, 0);
      const effectivePrice = orderItem.productPrice + modifierTotal;

      const scPwd = calculateScPwdDiscount(effectivePrice);
      const discountAmount = scPwd.discountAmount * item.quantityApplied;
      const vatExemptAmount = scPwd.vatExemptAmount * item.quantityApplied;

      const discountId = await ctx.db.insert("orderDiscounts", {
        orderId: args.orderId,
        orderItemId: item.orderItemId,
        discountType: args.discountType,
        customerName: args.customerName,
        customerId: args.customerId,
        quantityApplied: item.quantityApplied,
        discountAmount,
        vatExemptAmount,
        approvedBy: args.managerId,
        createdAt: Date.now(),
      });

      discountIds.push(discountId);
    }

    // Recalculate order totals once (not per item)
    await recalculateOrderTotalsWithDiscounts(ctx, args.orderId);

    return discountIds;
  },
});
```

**Step 2: Verify no type errors**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: PASS (no errors in discounts.ts)

**Step 3: Commit**

```bash
git add packages/backend/convex/discounts.ts
git commit -m "feat(backend): add applyBulkScPwdDiscount mutation for multi-item SC/PWD discounts"
```

---

### Task 2: Update DiscountModal to Support Multi-Item Selection

**Files:**
- Modify: `apps/native/src/features/checkout/components/DiscountModal.tsx`

**Step 1: Replace single-item selection with multi-item checkbox selection**

Replace the entire `DiscountModal.tsx` with:

```tsx
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useRef } from "react";
import {
  type TextInput as RNTextInput,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { XStack, YStack } from "tamagui";
import { Button, Chip, Modal, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

type DiscountType = "senior_citizen" | "pwd" | null;

interface OrderItem {
  _id: Id<"orderItems">;
  productName: string;
  quantity: number;
  lineTotal: number;
}

interface DiscountModalProps {
  visible: boolean;
  items: OrderItem[];
  discountedQtyByItem: Map<string, number>;
  discountType: DiscountType;
  selectedItemIds: Set<string>;
  idNumber: string;
  customerName: string;
  onClose: () => void;
  onDiscountTypeChange: (type: DiscountType) => void;
  onItemToggle: (itemId: Id<"orderItems">) => void;
  onSelectAll: () => void;
  onIdNumberChange: (value: string) => void;
  onCustomerNameChange: (value: string) => void;
  onApply: () => void;
}

export const DiscountModal = ({
  visible,
  items,
  discountedQtyByItem,
  discountType,
  selectedItemIds,
  idNumber,
  customerName,
  onClose,
  onDiscountTypeChange,
  onItemToggle,
  onSelectAll,
  onIdNumberChange,
  onCustomerNameChange,
  onApply,
}: DiscountModalProps) => {
  const formatCurrency = useFormatCurrency();
  const customerNameRef = useRef<RNTextInput>(null);

  const availableItems = items.filter((item) => {
    const discountedQty = discountedQtyByItem.get(item._id) ?? 0;
    return discountedQty < item.quantity;
  });

  const allSelected = availableItems.length > 0 && availableItems.every((item) => selectedItemIds.has(item._id));
  const isValid = discountType && selectedItemIds.size > 0 && idNumber.trim() && customerName.trim();

  return (
    <Modal
      visible={visible}
      title="Apply SC/PWD Discount"
      onClose={onClose}
      onRequestClose={onClose}
    >
      {/* Discount Type */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8, marginTop: 12 }}>
        Discount Type
      </Text>
      <XStack gap={12}>
        <Chip
          selected={discountType === "senior_citizen"}
          onPress={() => onDiscountTypeChange("senior_citizen")}
          style={{ flex: 1, justifyContent: "center" }}
        >
          Senior Citizen
        </Chip>
        <Chip
          selected={discountType === "pwd"}
          onPress={() => onDiscountTypeChange("pwd")}
          style={{ flex: 1, justifyContent: "center" }}
        >
          PWD
        </Chip>
      </XStack>

      {/* Select Items */}
      <XStack justifyContent="space-between" alignItems="center" marginTop={16} marginBottom={8}>
        <Text style={{ color: "#374151", fontWeight: "500" }}>
          Select Items
        </Text>
        {availableItems.length > 1 && (
          <TouchableOpacity onPress={onSelectAll} activeOpacity={0.7}>
            <Text style={{ color: "#0D87E1", fontWeight: "500", fontSize: 14 }}>
              {allSelected ? "Deselect All" : "Select All"}
            </Text>
          </TouchableOpacity>
        )}
      </XStack>
      <ScrollView style={{ maxHeight: 160 }}>
        {availableItems.map((item) => {
          const isSelected = selectedItemIds.has(item._id);
          return (
            <TouchableOpacity
              key={item._id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                borderWidth: 1,
                borderRadius: 8,
                marginBottom: 8,
                borderColor: isSelected ? "#0D87E1" : "#E5E7EB",
                backgroundColor: isSelected ? "#EFF6FF" : undefined,
              }}
              onPress={() => onItemToggle(item._id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isSelected ? "checkbox" : "square-outline"}
                size={22}
                color={isSelected ? "#0D87E1" : "#9CA3AF"}
                style={{ marginRight: 10 }}
              />
              <Text style={{ flex: 1, color: "#374151" }}>
                {item.quantity}x {item.productName}
              </Text>
              <Text style={{ color: "#111827", fontWeight: "500" }}>
                {formatCurrency(item.lineTotal)}
              </Text>
            </TouchableOpacity>
          );
        })}
        {availableItems.length === 0 && (
          <Text variant="muted" style={{ textAlign: "center", paddingVertical: 16 }}>
            All items already have discounts
          </Text>
        )}
      </ScrollView>

      {/* ID Number */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8, marginTop: 16 }}>
        ID Number
      </Text>
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: "#E5E7EB",
          borderRadius: 8,
          padding: 12,
          fontSize: 16,
        }}
        placeholder="Enter SC/PWD ID number"
        placeholderTextColor="#9CA3AF"
        value={idNumber}
        onChangeText={onIdNumberChange}
        returnKeyType="next"
        onSubmitEditing={() => customerNameRef.current?.focus()}
        blurOnSubmit={false}
      />

      {/* Customer Name */}
      <Text style={{ color: "#374151", fontWeight: "500", marginBottom: 8, marginTop: 16 }}>
        Customer Name
      </Text>
      <TextInput
        ref={customerNameRef}
        style={{
          borderWidth: 1,
          borderColor: "#E5E7EB",
          borderRadius: 8,
          padding: 12,
          fontSize: 16,
        }}
        placeholder="Enter customer name"
        placeholderTextColor="#9CA3AF"
        value={customerName}
        onChangeText={onCustomerNameChange}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (isValid) onApply();
        }}
      />

      <Text variant="muted" size="xs" style={{ marginTop: 12 }}>
        BIR rule: 20% discount applies only to items consumed by SC/PWD
      </Text>

      <Button
        variant="primary"
        size="lg"
        disabled={!isValid}
        onPress={onApply}
        style={{ marginTop: 20, opacity: !isValid ? 0.5 : 1 }}
      >
        Apply Discount{selectedItemIds.size > 1 ? ` to ${selectedItemIds.size} Items` : ""}
      </Button>
    </Modal>
  );
};
```

Key changes from original:
- `selectedItemId` (single) → `selectedItemIds` (Set<string>)
- `onItemSelect` → `onItemToggle` + `onSelectAll`
- Checkbox icons instead of radio-style selection
- "Select All / Deselect All" toggle link
- Button label shows count when multiple items selected
- Increased `maxHeight` from 120 to 160 for multi-select comfort

**Step 2: Verify no type errors**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: FAIL — `CheckoutScreen.tsx` still passes old props. This is expected, we fix it in Task 3.

**Step 3: Commit**

```bash
git add apps/native/src/features/checkout/components/DiscountModal.tsx
git commit -m "feat(native): update DiscountModal for multi-item checkbox selection"
```

---

### Task 3: Update CheckoutScreen to Wire Up Bulk Discount Flow

**Files:**
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`

**Step 1: Replace single-item state with multi-item state and use bulk mutation**

In `CheckoutScreen.tsx`, make these changes:

**1a. Add bulk mutation import (line 83):**

Replace:
```typescript
const applyScPwdDiscount = useMutation(api.discounts.applyScPwdDiscount);
```
With:
```typescript
const applyBulkScPwdDiscount = useMutation(api.discounts.applyBulkScPwdDiscount);
```

**1b. Replace single-item state (line 66) with Set:**

Replace:
```typescript
const [selectedItemId, setSelectedItemId] = useState<Id<"orderItems"> | null>(null);
```
With:
```typescript
const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
```

**1c. Update `handleOpenDiscountModal` (line 108-114):**

Replace:
```typescript
const handleOpenDiscountModal = useCallback(() => {
    setDiscountType(null);
    setSelectedItemId(null);
    setDiscountIdNumber("");
    setDiscountName("");
    setShowDiscountModal(true);
  }, []);
```
With:
```typescript
const handleOpenDiscountModal = useCallback(() => {
    setDiscountType(null);
    setSelectedItemIds(new Set());
    setDiscountIdNumber("");
    setDiscountName("");
    setShowDiscountModal(true);
  }, []);
```

**1d. Add item toggle and select-all handlers after `handleOpenDiscountModal`:**

```typescript
const handleItemToggle = useCallback((itemId: Id<"orderItems">) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const availableItemIds = useMemo(() => {
    return activeItems
      .filter((item) => (discountedQtyByItem.get(item._id) ?? 0) < item.quantity)
      .map((item) => item._id);
  }, [activeItems, discountedQtyByItem]);

  const handleSelectAll = useCallback(() => {
    setSelectedItemIds((prev) => {
      const allSelected = availableItemIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(availableItemIds);
    });
  }, [availableItemIds]);
```

**1e. Update `handleApplyDiscount` validation (line 116-123):**

Replace:
```typescript
const handleApplyDiscount = useCallback(() => {
    if (!discountType || !selectedItemId || !discountIdNumber.trim() || !discountName.trim()) {
      return;
    }
    setPendingManagerAction("apply");
    setShowDiscountModal(false);
    setShowManagerPinModal(true);
  }, [discountType, selectedItemId, discountIdNumber, discountName]);
```
With:
```typescript
const handleApplyDiscount = useCallback(() => {
    if (!discountType || selectedItemIds.size === 0 || !discountIdNumber.trim() || !discountName.trim()) {
      return;
    }
    setPendingManagerAction("apply");
    setShowDiscountModal(false);
    setShowManagerPinModal(true);
  }, [discountType, selectedItemIds, discountIdNumber, discountName]);
```

**1f. Update `handleManagerPinSuccess` to call bulk mutation (line 140-181):**

Replace the apply branch:
```typescript
if (pendingManagerAction === "apply" && discountType && selectedItemId) {
        try {
          await applyScPwdDiscount({
            orderId,
            orderItemId: selectedItemId,
            discountType,
            customerName: discountName.trim(),
            customerId: discountIdNumber.trim(),
            quantityApplied: 1,
            managerId,
          });
          Alert.alert("Success", "Discount applied successfully");
        } catch (error: any) {
          Alert.alert("Error", error.message || "Failed to apply discount");
        }
```
With:
```typescript
if (pendingManagerAction === "apply" && discountType && selectedItemIds.size > 0) {
        try {
          const items = Array.from(selectedItemIds).map((itemId) => ({
            orderItemId: itemId as Id<"orderItems">,
            quantityApplied: 1,
          }));
          await applyBulkScPwdDiscount({
            orderId,
            items,
            discountType,
            customerName: discountName.trim(),
            customerId: discountIdNumber.trim(),
            managerId,
          });
          Alert.alert("Success", `Discount applied to ${items.length} item${items.length > 1 ? "s" : ""}`);
        } catch (error: any) {
          Alert.alert("Error", error.message || "Failed to apply discount");
        }
```

**1g. Update dependency array of `handleManagerPinSuccess`:**

Replace `selectedItemId` with `selectedItemIds` and `applyScPwdDiscount` with `applyBulkScPwdDiscount` in the deps array.

**1h. Update DiscountModal props in JSX (line 404-418):**

Replace:
```tsx
<DiscountModal
        visible={showDiscountModal}
        items={activeItems}
        discountedQtyByItem={discountedQtyByItem}
        discountType={discountType}
        selectedItemId={selectedItemId}
        idNumber={discountIdNumber}
        customerName={discountName}
        onClose={() => setShowDiscountModal(false)}
        onDiscountTypeChange={setDiscountType}
        onItemSelect={setSelectedItemId}
        onIdNumberChange={setDiscountIdNumber}
        onCustomerNameChange={setDiscountName}
        onApply={handleApplyDiscount}
      />
```
With:
```tsx
<DiscountModal
        visible={showDiscountModal}
        items={activeItems}
        discountedQtyByItem={discountedQtyByItem}
        discountType={discountType}
        selectedItemIds={selectedItemIds}
        idNumber={discountIdNumber}
        customerName={discountName}
        onClose={() => setShowDiscountModal(false)}
        onDiscountTypeChange={setDiscountType}
        onItemToggle={handleItemToggle}
        onSelectAll={handleSelectAll}
        onIdNumberChange={setDiscountIdNumber}
        onCustomerNameChange={setDiscountName}
        onApply={handleApplyDiscount}
      />
```

**Step 2: Verify type checking passes**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite && pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/native/src/features/checkout/screens/CheckoutScreen.tsx
git commit -m "feat(native): wire up bulk SC/PWD discount flow in CheckoutScreen"
```

---

### Task 4: Manual QA Verification

**Step 1: Run the native app**

Run: `cd /Users/solstellar/Documents/work/pmgt-it-consultancy/pmgt-flow-suite/apps/native && pnpm ios`

**Step 2: Test the happy path**

1. Create an order with 3+ items
2. Go to Checkout
3. Tap "Add SC/PWD Discount"
4. Select "Senior Citizen"
5. Tap "Select All" — all items should get checked
6. Deselect one item — checkbox should uncheck
7. Enter ID number and customer name
8. Tap "Apply Discount to 2 Items"
9. Enter manager PIN
10. Verify all selected items show discounts in DiscountSection
11. Verify order totals recalculated correctly (VAT-exempt for discounted items)

**Step 3: Test edge cases**

- Apply discount to 1 item, then open modal again — that item should not appear in available list
- Try applying with no items selected — button should be disabled
- Order with single item — "Select All" link should not appear

**Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix(native): address QA findings for bulk discount"
```

---

## Summary of Changes

| Layer | File | Change |
|-------|------|--------|
| Backend | `packages/backend/convex/discounts.ts` | Add `applyBulkScPwdDiscount` mutation |
| UI Component | `apps/native/.../DiscountModal.tsx` | Multi-select checkboxes + Select All |
| Screen | `apps/native/.../CheckoutScreen.tsx` | Wire Set state + bulk mutation |

**No schema changes needed.** Each bulk call still creates individual `orderDiscounts` records per item — BIR audit trail is preserved. The existing `applyScPwdDiscount` single-item mutation is kept for backward compatibility (web app may use it).
