# Open Price Products Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow products to be marked as "open price" so cashiers enter the price at order time, with min/max validation.

**Architecture:** Add `isOpenPrice`, `minPrice`, `maxPrice` fields to the products schema. Extend the `addItem` mutation to accept an optional `customPrice` arg that's required for open-price products and validated against min/max range. Update the native app to show a price input field in AddItemModal/ModifierSelectionModal when the product is open-price, and the web admin to include an Open Price toggle in the product form.

**Tech Stack:** Convex (backend schema + mutations), React Native/Tamagui (native UI), Next.js (web admin), Vitest + convex-test (tests)

**Spec:** `docs/superpowers/specs/2026-03-22-open-price-products-design.md`

---

## Chunk 1: Backend Schema & Mutations

### Task 1: Add open price fields to products schema

**Files:**
- Modify: `packages/backend/convex/schema.ts:84-97`

- [ ] **Step 1: Add isOpenPrice, minPrice, maxPrice to products table**

In `packages/backend/convex/schema.ts`, update the products table definition (lines 84-97):

```typescript
products: defineTable({
  storeId: v.id("stores"),
  name: v.string(),
  categoryId: v.id("categories"),
  price: v.number(),
  isVatable: v.boolean(),
  isActive: v.boolean(),
  isOpenPrice: v.optional(v.boolean()),
  minPrice: v.optional(v.number()),
  maxPrice: v.optional(v.number()),
  sortOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_store", ["storeId"])
  .index("by_category", ["categoryId"])
  .index("by_store_active", ["storeId", "isActive"]),
```

Using `v.optional()` so existing products don't need migration — they'll default to `undefined` (treated as `false`).

- [ ] **Step 2: Run typecheck to verify schema compiles**

Run: `cd packages/backend && npx convex dev --typecheck=enable --once` or `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat: add open price fields to products schema"
```

---

### Task 2: Write tests for open-price product creation

**Files:**
- Create: `packages/backend/convex/products.test.ts`

- [ ] **Step 1: Write failing tests for open-price product create and update**

Create `packages/backend/convex/products.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function setupProductTestData(t: ReturnType<typeof convexTest>) {
  const storeId = await t.run(async (ctx) => {
    return await ctx.db.insert("stores", {
      name: "Test Store",
      address: "123 Test St",
      tinNumber: "123-456-789",
      minNumber: "MIN-001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const roleId = await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      storeId,
      name: "Admin",
      permissions: [
        "products:create",
        "products:update",
        "orders:create",
        "orders:update",
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "test@test.com",
      name: "Test User",
      storeId,
      roleId,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const categoryId = await t.run(async (ctx) => {
    return await ctx.db.insert("categories", {
      storeId,
      name: "BBQ",
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { storeId, roleId, userId, categoryId };
}

describe("products - open price", () => {
  it("should create an open-price product with min/max", async () => {
    const t = convexTest(schema, modules);
    const { storeId, userId, categoryId } = await setupProductTestData(t);

    const productId = await t.run(async (ctx) => {
      return await ctx.db.insert("products", {
        storeId,
        name: "BBQ Pork",
        categoryId,
        price: 0,
        isVatable: true,
        isActive: true,
        isOpenPrice: true,
        minPrice: 50,
        maxPrice: 500,
        sortOrder: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const product = await t.run(async (ctx) => {
      return await ctx.db.get(productId);
    });

    expect(product?.isOpenPrice).toBe(true);
    expect(product?.minPrice).toBe(50);
    expect(product?.maxPrice).toBe(500);
  });

  it("should create a regular product without open price fields", async () => {
    const t = convexTest(schema, modules);
    const { storeId, categoryId } = await setupProductTestData(t);

    const productId = await t.run(async (ctx) => {
      return await ctx.db.insert("products", {
        storeId,
        name: "Regular Item",
        categoryId,
        price: 100,
        isVatable: true,
        isActive: true,
        sortOrder: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const product = await t.run(async (ctx) => {
      return await ctx.db.get(productId);
    });

    expect(product?.isOpenPrice).toBeUndefined();
    expect(product?.minPrice).toBeUndefined();
    expect(product?.maxPrice).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (schema validation)**

Run: `cd packages/backend && pnpm vitest run products.test.ts`
Expected: PASS — these tests only validate schema accepts the new fields

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/products.test.ts
git commit -m "test: add open price product schema tests"
```

