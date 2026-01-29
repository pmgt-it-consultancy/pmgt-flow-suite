# PIN Management UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a PIN management dialog to the web admin users page so admins can set, overwrite, or remove a user's manager PIN.

**Architecture:** Three files modified. Backend gets `hasPin` in the list query output and a new `clearPin` action. Frontend gets a new dialog following the existing Reset Password pattern.

**Tech Stack:** Convex (backend), React + shadcn/ui (frontend), bcryptjs (PIN hashing)

---

### Task 1: Add `hasPin` to the `list` query output

**Files:**
- Modify: `packages/backend/convex/helpers/usersHelpers.ts:31-41` (returns validator) and `:106-116` (return object)

**Step 1: Add `hasPin` to the returns validator**

In the `list` query's `returns` validator (line 31-41), add `hasPin: v.boolean()` to the object:

```typescript
returns: v.array(
  v.object({
    _id: v.id("users"),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    roleId: v.optional(v.id("roles")),
    roleName: v.string(),
    storeId: v.optional(v.id("stores")),
    storeName: v.optional(v.string()),
    isActive: v.boolean(),
    hasPin: v.boolean(),
  }),
),
```

**Step 2: Add `hasPin` to the return object**

In the `enrichedUsers` map (line 106-116), add `hasPin: !!user.pin` to the returned object:

```typescript
return {
  _id: user._id,
  email: user.email,
  name: user.name,
  roleId: user.roleId,
  roleName: role?.name ?? "No Role",
  storeId: user.storeId,
  storeName,
  isActive: user.isActive ?? true,
  hasPin: !!user.pin,
};
```

**Step 3: Verify**

Run: `cd packages/backend && npx convex dev --once` or check TypeScript: `npx tsc --noEmit`
Expected: No errors. The `list` query now includes `hasPin`.

**Step 4: Commit**

```bash
git add packages/backend/convex/helpers/usersHelpers.ts
git commit -m "feat: add hasPin to users list query output"
```

---

### Task 2: Add `clearUserPinInternal` internal mutation

**Files:**
- Modify: `packages/backend/convex/helpers/usersHelpers.ts` (insert after `setUserPinInternal` at line 300)

**Step 1: Add the internal mutation**

Insert after the `setUserPinInternal` function (after line 300):

```typescript
// Internal mutation to clear a user's PIN
export const clearUserPinInternal = internalMutation({
  args: {
    userId: v.id("users"),
    updaterId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify updater has permission (can clear own PIN or has users.manage)
    if (args.updaterId !== args.userId) {
      await requirePermission(ctx, args.updaterId, "users.manage");
    }

    await ctx.db.patch(args.userId, { pin: undefined });
    return null;
  },
});
```

**Step 2: Verify**

Run: `npx tsc --noEmit` from `packages/backend`
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/backend/convex/helpers/usersHelpers.ts
git commit -m "feat: add clearUserPinInternal mutation"
```

---

### Task 3: Add `clearPin` action

**Files:**
- Modify: `packages/backend/convex/users.ts` (insert after `verifyPin` action, after line 112)

**Step 1: Add the clearPin action**

Insert after line 112 (after the closing `});` of `verifyPin`):

```typescript
// Action to clear a user's PIN
export const clearPin = action({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // Validate authentication
    const currentUserId = await ctx.runQuery(
      internal.helpers.usersHelpers.getAuthenticatedUserId,
      {},
    );

    if (!currentUserId) {
      return { success: false as const, error: "Authentication required" };
    }

    try {
      await ctx.runMutation(internal.helpers.usersHelpers.clearUserPinInternal, {
        userId: args.userId,
        updaterId: currentUserId,
      });

      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to clear PIN",
      };
    }
  },
});
```

**Step 2: Verify**

Run: `npx tsc --noEmit` from `packages/backend`
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/backend/convex/users.ts
git commit -m "feat: add clearPin action"
```

---

### Task 4: Add PIN Management Dialog to the web admin users page

**Files:**
- Modify: `apps/web/src/app/(admin)/users/page.tsx`

This is the largest task. It follows the exact same pattern as the existing Reset Password dialog.

**Step 1: Add `Lock` icon import**

On line 6, add `Lock` to the lucide-react import:

```typescript
import { Key, Lock, Pencil, Plus, Search, Users } from "lucide-react";
```

**Step 2: Add state variables**

After line 68 (`const [searchQuery, setSearchQuery] = useState("");`), add:

