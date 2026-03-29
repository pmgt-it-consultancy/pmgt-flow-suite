# Advance Takeout Order Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow staff to send a takeout order to the kitchen without payment, then settle payment later from the takeout queue.

**Architecture:** Add a `sendToKitchenWithoutPayment` mutation that marks items as sent and advances `takeoutStatus` to `"preparing"` while keeping `order.status` as `"open"`. The checkout screen gets a "Send to Kitchen" button. The takeout queue is updated to show these unpaid-but-preparing orders in the "In Progress" section and navigate to checkout when tapped.

**Tech Stack:** Convex (backend mutations), React Native (checkout screen, takeout queue), ESC/POS printing

---

## Chunk 1: Backend Mutation

### Task 1: Add `sendToKitchenWithoutPayment` mutation

**Files:**
- Modify: `packages/backend/convex/orders.ts` (after `sendToKitchen` mutation, ~line 1574)

- [ ] **Step 1: Add the new mutation**

Add this mutation after the existing `sendToKitchen` mutation (after line 1574):

```typescript
// Send items to kitchen without payment (advance takeout order)
export const sendToKitchenWithoutPayment = mutation({
  args: {
    orderId: v.id("orders"),
    storeId: v.id("stores"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) throw new Error("Authentication required");

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") throw new Error("Order is not open");
    if (order.orderType !== "takeout") throw new Error("Not a takeout order");
    if (order.takeoutStatus !== "pending") throw new Error("Order is not in pending status");

    // Mark all unsent items as sent to kitchen
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .collect();

    const unsentItems = items.filter((i) => !i.isVoided && !i.isSentToKitchen);
    if (unsentItems.length === 0) throw new Error("No items to send to kitchen");

    for (const item of unsentItems) {
      await ctx.db.patch(item._id, { isSentToKitchen: true });
    }

    // Advance takeout status to preparing (order stays "open"/unpaid)
    await ctx.db.patch(args.orderId, { takeoutStatus: "preparing" });

    // Audit log
    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "send_to_kitchen_without_payment",
      entityType: "orders",
      entityId: args.orderId,
      details: JSON.stringify({
        orderNumber: order.orderNumber,
        itemCount: unsentItems.length,
        sentBy: user.name ?? "Unknown",
      }),
      userId: user._id,
      createdAt: Date.now(),
    });

    return null;
  },
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/backend && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat(backend): add sendToKitchenWithoutPayment mutation for advance takeout orders"
```

---

## Chunk 2: Checkout Screen — "Send to Kitchen" Button

### Task 2: Add "Send to Kitchen" button to checkout screen header