---

### Task 3: Update product create/update mutations

**Files:**
- Modify: `packages/backend/convex/products.ts:135-234`

- [ ] **Step 1: Update the `create` mutation args (line 135)**

In `packages/backend/convex/products.ts`, add open price args to the `create` mutation:

```typescript
export const create = mutation({
  args: {
    storeId: v.id("stores"),
    name: v.string(),
    categoryId: v.id("categories"),
    price: v.number(),
    isVatable: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    isOpenPrice: v.optional(v.boolean()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
  },
  returns: v.id("products"),
```

In the handler, add validation before the insert (after the existing sortOrder logic around line 177):

```typescript
    // Validate open price fields
    if (args.isOpenPrice) {
      if (args.minPrice === undefined || args.maxPrice === undefined) {
        throw new Error("Open price products require minPrice and maxPrice");
      }
      if (args.minPrice < 0) {
        throw new Error("minPrice must be non-negative");
      }
      if (args.minPrice >= args.maxPrice) {
        throw new Error("minPrice must be less than maxPrice");
      }
    }
```

Add the fields to the insert call (around lines 181-191):

```typescript
    const productId = await ctx.db.insert("products", {
      storeId: args.storeId,
      name: args.name,
      categoryId: args.categoryId,
      price: args.isOpenPrice ? 0 : args.price,
      isVatable,
      isActive: true,
      isOpenPrice: args.isOpenPrice ?? false,
      minPrice: args.isOpenPrice ? args.minPrice : undefined,
      maxPrice: args.isOpenPrice ? args.maxPrice : undefined,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
```

- [ ] **Step 2: Update the `update` mutation args (line 196)**

Add optional open price fields:

```typescript
export const update = mutation({
  args: {
    productId: v.id("products"),
    name: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    price: v.optional(v.number()),
    isVatable: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    isOpenPrice: v.optional(v.boolean()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
  },
  returns: v.null(),
```

In the handler, add validation (after the category check, before the patch):

```typescript
    // Validate open price fields
    const effectiveIsOpenPrice = args.isOpenPrice ?? product.isOpenPrice ?? false;
    if (effectiveIsOpenPrice) {
      const effectiveMin = args.minPrice ?? product.minPrice;
      const effectiveMax = args.maxPrice ?? product.maxPrice;
      if (effectiveMin === undefined || effectiveMax === undefined) {
        throw new Error("Open price products require minPrice and maxPrice");
      }
      if (effectiveMin < 0) {
        throw new Error("minPrice must be non-negative");
      }
      if (effectiveMin >= effectiveMax) {
        throw new Error("minPrice must be less than maxPrice");
      }
    }
```

Include the new fields in the updates object that gets patched:

```typescript
    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.categoryId !== undefined) updates.categoryId = args.categoryId;
    if (args.price !== undefined) updates.price = args.price;
    if (args.isVatable !== undefined) updates.isVatable = args.isVatable;
    if (args.isActive !== undefined) updates.isActive = args.isActive;
    if (args.sortOrder !== undefined) updates.sortOrder = args.sortOrder;
    if (args.isOpenPrice !== undefined) updates.isOpenPrice = args.isOpenPrice;
    if (args.minPrice !== undefined) updates.minPrice = args.minPrice;
    if (args.maxPrice !== undefined) updates.maxPrice = args.maxPrice;
    // When turning off open price, clear min/max
    if (args.isOpenPrice === false) {
      updates.minPrice = undefined;
      updates.maxPrice = undefined;
    }
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/products.ts
git commit -m "feat: add open price support to product create/update mutations"
```

---

### Task 4: Write tests for addItem with customPrice

**Files:**
- Create: `packages/backend/convex/openPrice.test.ts`