```typescript
const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
const [pinUserId, setPinUserId] = useState<Id<"users"> | null>(null);
const [pinUserName, setPinUserName] = useState("");
const [pinUserHasPin, setPinUserHasPin] = useState(false);
const [pinValue, setPinValue] = useState("");
```

**Step 3: Add action hooks**

After line 81 (`const resetPassword = useAction(api.users.resetPassword);`), add:

```typescript
const setPin = useAction(api.users.setPin);
const clearPin = useAction(api.users.clearPin);
```

**Step 4: Add handler functions**

After the `handleResetPassword` function (after line 181), add:

```typescript
const handleOpenPinDialog = (userItem: NonNullable<typeof users>[number]) => {
  setPinUserId(userItem._id);
  setPinUserName(userItem.name ?? "Unknown");
  setPinUserHasPin(userItem.hasPin);
  setPinValue("");
  setIsPinDialogOpen(true);
};

const handleSetPin = async () => {
  if (!isAuthenticated || !pinUserId || !pinValue) return;

  setIsSubmitting(true);
  try {
    const result = await setPin({ userId: pinUserId, pin: pinValue });
    if (result.success) {
      toast.success("PIN set successfully");
      setIsPinDialogOpen(false);
      setPinUserId(null);
      setPinValue("");
    } else {
      toast.error(result.error);
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to set PIN");
  } finally {
    setIsSubmitting(false);
  }
};

const handleClearPin = async () => {
  if (!isAuthenticated || !pinUserId) return;

  setIsSubmitting(true);
  try {
    const result = await clearPin({ userId: pinUserId });
    if (result.success) {
      toast.success("PIN removed successfully");
      setIsPinDialogOpen(false);
      setPinUserId(null);
      setPinValue("");
    } else {
      toast.error(result.error);
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to remove PIN");
  } finally {
    setIsSubmitting(false);
  }
};
```

**Step 5: Add the PIN button to the table actions**

In the table actions cell (line 268-285), add a new button BEFORE the Reset Password button. The full actions cell becomes:

```tsx
<TableCell className="text-right">
  <Button
    variant="ghost"
    size="icon"
    onClick={() => handleOpenPinDialog(userItem)}
    title="Manage PIN"
  >
    <Lock className="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    onClick={() => handleOpenResetPassword(userItem._id)}
    title="Reset Password"
  >
    <Key className="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    onClick={() => handleOpenEdit(userItem)}
    title="Edit User"
  >
    <Pencil className="h-4 w-4" />
  </Button>
</TableCell>
```

**Step 6: Add the PIN Management Dialog**

After the Reset Password Dialog closing tag (after line 479), add:

```tsx
{/* PIN Management Dialog */}
<Dialog open={isPinDialogOpen} onOpenChange={setIsPinDialogOpen}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Manage PIN — {pinUserName}</DialogTitle>
      <DialogDescription>
        Set or remove the manager PIN for approvals.
      </DialogDescription>
    </DialogHeader>

    <div className="grid gap-4 py-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Status:</span>
        <Badge variant={pinUserHasPin ? "default" : "secondary"}>
          {pinUserHasPin ? "PIN set" : "No PIN set"}
        </Badge>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pin">New PIN (4-6 digits)</Label>
        <Input
          id="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pinValue}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, "");
            setPinValue(val);
          }}
          placeholder="Enter PIN"
        />
      </div>
    </div>

    <DialogFooter className="flex gap-2 sm:justify-between">
      {pinUserHasPin && (
        <Button
          variant="destructive"
          onClick={handleClearPin}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Removing..." : "Remove PIN"}
        </Button>
      )}
      <div className="flex gap-2 ml-auto">
        <Button
          variant="outline"
          onClick={() => setIsPinDialogOpen(false)}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSetPin}
          disabled={isSubmitting || pinValue.length < 4}
        >
          {isSubmitting ? "Saving..." : "Save PIN"}
        </Button>
      </div>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Step 7: Verify**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

**Step 8: Commit**

```bash
git add apps/web/src/app/(admin)/users/page.tsx
git commit -m "feat: add PIN management dialog to admin users page"
```

---

### Task 5: Manual smoke test

**Steps:**
1. Run `npm run dev` from root
2. Open web admin, navigate to Users page
3. Verify each user row has a Lock icon button
4. Click the Lock button — dialog opens showing user name and PIN status
5. Enter a 4-digit PIN, click Save — toast confirms success
6. Reopen dialog — status badge now shows "PIN set"
7. Click "Remove PIN" — toast confirms removal
8. Reopen dialog — status badge shows "No PIN set"

---
