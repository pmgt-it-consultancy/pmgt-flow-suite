# Takeout Void Order Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add void functionality to the takeout order detail modal so staff can void paid takeout orders without navigating to order history.

**Architecture:** Single-file change to `TakeoutOrderDetailModal.tsx`, replicating the void flow from `OrderDetailScreen.tsx` — inline void reason modal → manager PIN modal → `api.voids.voidOrder` action. No backend changes needed.

**Tech Stack:** React Native, Tamagui, Convex (useAction)

---

## File Structure

- Modify: `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx`
  - Add void state management, handlers, void reason modal, manager PIN modal, and void button

No new files needed. Reuses existing `ManagerPinModal` component from `features/checkout/components/`.

---

## Chunk 1: Add Void to Takeout Detail Modal

### Task 1: Add void imports and state

**Files:**
- Modify: `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx:1-8`

- [ ] **Step 1: Add required imports**

Add `useAction` to the convex import, add `Alert` and `TextInput` to react-native imports, and add `ManagerPinModal` import:

```typescript
// Change line 4: add useAction
import { useAction, useQuery } from "convex/react";

// Change line 6: add Alert and TextInput
import { Alert, FlatList, TextInput } from "react-native";

// Add after line 9 (ReceiptPreviewModal import):
import { ManagerPinModal } from "../../checkout/components";
```

- [ ] **Step 2: Add void state variables**

After the existing `useState` declarations (after line 45), add:

```typescript
const [showVoidReasonModal, setShowVoidReasonModal] = useState(false);
const [showManagerPinModal, setShowManagerPinModal] = useState(false);
const [voidReason, setVoidReason] = useState("");
```

- [ ] **Step 3: Add voidOrder action hook**

After the `discounts` query (after line 49), add:

```typescript
const voidOrderAction = useAction(api.voids.voidOrder);
```

- [ ] **Step 4: Verify no type errors**