- [ ] **Step 1: Write failing tests for addItem open-price validation**

Create `packages/backend/convex/openPrice.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function setupOpenPriceTestData(t: ReturnType<typeof convexTest>) {
  const storeId = await t.run(async (ctx) => {
    return await ctx.db.insert("stores", {
      name: "Test Store",
      address: "123 Test St",
      tinNumber: "123-456-789",
      minNumber: "MIN-001",
      vatRate: 0.12,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const roleId = await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      storeId,
      name: "Admin",
      permissions: [
        "products:create",
        "products:update",
        "orders:create",
        "orders:update",
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "test@test.com",
      name: "Test User",
      storeId,
      roleId,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const categoryId = await t.run(async (ctx) => {
    return await ctx.db.insert("categories", {
      storeId,
      name: "BBQ",
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Open price product
  const openPriceProductId = await t.run(async (ctx) => {
    return await ctx.db.insert("products", {
      storeId,
      name: "BBQ Pork",
      categoryId,
      price: 0,
      isVatable: true,
      isActive: true,
      isOpenPrice: true,
      minPrice: 50,
      maxPrice: 500,
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Regular product
  const regularProductId = await t.run(async (ctx) => {
    return await ctx.db.insert("products", {
      storeId,
      name: "Rice",
      categoryId,
      price: 25,
      isVatable: true,
      isActive: true,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Create order
  const orderId = await t.run(async (ctx) => {
    return await ctx.db.insert("orders", {
      storeId,
      orderNumber: "ORD-001",
      status: "open",
      orderType: "dine-in",
      grossSales: 0,
      vatableSales: 0,
      vatAmount: 0,
      vatExemptSales: 0,
      nonVatSales: 0,
      discountAmount: 0,
      netSales: 0,
      createdBy: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { storeId, userId, categoryId, openPriceProductId, regularProductId, orderId };
}

describe("addItem - open price", () => {
  it("should add open-price item with valid customPrice", async () => {
    const t = convexTest(schema, modules);
    const { userId, openPriceProductId, orderId } = await setupOpenPriceTestData(t);

    const itemId = await t.mutation(api.orders.addItem, {
      orderId,
      productId: openPriceProductId,
      quantity: 1,
      customPrice: 150,
    });

    const item = await t.run(async (ctx) => {
      return await ctx.db.get(itemId);
    });

    expect(item?.productPrice).toBe(150);
    expect(item?.productName).toBe("BBQ Pork");
  });

  it("should reject open-price item without customPrice", async () => {
    const t = convexTest(schema, modules);
    const { orderId, openPriceProductId } = await setupOpenPriceTestData(t);

    await expect(
      t.mutation(api.orders.addItem, {
        orderId,
        productId: openPriceProductId,
        quantity: 1,
      })
    ).rejects.toThrow("Custom price is required for open-price products");
  });

  it("should reject customPrice below minPrice", async () => {
    const t = convexTest(schema, modules);
    const { orderId, openPriceProductId } = await setupOpenPriceTestData(t);

    await expect(
      t.mutation(api.orders.addItem, {
        orderId,
        productId: openPriceProductId,
        quantity: 1,
        customPrice: 10,
      })
    ).rejects.toThrow("Price must be between");
  });

  it("should reject customPrice above maxPrice", async () => {
    const t = convexTest(schema, modules);
    const { orderId, openPriceProductId } = await setupOpenPriceTestData(t);

    await expect(
      t.mutation(api.orders.addItem, {
        orderId,
        productId: openPriceProductId,
        quantity: 1,
        customPrice: 999,
      })
    ).rejects.toThrow("Price must be between");
  });

  it("should ignore customPrice for regular products", async () => {
    const t = convexTest(schema, modules);
    const { orderId, regularProductId } = await setupOpenPriceTestData(t);

    const itemId = await t.mutation(api.orders.addItem, {
      orderId,
      productId: regularProductId,
      quantity: 1,
      customPrice: 999,
    });

    const item = await t.run(async (ctx) => {
      return await ctx.db.get(itemId);
    });

    expect(item?.productPrice).toBe(25); // catalog price, not customPrice
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && pnpm vitest run openPrice.test.ts`
Expected: FAIL — `addItem` doesn't accept `customPrice` yet

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/backend/convex/openPrice.test.ts
git commit -m "test: add failing tests for open-price addItem"
```

---

### Task 5: Update addItem mutation to support customPrice

**Files:**
- Modify: `packages/backend/convex/orders.ts:568-633`

- [ ] **Step 1: Add customPrice arg to addItem mutation**

In `packages/backend/convex/orders.ts`, update the `addItem` args (lines 568-583):

```typescript
export const addItem = mutation({
  args: {
    orderId: v.id("orders"),
    productId: v.id("products"),
    quantity: v.number(),
    notes: v.optional(v.string()),
    customPrice: v.optional(v.number()),
    modifiers: v.optional(
      v.array(
        v.object({
          modifierGroupName: v.string(),
          modifierOptionName: v.string(),
          priceAdjustment: v.number(),
        }),
      ),
    ),
  },
  returns: v.id("orderItems"),
```

- [ ] **Step 2: Add open-price validation and price resolution in handler**

After fetching the product (around line 599), add open-price logic:

```typescript
    // Resolve price for open-price products
    let itemPrice: number;
    if (product.isOpenPrice) {
      if (args.customPrice === undefined) {
        throw new Error("Custom price is required for open-price products");
      }
      if (
        product.minPrice !== undefined &&
        product.maxPrice !== undefined &&
        (args.customPrice < product.minPrice || args.customPrice > product.maxPrice)
      ) {
        throw new Error(
          `Price must be between ${product.minPrice} and ${product.maxPrice}`
        );
      }
      itemPrice = args.customPrice;
    } else {
      itemPrice = product.price;
    }
```

Then update the insert call to use `itemPrice` instead of `product.price`:

```typescript
    const itemId = await ctx.db.insert("orderItems", {
      orderId: args.orderId,
      productId: args.productId,
      productName: product.name,
      productPrice: itemPrice,  // was: product.price
      quantity: args.quantity,
      notes: args.notes,
      isVoided: false,
      isSentToKitchen: false,
    });
```

- [ ] **Step 3: Run open price tests**

Run: `cd packages/backend && pnpm vitest run openPrice.test.ts`
Expected: PASS — all 5 tests pass

- [ ] **Step 4: Run full test suite to check no regressions**

Run: `cd packages/backend && pnpm vitest run`
Expected: All existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/orders.ts
git commit -m "feat: support customPrice in addItem for open-price products"
```

---

### Task 6: Update product list query to include open-price fields

**Files:**
- Modify: `packages/backend/convex/products.ts`

The `list` query (line 9) and `getByCategory` query (line 345) return products to the frontend. We need to ensure `isOpenPrice`, `minPrice`, and `maxPrice` are included in the return value.

- [ ] **Step 1: Check if queries already pass through all fields**

The `list` query (line 9) likely maps products and adds computed fields like `hasModifiers`. Check the return shape — if it spreads the product (`...product`), the new fields flow through automatically. If it manually picks fields, add the new ones.

Similarly, `getByCategory` (line 345) is used by the native app's CategoryGrid. Check its return shape.

- [ ] **Step 2: Update return validators if needed**

If the queries have explicit `returns` validators that enumerate fields, add the new fields:

```typescript
isOpenPrice: v.optional(v.boolean()),
minPrice: v.optional(v.number()),
maxPrice: v.optional(v.number()),
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/products.ts
git commit -m "feat: include open price fields in product queries"
```

---

## Chunk 2: Native App UI Changes

### Task 7: Update ProductCard to show "Enter Price"

**Files:**
- Modify: `apps/native/src/features/orders/components/ProductCard.tsx:7-56`

- [ ] **Step 1: Add isOpenPrice to ProductCard props**

Update the props interface (lines 7-13):

```typescript
interface ProductCardProps {
  id: Id<"products">;
  name: string;
  price: number;
  hasModifiers?: boolean;
  isOpenPrice?: boolean;
  onPress: (product: { id: Id<"products">; name: string; price: number; hasModifiers: boolean; isOpenPrice: boolean }) => void;
}
```

- [ ] **Step 2: Update price display (lines 54-56)**

Replace the price rendering:

```typescript
            <Text style={{ color: isOpenPrice ? "#059669" : "#2563EB", fontWeight: "700", fontSize: 14 }}>
              {isOpenPrice ? "Enter Price" : formatCurrency(price)}
            </Text>
```

- [ ] **Step 3: Update onPress to include isOpenPrice**

In the TouchableOpacity onPress handler, include the new field:

```typescript
onPress={() => onPress({ id, name, price, hasModifiers: hasModifiers ?? false, isOpenPrice: isOpenPrice ?? false })}
```

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/components/ProductCard.tsx
git commit -m "feat: show 'Enter Price' on open-price product cards"
```

---

### Task 8: Update CategoryGrid to pass isOpenPrice

**Files:**
- Modify: `apps/native/src/features/orders/components/CategoryGrid.tsx`

- [ ] **Step 1: Add isOpenPrice to Product and SelectedProduct interfaces**

```typescript
interface Product {
  _id: Id<"products">;
  name: string;
  price: number;
  categoryId: Id<"categories">;
  isActive: boolean;
  hasModifiers: boolean;
  isOpenPrice?: boolean;
}

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
  hasModifiers: boolean;
  isOpenPrice: boolean;
}
```

- [ ] **Step 2: Pass isOpenPrice to ProductCard**

In the CategoryGrid render, pass the new prop to ProductCard:

```typescript
<ProductCard
  key={product._id}
  id={product._id}
  name={product.name}
  price={product.price}
  hasModifiers={product.hasModifiers}
  isOpenPrice={product.isOpenPrice ?? false}
  onPress={onProductPress}
/>
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/orders/components/CategoryGrid.tsx
git commit -m "feat: pass isOpenPrice through CategoryGrid to ProductCard"
```

---

### Task 9: Update OrderScreen to handle open-price products

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx:44-264`

- [ ] **Step 1: Update SelectedProduct interface (lines 44-49)**

```typescript
interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
  hasModifiers: boolean;
  isOpenPrice: boolean;
  minPrice?: number;
  maxPrice?: number;
}
```

- [ ] **Step 2: Update DraftItem interface (lines 51-59)**

No changes needed — `productPrice` already stores the final price (will be the cashier-entered price for open-price items).

- [ ] **Step 3: Update handleAddProduct callback**

When a product is selected from the grid, also fetch min/max if it's open price. The product data from the query should already include these fields. Update the handler to pass them through to SelectedProduct:

```typescript
const handleAddProduct = useCallback((product: SelectedProduct) => {
  setSelectedProduct(product);
  setQuantity(1);
  setNotes("");
}, []);
```

The SelectedProduct already includes `isOpenPrice`, `minPrice`, `maxPrice` from the CategoryGrid/ProductCard flow.

- [ ] **Step 4: Update handleConfirmAdd to pass customPrice (lines 186-222)**

In the draft mode branch, the price comes from the modal (will be passed as a parameter). In live mode, pass `customPrice` to the mutation:

```typescript
const handleConfirmAdd = useCallback(
  async (customPrice?: number) => {
    if (!selectedProduct) return;

    const finalPrice = selectedProduct.isOpenPrice ? customPrice! : selectedProduct.price;

    if (isDraftMode) {
      setDraftItems((prev) => [
        ...prev,
        {
          localId: `draft-${Date.now()}`,
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          productPrice: finalPrice,
          quantity,
          notes: notes || undefined,
        },
      ]);
    } else {
      await addItem({
        orderId: currentOrderId!,
        productId: selectedProduct.id,
        quantity,
        notes: notes || undefined,
        customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
      });
    }
    // reset state...
  },
  [selectedProduct, isDraftMode, quantity, notes, currentOrderId, addItem]
);
```

- [ ] **Step 5: Update handleConfirmModifiers similarly (lines 224-264)**

Pass `customPrice` when the product is open-price:

```typescript
const handleConfirmModifiers = useCallback(
  async (qty: number, itemNotes: string, modifiers: SelectedModifier[], customPrice?: number) => {
    if (!selectedProduct) return;

    const finalPrice = selectedProduct.isOpenPrice ? customPrice! : selectedProduct.price;
    const modifierTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);

    if (isDraftMode) {
      setDraftItems((prev) => [
        ...prev,
        {
          localId: `draft-${Date.now()}`,
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          productPrice: finalPrice + modifierTotal,
          quantity: qty,
          notes: itemNotes || undefined,
          modifiers,
        },
      ]);
    } else {
      await addItem({
        orderId: currentOrderId!,
        productId: selectedProduct.id,
        quantity: qty,
        notes: itemNotes || undefined,
        customPrice: selectedProduct.isOpenPrice ? customPrice : undefined,
        modifiers: modifiers.map((m) => ({
          modifierGroupName: m.modifierGroupName,
          modifierOptionName: m.modifierOptionName,
          priceAdjustment: m.priceAdjustment,
        })),
      });
    }
    // reset state...
  },
  [selectedProduct, isDraftMode, currentOrderId, addItem]
);
```

- [ ] **Step 6: Pass isOpenPrice/minPrice/maxPrice to AddItemModal and ModifierSelectionModal**

In the JSX where these modals are rendered, pass the new props:

```tsx
<AddItemModal
  visible={showAddItemModal}
  product={selectedProduct}
  quantity={quantity}
  notes={notes}
  isLoading={isAddingItem}
  onClose={handleCloseModal}
  onQuantityChange={setQuantity}
  onNotesChange={setNotes}
  onConfirm={handleConfirmAdd}
/>
```

The `product` prop already passes the full `SelectedProduct` which now includes `isOpenPrice`, `minPrice`, `maxPrice`.

For ModifierSelectionModal, ensure the product prop type is updated to include the new fields.

- [ ] **Step 7: Commit**

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "feat: handle open-price products in OrderScreen"
```

---

### Task 10: Update AddItemModal with price input

**Files:**
- Modify: `apps/native/src/features/orders/components/AddItemModal.tsx`

- [ ] **Step 1: Update props interface to support open price callback**

```typescript
interface AddItemModalProps {
  visible: boolean;
  product: {
    id: Id<"products">;
    name: string;
    price: number;
    hasModifiers: boolean;
    isOpenPrice: boolean;
    minPrice?: number;
    maxPrice?: number;
  } | null;
  quantity: number;
  notes: string;
  isLoading: boolean;
  onClose: () => void;
  onQuantityChange: (qty: number) => void;
  onNotesChange: (notes: string) => void;
  onConfirm: (customPrice?: number) => void;
}
```

- [ ] **Step 2: Add price input state and validation**

Inside the component, add state for the custom price:

```typescript
const [customPriceText, setCustomPriceText] = useState("");

const customPrice = parseFloat(customPriceText) || 0;
const isOpenPrice = product?.isOpenPrice ?? false;
const minPrice = product?.minPrice ?? 0;
const maxPrice = product?.maxPrice ?? Infinity;
const isPriceValid = !isOpenPrice || (customPrice >= minPrice && customPrice <= maxPrice);
const effectivePrice = isOpenPrice ? customPrice : (product?.price ?? 0);
const total = effectivePrice * quantity;
```

Reset `customPriceText` when modal opens or product changes:

```typescript
useEffect(() => {
  if (visible) {
    setCustomPriceText("");
  }
}, [visible]);
```

- [ ] **Step 3: Replace price display with conditional input**

Replace the static price display (lines 89-91) with:

```tsx
{isOpenPrice ? (
  <YStack gap={4}>
    <XStack alignItems="center" gap={8}>
      <Text style={{ color: "#6B7280", fontSize: 16 }}>₱</Text>
      <TextInput
        style={{
          fontSize: 24,
          fontWeight: "700",
          color: "#0D87E1",
          borderBottomWidth: 2,
          borderBottomColor: isPriceValid || customPriceText === "" ? "#0D87E1" : "#EF4444",
          paddingVertical: 4,
          paddingHorizontal: 8,
          minWidth: 120,
        }}
        value={customPriceText}
        onChangeText={setCustomPriceText}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor="#9CA3AF"
        autoFocus
      />
    </XStack>
    <Text style={{ color: "#6B7280", fontSize: 13 }}>
      Range: {formatCurrency(minPrice)} – {formatCurrency(maxPrice)}
    </Text>
  </YStack>
) : (
  <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 18, marginTop: 2 }}>
    {formatCurrency(product.price)}
  </Text>
)}
```

- [ ] **Step 4: Update total display**

The total calculation already uses `effectivePrice * quantity` from Step 2. Update the total display to use the computed `total` variable.

- [ ] **Step 5: Update confirm button to be disabled when price invalid**

```tsx
<TouchableOpacity
  onPress={() => onConfirm(isOpenPrice ? customPrice : undefined)}
  disabled={isLoading || (isOpenPrice && !isPriceValid)}
  style={{
    backgroundColor: isLoading || (isOpenPrice && !isPriceValid) ? "#9CA3AF" : "#0D87E1",
    // ... rest of styles
  }}