**Files:**
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`

- [ ] **Step 1: Add the mutation hook and state**

Near the other mutation hooks (around line 84), add:

```typescript
const sendToKitchenMutation = useMutation(api.orders.sendToKitchenWithoutPayment);
```

Add a state variable near the other state declarations:

```typescript
const [isSendingToKitchen, setIsSendingToKitchen] = useState(false);
```

- [ ] **Step 2: Add the handler function**

Add this handler near the other handlers (before the return statement). It needs access to:
- `order` (from useQuery)
- `sendToKitchenMutation`
- `usePrinterStore` functions (already available via `printToThermal` destructure — but we need `printKitchenTicketToThermal` and printer connection logic)
- `navigation` and `isTakeout`

```typescript
const handleSendToKitchenOnly = useCallback(async () => {
  if (!order || !user?.storeId || isSendingToKitchen) return;

  Alert.alert(
    "Send to Kitchen",
    "Send this order to the kitchen without payment? You can collect payment later.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send to Kitchen",
        onPress: async () => {
          setIsSendingToKitchen(true);
          try {
            await sendToKitchenMutation({
              orderId: order._id,
              storeId: user.storeId,
            });

            // Build and print kitchen ticket
            const activeItemsForTicket = items?.filter((i) => !i.isVoided) ?? [];
            if (activeItemsForTicket.length > 0 && order.orderNumber) {
              const kitchenData: KitchenTicketData = {
                orderNumber: order.orderNumber,
                orderType: "take_out",
                tableMarker: order.tableMarker,
                customerName: order.customerName,
                orderCategory: order.orderCategory,
                orderDefaultServiceType: "takeout",
                items: activeItemsForTicket.map((i) => ({
                  name: i.productName,
                  quantity: i.quantity,
                  notes: i.notes,
                  serviceType: i.serviceType ?? "takeout",
                  modifiers: i.modifiers?.map((m) => ({
                    optionName: m.optionName,
                    priceAdjustment: m.priceAdjustment,
                  })),
                })),
                timestamp: new Date(),
              };

              try {
                const { kitchenPrinter, receiptPrinter, useReceiptPrinterForKitchen, connectPrinter, printKitchenTicketToThermal } = usePrinterStore.getState();
                const targetPrinter = kitchenPrinter ?? (useReceiptPrinterForKitchen ? receiptPrinter : null);
                if (targetPrinter) {
                  const connected = await connectPrinter(targetPrinter.id);
                  if (connected) {
                    const charsPerLine = targetPrinter.paperWidth === 58 ? 32 : 48;
                    await printKitchenTicketToThermal(kitchenData, charsPerLine);
                  }
                }
              } catch (printErr) {
                console.log("Kitchen print error (non-blocking):", printErr);
              }
            }

            // Navigate to takeout queue
            navigation.reset({
              index: 0,
              routes: [{ name: "HomeScreen" }, { name: "TakeoutListScreen" }],
            });
          } catch (error: any) {
            Alert.alert("Error", error.message || "Failed to send to kitchen");
          } finally {
            setIsSendingToKitchen(false);
          }
        },
      },
    ],
  );
}, [order, user?.storeId, isSendingToKitchen, sendToKitchenMutation, items, navigation]);
```

**Note on printer access:** The checkout screen already imports `usePrinterStore`. For the kitchen printing inside the Alert callback, we use `usePrinterStore.getState()` (Zustand store direct access) since this runs in an async callback, not in the render cycle. The `items` variable is already available in CheckoutScreen's scope from the order query.

- [ ] **Step 3: Add the button to the header area**

In the JSX, right after the `<PageHeader>` component (line ~555) and before the `<KeyboardAwareScrollView>`, add the "Send to Kitchen" button. Only show it for takeout orders that haven't been paid yet:

```tsx
{isTakeout && order?.status === "open" && order?.takeoutStatus === "pending" && (
  <XStack
    paddingHorizontal={16}
    paddingVertical={8}
    backgroundColor="#FFF"
    borderBottomWidth={1}
    borderColor="#E5E7EB"
  >
    <TouchableOpacity
      onPress={handleSendToKitchenOnly}
      disabled={isSendingToKitchen}
      activeOpacity={0.7}
      style={{
        flex: 1,
        backgroundColor: isSendingToKitchen ? "#9CA3AF" : "#FFF7ED",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#FDBA74",
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons
        name="restaurant-outline"
        size={18}
        color={isSendingToKitchen ? "#FFFFFF" : "#EA580C"}
        style={{ marginRight: 8 }}
      />
      <Text
        style={{
          color: isSendingToKitchen ? "#FFFFFF" : "#EA580C",
          fontWeight: "600",
          fontSize: 14,
        }}
      >
        {isSendingToKitchen ? "Sending..." : "Send to Kitchen Without Payment"}
      </Text>
    </TouchableOpacity>
  </XStack>
)}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd apps/native && pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/checkout/screens/CheckoutScreen.tsx
git commit -m "feat(native): add Send to Kitchen button on checkout screen for advance takeout orders"
```

---

## Chunk 3: Takeout Queue — Show Unpaid Preparing Orders

### Task 3: Update takeout queue filtering and navigation

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`
- Modify: `apps/native/src/features/takeout/components/TakeoutOrderCard.tsx`

- [ ] **Step 1: Update the order filtering in TakeoutListScreen**

Currently (lines 91-109), the filter logic puts all `status === "open"` orders into `attentionOrders` and only `status === "paid"` orders into `kitchenOrders`. An advance order has `status: "open"` + `takeoutStatus: "preparing"`, so it would wrongly appear in "Needs Attention."

Update the `useMemo` block:

```typescript
const { attentionOrders, kitchenOrders, completedOrders } = useMemo(() => {
  if (!takeoutOrders) return { attentionOrders: [], kitchenOrders: [], completedOrders: [] };
  return {
    // Open orders that are still pending (not yet sent to kitchen)
    attentionOrders: takeoutOrders.filter(
      (o) => o.status === "open" && (!o.takeoutStatus || o.takeoutStatus === "pending"),
    ),
    // In-progress: paid orders in kitchen workflow OR unpaid advance orders (open + preparing/ready)
    kitchenOrders: takeoutOrders.filter(
      (o) =>
        (o.status === "paid" &&
          o.takeoutStatus &&
          !["completed", "cancelled"].includes(o.takeoutStatus)) ||
        (o.status === "open" &&
          o.takeoutStatus &&
          ["preparing", "ready_for_pickup"].includes(o.takeoutStatus)),
    ),
    completedOrders: takeoutOrders.filter(
      (o) =>
        o.status === "voided" ||
        (o.status === "paid" &&
          o.takeoutStatus &&
          ["completed", "cancelled"].includes(o.takeoutStatus)),
    ),
  };
}, [takeoutOrders]);
```

- [ ] **Step 2: Update `handleOpenTakeoutOrder` to navigate advance orders to checkout**

Currently (lines 175-190), when `status === "open"`, it always navigates to `TakeoutOrderScreen`. For advance orders (`open` + `preparing`), it should navigate to `CheckoutScreen` instead.

Update the handler:

```typescript
const handleOpenTakeoutOrder = useCallback(
  (orderId: Id<"orders">, status?: "draft" | "open" | "paid" | "voided", takeoutStatus?: string) => {
    if (!user?.storeId) return;

    if (status === "open") {
      // Advance orders (sent to kitchen, awaiting payment) go to checkout
      if (takeoutStatus === "preparing" || takeoutStatus === "ready_for_pickup") {
        navigation.navigate("CheckoutScreen", {
          orderId,
          orderType: "takeout" as const,
        });
        return;
      }
      // Regular open orders go to the order screen
      navigation.navigate("TakeoutOrderScreen", {
        storeId: user.storeId,
        orderId,
      });
      return;
    }

    setSelectedOrderId(orderId);
  },
  [user?.storeId, navigation],
);
```

- [ ] **Step 3: Update the `onPress` call in the FlatList to pass `takeoutStatus`**

In the FlatList `renderItem` (line 350), update the `onPress` callback to pass `takeoutStatus`:

```tsx
onPress={(orderId) => handleOpenTakeoutOrder(orderId, item.status, item.takeoutStatus)}
```

- [ ] **Step 4: Update TakeoutOrderCard for advance order UX**

In `TakeoutOrderCard.tsx`, the card already shows an "Unpaid" badge for non-paid orders (line 84). However, the `canResumeOrder` logic (line 86) shows a yellow "Resume Order" button for ALL open orders. For advance orders (open + preparing), we want a different CTA.

Update the card logic. Replace the `canResumeOrder` and `primaryActionLabel` lines (86-90):

```typescript
const canResumeOrder = isOpen && !isVoided;
const isAdvanceOrder = isOpen && (takeoutStatus === "preparing" || takeoutStatus === "ready_for_pickup");
const primaryActionLabel = isAdvanceOrder
  ? "Take Payment"
  : canResumeOrder && takeoutStatus === "ready_for_pickup"
    ? "Resume & Take Payment"
    : "Resume Order";
```

Update the button styling for advance orders. Replace the resume button block (lines 154-173):

```tsx
{canResumeOrder && (
  <TouchableOpacity
    onPress={() => onPress?.(id)}
    activeOpacity={0.8}
    style={{
      backgroundColor: isAdvanceOrder ? "#0D87E1" : "#F59E0B",
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Ionicons
      name={isAdvanceOrder ? "card-outline" : "create-outline"}
      size={18}
      color="#FFFFFF"
      style={{ marginRight: 8 }}
    />
    <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 15 }}>
      {primaryActionLabel}
    </Text>
  </TouchableOpacity>
)}
```

Also update the `helperText` (lines 91-97) to handle advance orders:

```typescript
const helperText = isVoided
  ? "Voided order record"
  : isAdvanceOrder
    ? "Sent to kitchen. Tap to collect payment."
    : canResumeOrder
      ? "Open order. Tap to edit cart and continue checkout."
      : isPaid && config.nextLabel
        ? "Paid order ready for the next kitchen step."
        : "Tap to view order details.";
```

And update the card background styling (lines 101-107) to differentiate advance orders:

```tsx
style={{
  backgroundColor: isAdvanceOrder ? "#EFF6FF" : canResumeOrder ? "#FFFBEB" : "#FFFFFF",
  borderRadius: 12,
  padding: 16,
  borderWidth: 1,
  borderColor: isAdvanceOrder ? "#93C5FD" : canResumeOrder ? "#FCD34D" : "#F3F4F6",
  marginBottom: 12,
}}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd apps/native && pnpm typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutListScreen.tsx apps/native/src/features/takeout/components/TakeoutOrderCard.tsx
git commit -m "feat(native): show advance takeout orders in queue with Take Payment action"
```

---

## Chunk 4: Disable status advancement for unpaid advance orders

### Task 4: Prevent advancing unpaid orders past "preparing"

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`

The `disableAdvance` prop (line 351-353) currently only checks `ready_for_pickup` status. For advance orders, the status advancement buttons (Start Preparing, Ready for Pickup) should not appear since the card shows "Take Payment" instead. However, the `canAdvanceWorkflow` check in TakeoutOrderCard already handles this — it requires `isPaid` (line 85), so unpaid advance orders won't show the workflow buttons.

- [ ] **Step 1: Verify no changes needed**

Verify that `canAdvanceWorkflow` on TakeoutOrderCard line 85 is:
```typescript
const canAdvanceWorkflow = isPaid && config.nextLabel && !isVoided;
```

This already prevents showing "Start Preparing" / "Ready for Pickup" buttons on unpaid orders. No code change needed — just verify this is correct.

- [ ] **Step 2: Manual testing checklist**

Test these scenarios:
1. Create takeout order → Proceed to Payment → Tap "Send to Kitchen Without Payment" → Confirm → Verify kitchen receipt prints → Verify navigation to takeout queue
2. In takeout queue → Verify advance order appears in "In Progress" section with "Unpaid" badge and blue card
3. Tap advance order → Verify it opens checkout screen → Complete payment → Verify normal post-payment flow
4. Verify regular takeout flow still works (pay first, then kitchen)
5. Verify dine-in flow is completely unaffected
6. Verify advance order cannot be marked "completed" without payment (existing guard)
