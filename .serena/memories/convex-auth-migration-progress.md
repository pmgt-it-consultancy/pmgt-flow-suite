# Convex Auth Migration Progress

## Overview
Migrating all backend queries/mutations from token-based authentication to Convex Auth's automatic authentication pattern.

## Migration Pattern
**Old pattern:**
```typescript
args: { token: v.string(), ...otherArgs }
handler: async (ctx, args) => {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", args.token))
    .first();
  if (!session || session.expiresAt < Date.now()) {
    throw new Error("Invalid session");
  }
  // use session.userId
}
```

**New pattern:**
```typescript
args: { ...otherArgs }  // token removed
handler: async (ctx, args) => {
  const user = await requireAuth(ctx);
  // use user._id
}
```

## Auth Helpers (in `lib/auth.ts`)
- `getAuthenticatedUser(ctx)` - Returns user or null
- `getAuthenticatedUserWithRole(ctx)` - Returns user with role info or null
- `requireAuth(ctx)` - Throws if not authenticated, returns user
- `requireAuthWithRole(ctx)` - Throws if not authenticated, returns user with role

## Completed Files ✅

### 1. `reports.ts`
- All functions migrated (including `getCategorySales`)

### 2. `roles.ts`
- `list` - Uses `getAuthenticatedUserWithRole` for role-based filtering
- `get` - Uses `getAuthenticatedUserWithRole`

### 3. `checkout.ts` (5 functions)
- `processCashPayment`
- `processCardPayment`
- `getReceipt`
- `cancelOrder`
- `calculateChangeAmount`

### 4. `discounts.ts` (5 functions)
- `applyScPwdDiscount`
- `applyOrderDiscount`
- `removeDiscount`
- `getOrderDiscounts`
- `getScPwdSummary`

### 5. `orders.ts` (11 functions)
- `create`
- `get`
- `list`
- `getOpenByTable`
- `addItem`
- `updateItemQuantity`
- `updateItemNotes`
- `removeItem`
- `updateCustomerName`
- `listActive`
- `getTodaysOpenOrders`

### 6. `products.ts` (8 functions)
- `list`
- `get`
- `create`
- `update`
- `bulkUpdatePrices`
- `reorder`
- `search`
- `getByCategory`

### 7. `tables.ts` (9 functions)
- `list`
- `get`
- `create`
- `update`
- `updateStatus`
- `reorder`
- `getAvailable`
- `getWithOrder`
- `listWithOrders`

### 8. `auditLogs.ts` (6 functions)
- `log`
- `list`
- `getByEntity`
- `getVoidLogs`
- `getDiscountLogs`
- `getUserActionSummary`

### 9. `categories.ts` (6 functions)
- `list`
- `get`
- `create`
- `update`
- `reorder`
- `getTree`

## Backend Migration Complete ✅

All backend files have been migrated from token-based auth to Convex Auth.

**Total functions migrated: 50+**

## Frontend Updates - COMPLETE ✅

### Native App Migration (Completed 2026-01-10)

All native app files have been updated to remove token passing. Authentication now flows automatically through the Convex Auth provider.

#### Files Updated:

1. **`apps/native/src/features/auth/context/index.ts`**
   - Removed dangling `useSessionToken` export (was never defined)

2. **`apps/native/src/features/index.ts`**
   - Removed `useSessionToken` from re-exports

3. **`apps/native/src/features/tables/screens/TablesScreen.tsx`**
   - Removed `useSessionToken` import and usage
   - Changed `logout` to `signOut` (matching AuthContext export)
   - Updated queries to remove token parameter
   - Added `isLoading, isAuthenticated` from useAuth

4. **`apps/native/src/features/orders/screens/OrderScreen.tsx`**
   - Removed token from all queries and mutations
   - Uses `isLoading, isAuthenticated` for loading check

5. **`apps/native/src/features/checkout/screens/CheckoutScreen.tsx`**
   - Removed token from queries, mutations, and loading check
   - Changed loading check to use `isLoading || !isAuthenticated || !order`

6. **`apps/native/src/features/checkout/components/ManagerPinModal.tsx`**
   - Removed token from query and handler

#### Pattern for Conditional Queries (After Migration):
```typescript
// Uses "skip" pattern without token
const data = useQuery(api.module.query, 
  user?.storeId ? { storeId: user.storeId } : "skip"
);
```

### Web App
- Already uses Convex Auth correctly via `apps/web/src/hooks/useAuth.tsx`
- No changes needed

## Notes
- The `requirePermission(ctx, userId, permission)` helper remains unchanged
- Manager approval (`managerId` arg) is separate from session authentication
- Web app (`apps/web`) already uses Convex Auth correctly via `useAuth.tsx`
- The `requireAuth(ctx)` helper is preferred over `getAuthenticatedUser(ctx)` for mutations that require auth