>
```

- [ ] **Step 6: Add TextInput import**

Add `TextInput` to the `react-native` import at the top of the file.

- [ ] **Step 7: Commit**

```bash
git add apps/native/src/features/orders/components/AddItemModal.tsx
git commit -m "feat: add price input to AddItemModal for open-price products"
```

---

### Task 11: Update ModifierSelectionModal with price input

**Files:**
- Modify: `apps/native/src/features/orders/components/ModifierSelectionModal.tsx`

This follows the same pattern as Task 10.

- [ ] **Step 1: Update product prop type**

```typescript
interface ModifierSelectionModalProps {
  visible: boolean;
  product: {
    id: Id<"products">;
    name: string;
    price: number;
    isOpenPrice?: boolean;
    minPrice?: number;
    maxPrice?: number;
  } | null;
  modifierGroups: ModifierGroup[];
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (quantity: number, notes: string, modifiers: SelectedModifier[], customPrice?: number) => void;
}
```

- [ ] **Step 2: Add custom price state and validation (same as AddItemModal)**

```typescript
const [customPriceText, setCustomPriceText] = useState("");

const customPrice = parseFloat(customPriceText) || 0;
const isOpenPrice = product?.isOpenPrice ?? false;
const minPrice = product?.minPrice ?? 0;
const maxPrice = product?.maxPrice ?? Infinity;
const isPriceValid = !isOpenPrice || (customPrice >= minPrice && customPrice <= maxPrice);
const basePrice = isOpenPrice ? customPrice : (product?.price ?? 0);
```

Reset on modal open:

```typescript
useEffect(() => {
  if (visible) {
    setCustomPriceText("");
  }
}, [visible]);
```

- [ ] **Step 3: Replace static price display (lines 191-193) with conditional input**

Same pattern as AddItemModal — show a TextInput when `isOpenPrice`, otherwise show the static price.

- [ ] **Step 4: Update unitTotal and lineTotal calculations (lines 152-153)**

```typescript
const unitTotal = basePrice + modifierTotal;
const lineTotal = unitTotal * quantity;
```

- [ ] **Step 5: Update onConfirm call to pass customPrice**

```typescript
onConfirm(quantity, notes, selectedModifiers, isOpenPrice ? customPrice : undefined)
```

- [ ] **Step 6: Disable confirm when price invalid**

Add `!isPriceValid` to the disabled condition on the confirm button.

- [ ] **Step 7: Commit**

```bash
git add apps/native/src/features/orders/components/ModifierSelectionModal.tsx
git commit -m "feat: add price input to ModifierSelectionModal for open-price products"
```

---

## Chunk 3: Web Admin Changes

### Task 12: Update web admin product form

**Files:**
- Modify: `apps/web/src/app/(admin)/products/page.tsx`

- [ ] **Step 1: Add open price fields to ProductFormData interface (line 41)**

```typescript
interface ProductFormData {
  storeId: Id<"stores"> | undefined;
  categoryId: Id<"categories"> | undefined;
  name: string;
  price: number;
  isVatable: boolean;
  sortOrder: number;
  isActive: boolean;
  isOpenPrice: boolean;
  minPrice: number;
  maxPrice: number;
}
```

- [ ] **Step 2: Update initialFormData**

```typescript
const initialFormData: ProductFormData = {
  storeId: undefined,
  categoryId: undefined,
  name: "",
  price: 0,
  isVatable: true,
  sortOrder: 0,
  isActive: true,
  isOpenPrice: false,
  minPrice: 0,
  maxPrice: 0,
};
```

- [ ] **Step 3: Update the edit product handler to populate open price fields**

When opening a product for editing, populate the new fields from the product data:

```typescript
setFormData({
  ...existingFields,
  isOpenPrice: product.isOpenPrice ?? false,
  minPrice: product.minPrice ?? 0,
  maxPrice: product.maxPrice ?? 0,
});
```

- [ ] **Step 4: Add Open Price toggle and min/max fields to the form**

After the price field (around line 334), add:

```tsx
{/* Open Price Toggle */}
<div className="grid gap-2">
  <div className="flex items-center gap-2">
    <input
      type="checkbox"
      id="isOpenPrice"
      checked={formData.isOpenPrice}
      onChange={(e) =>
        setFormData({
          ...formData,
          isOpenPrice: e.target.checked,
          price: e.target.checked ? 0 : formData.price,
        })
      }
    />
    <Label htmlFor="isOpenPrice">Open Price (cashier enters price)</Label>
  </div>