Run: `cd apps/native && npx tsc --noEmit --pretty 2>&1 | grep -i "TakeoutOrderDetailModal" | head -20`
Expected: No errors related to the new imports/state

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx
git commit -m "feat(takeout): add void imports and state to detail modal"
```

---

### Task 2: Add void handler functions

**Files:**
- Modify: `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx`

- [ ] **Step 1: Add handleVoidPress handler**

After the `handleReceiptPreview` callback (after line 129), add:

```typescript
const handleVoidPress = useCallback(() => {
  setVoidReason("");
  setShowVoidReasonModal(true);
}, []);
```

- [ ] **Step 2: Add handleVoidReasonSubmit handler**

```typescript
const handleVoidReasonSubmit = useCallback(() => {
  if (!voidReason.trim()) {
    Alert.alert("Required", "Please enter a reason for voiding this order");
    return;
  }
  setShowVoidReasonModal(false);
  setShowManagerPinModal(true);
}, [voidReason]);
```

- [ ] **Step 3: Add handleManagerPinSuccess handler**

```typescript
const handleManagerPinSuccess = useCallback(
  async (managerId: Id<"users">, pin: string) => {
    setShowManagerPinModal(false);
    try {
      const result = await voidOrderAction({
        orderId: orderId!,
        reason: voidReason.trim(),
        managerId,
        managerPin: pin,
      });

      if (result.success) {
        Alert.alert("Success", "Order has been voided", [
          { text: "OK", onPress: onClose },
        ]);
      } else {
        const errorResult = result as { success: false; error: string };
        Alert.alert("Error", errorResult.error);
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to void order");
    }
  },
  [voidOrderAction, orderId, voidReason, onClose],
);
```

Note: Unlike `OrderDetailScreen` which calls `navigation.goBack()` on success, the modal version calls `onClose` to dismiss the modal. The list will auto-refresh via Convex reactivity.

- [ ] **Step 4: Verify no type errors**

Run: `cd apps/native && npx tsc --noEmit --pretty 2>&1 | grep -i "TakeoutOrderDetailModal" | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx
git commit -m "feat(takeout): add void handler functions to detail modal"
```

---

### Task 3: Add void button and modals to the JSX

**Files:**
- Modify: `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx`

- [ ] **Step 1: Add "Void Order" button in the actions section**

In the `{/* Actions */}` section (around line 270), add a "Void Order" button after the Receipt Preview button, inside the `{isPaid && (...)}` block. The button should only show when `order.status !== "voided"`:

```tsx
{/* Actions */}
<YStack marginTop={16} gap={8}>
  {isPaid && (
    <Button variant="primary" onPress={handleReceiptPreview}>
      <XStack alignItems="center" justifyContent="center">
        <Ionicons name="receipt-outline" size={18} color="#fff" />
        <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
          Receipt Preview / Print
        </Text>
      </XStack>
    </Button>
  )}
  {isPaid && order.status !== "voided" && (
    <Button variant="destructive" onPress={handleVoidPress}>
      <XStack alignItems="center" justifyContent="center">
        <Ionicons name="close-circle-outline" size={18} color="#fff" />
        <Text style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
          Void Order
        </Text>
      </XStack>
    </Button>
  )}
  <Button variant="outline" onPress={onClose}>
    Close
  </Button>
</YStack>
```

- [ ] **Step 2: Add inline Void Reason Modal**

After the `</Modal>` closing tag of the main modal (and before `<ReceiptPreviewModal`), add the void reason modal — same pattern as `OrderDetailScreen`:

```tsx
{/* Void Reason Modal */}
<Modal
  visible={showVoidReasonModal}
  title="Void Order"
  onClose={() => setShowVoidReasonModal(false)}
  onRequestClose={() => setShowVoidReasonModal(false)}
  position="center"
>
  <Text variant="muted" style={{ marginBottom: 12 }}>
    Please provide a reason for voiding this order.
  </Text>
  <TextInput
    style={{
      borderWidth: 1,
      borderColor: "#E5E7EB",
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      color: "#111827",
      minHeight: 80,
    }}
    placeholder="Enter reason..."
    placeholderTextColor="#9CA3AF"
    value={voidReason}
    onChangeText={setVoidReason}
    multiline
    textAlignVertical="top"
  />
  <Button
    variant="destructive"
    size="lg"
    style={{ marginTop: 16 }}
    disabled={!voidReason.trim()}
    onPress={handleVoidReasonSubmit}
  >
    Continue
  </Button>
</Modal>
```

- [ ] **Step 3: Add ManagerPinModal**

After the void reason modal, add:

```tsx
{/* Manager PIN Modal */}
<ManagerPinModal
  visible={showManagerPinModal}
  title="Approve Void"
  description="Manager PIN required to void this order"
  onClose={() => setShowManagerPinModal(false)}
  onSuccess={handleManagerPinSuccess}
/>
```

- [ ] **Step 4: Verify no type errors**

Run: `cd apps/native && npx tsc --noEmit --pretty 2>&1 | grep -i "TakeoutOrderDetailModal" | head -20`
Expected: No errors

- [ ] **Step 5: Verify the app builds**

Run: `cd apps/native && npx expo export --platform ios --dump-sourcemap=false 2>&1 | tail -5`
Expected: Build completes without errors

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx
git commit -m "feat(takeout): add void order button and modals to detail modal"
```

---

## Manual Testing Checklist

After implementation, verify on device/simulator:

1. Open Takeout list → tap a **paid** order → detail modal opens
2. Confirm "Void Order" button appears below "Receipt Preview / Print"
3. Tap "Void Order" → void reason modal appears
4. Try submitting empty reason → should show alert "Please enter a reason"
5. Enter reason, tap "Continue" → manager PIN modal appears
6. Select manager, enter PIN, tap "Verify & Approve"
7. On success → alert "Order has been voided" → modal closes → order status updates in list
8. On wrong PIN → "Invalid PIN" alert, can retry
9. Verify voided order no longer shows "Void Order" button when reopened
10. Verify non-paid orders (pending/preparing/ready) do NOT show void button