</div>

{formData.isOpenPrice && (
  <div className="grid grid-cols-2 gap-4">
    <div className="grid gap-2">
      <Label htmlFor="minPrice">Minimum Price</Label>
      <Input
        id="minPrice"
        type="number"
        step="0.01"
        value={formData.minPrice}
        onChange={(e) =>
          setFormData({
            ...formData,
            minPrice: parseFloat(e.target.value) || 0,
          })
        }
      />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="maxPrice">Maximum Price</Label>
      <Input
        id="maxPrice"
        type="number"
        step="0.01"
        value={formData.maxPrice}
        onChange={(e) =>
          setFormData({
            ...formData,
            maxPrice: parseFloat(e.target.value) || 0,
          })
        }
      />
    </div>
  </div>
)}
```

When `isOpenPrice` is true, hide or disable the regular price field:

```tsx
{!formData.isOpenPrice && (
  <div className="grid gap-2">
    <Label htmlFor="price">Price (VAT-inclusive)</Label>
    <Input ... />
  </div>
)}
```

- [ ] **Step 5: Update form submission to include open price fields (lines 150-157)**

```typescript
await createProduct({
  storeId: formData.storeId,
  categoryId: formData.categoryId,
  name: formData.name,
  price: formData.isOpenPrice ? 0 : formData.price,
  isVatable: formData.isVatable,
  sortOrder: formData.sortOrder,
  isOpenPrice: formData.isOpenPrice,
  minPrice: formData.isOpenPrice ? formData.minPrice : undefined,
  maxPrice: formData.isOpenPrice ? formData.maxPrice : undefined,
});
```

Similarly for the update path.

- [ ] **Step 6: Update product table to show "Open Price" badge**

In the products table row where the price is displayed, add a badge:

```tsx
<td>
  {product.isOpenPrice ? (
    <span className="text-sm text-emerald-600 font-medium">
      Open Price ({formatCurrency(product.minPrice ?? 0)} – {formatCurrency(product.maxPrice ?? 0)})
    </span>
  ) : (
    formatCurrency(product.price)
  )}
</td>
```

- [ ] **Step 7: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/(admin)/products/page.tsx
git commit -m "feat: add open price toggle to web admin product form"
```

---

## Chunk 4: Final Verification

### Task 13: Run full test suite and typecheck

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 2: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git commit -m "chore: fixups from open-price feature verification"
```
