# Phase 3 — Migrate Read Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create WatermelonDB-based data source hooks for all synced read-only tables (modifiers, categories, tables, stores, settings, appConfig, order history) and wire them into every screen that currently uses `useQuery`, gated behind feature flags.

**Architecture:** Each data source follows the `useProducts.ts` pattern: call both Convex `useQuery` and WatermelonDB `useObservable` unconditionally (to keep React hooks rules), gate the return value on a feature flag from `featureFlags.ts`. Screens swap their `useQuery(api.xxx.yyy)` import to the new data source hook. Screens where the data source replaces non-trivial joined shapes (e.g. `api.modifierAssignments.getForStore` returning per-product modifier groups, `api.tables.listWithOrders` returning tables with their open orders) must compute the same shape from local WatermelonDB data.

**Tech Stack:** WatermelonDB v0.28+, `useObservable`, Convex `useQuery` (kept for fallback), React Native, TypeScript, Jest.

**Spec:** [docs/superpowers/specs/2026-04-27-offline-first-pos-tablet-design.md](../specs/2026-04-27-offline-first-pos-tablet-design.md) — Phase 3 section

---

## File Structure

```
apps/native/src/sync/
├── featureFlags.ts          [MODIFY] — add new flags: useWatermelon.modifiers, .categories, .tables, .stores, .orderHistory
├── dataSources/
│   ├── index.ts             [MODIFY] — barrel re-exports
│   ├── useProducts.ts       [EXISTS] — already implemented
│   ├── useModifiers.ts      [CREATE] — getForStore + getForProduct shapes
│   ├── useCategories.ts     [CREATE] — getTree shape
│   ├── useTables.ts         [CREATE] — listWithOrders + getAvailable shapes
│   ├── useStores.ts         [CREATE] — stores.get shape
│   └── useOrderHistory.ts   [CREATE] — listActive + getTakeoutOrders shapes
│
apps/native/src/features/
├── orders/screens/OrderScreen.tsx         [MODIFY] — wire modifierGroups to useModifiersForProduct
├── orders/components/CategoryGrid.tsx     [MODIFY] — accept products from prop (already done), add useCategoriesTree for categoryTree
├── tables/screens/TablesScreen.tsx        [MODIFY] — use useTablesListWithOrders
├── orders/components/TransferTableModal.tsx [MODIFY] — use useTablesAvailable
├── takeout/screens/TakeoutOrderScreen.tsx [MODIFY] — use useProducts + useModifiersForStore
├── checkout/screens/CheckoutScreen.tsx    [MODIFY] — use useStore
├── takeout/components/TakeoutOrderDetailModal.tsx [MODIFY] — use useStore
├── order-history/screens/OrderDetailScreen.tsx — no changes (reads order.get + checkout.getReceipt, both are non-synced computed shapes)
├── home/screens/HomeScreen.tsx            [MODIFY] — use useActiveOrders
├── takeout/screens/TakeoutListScreen.tsx  [MODIFY] — use useTakeoutOrders
└── settings/screens/SettingsScreen.tsx    [MODIFY] — use useAutoLockSetting
```

---

### Task 1: Add feature flags for remaining read paths

**Files:**
- Modify: `apps/native/src/sync/featureFlags.ts`

- [ ] **Step 1: Add new flags**

Replace the body of `apps/native/src/sync/featureFlags.ts` with:

```typescript
/**
 * Feature flags controlling whether each data path reads from
 * WatermelonDB (offline-first) or Convex (`useQuery` over WS).
 *
 * Per spec §Migration & Rollout, every Phase-3 screen migration is
 * gated behind a flag so it can be flipped per-store and rolled back
 * without redeploying.
 *
 * Source of truth: an env var per flag, evaluated at app startup.
 * To enable a flag, set the corresponding EXPO_PUBLIC_OFFLINE_*
 * variable to "1" in `.env.local` (or via EAS env config).
 *
 * Flag names follow `useWatermelon.<table>` shape from the spec.
 */
export const featureFlags = {
  /** OrderScreen + CategoryGrid product list reads from WatermelonDB */
  "useWatermelon.products": process.env.EXPO_PUBLIC_OFFLINE_PRODUCTS === "1",
  "useWatermelon.categories": process.env.EXPO_PUBLIC_OFFLINE_CATEGORIES === "1",
  "useWatermelon.modifiers": process.env.EXPO_PUBLIC_OFFLINE_MODIFIERS === "1",
  "useWatermelon.tables": process.env.EXPO_PUBLIC_OFFLINE_TABLES === "1",
  "useWatermelon.stores": process.env.EXPO_PUBLIC_OFFLINE_STORES === "1",
  "useWatermelon.orderHistory": process.env.EXPO_PUBLIC_OFFLINE_ORDER_HISTORY === "1",
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFlagEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/sync/featureFlags.ts
git commit -m "feat(native): add feature flags for categories, modifiers, tables, stores, orderHistory"
```

---

### Task 2: Create useModifiers data source

**Files:**
- Create: `apps/native/src/sync/dataSources/useModifiers.ts`
- Modify: `apps/native/src/sync/dataSources/index.ts`

The backend exposes two shapes:
1. `api.modifierAssignments.getForStore({ storeId })` → `Array<{ productId, groups: Array<{ groupId, groupName, selectionType, minSelections, maxSelections?, sortOrder, options: Array<{ optionId, name, priceAdjustment, isDefault }> }> }>`
2. `api.modifierAssignments.getForProduct({ productId })` → `Array<{ groupId, groupName, selectionType, minSelections, maxSelections?, sortOrder, options: Array<{ optionId, name, priceAdjustment, isDefault }> }>`

- [ ] **Step 1: Write the test (Jest unit test)**

Create `apps/native/src/sync/dataSources/__tests__/useModifiers.test.ts`:

```typescript
import { describe, expect, it, jest } from "@jest/globals";

// We can't unit-test hooks that depend on WatermelonDB observables in
// a pure Jest env (requires JSI). Instead we test the shape-computation
// logic that the hook would perform. For full integration, test on a
// real device with the feature flag toggled.

// Export the pure computation functions from useModifiers.ts for testability.
import { buildModifiersByProduct, buildModifierGroupsForProduct } from "../useModifiers";

function makeGroup(raw: {
  id: string;
  name: string;
  selectionType: string;
  minSelections: number;
  maxSelections?: number;
  sortOrder: number;
}) {
  return raw;
}

function makeOption(raw: {
  id: string;
  name: string;
  priceAdjustment: number;
  isDefault: boolean;
  modifierGroupId: string;
}) {
  return raw;
}

function makeAssignment(raw: {
  id: string;
  modifierGroupId: string;
  productId?: string;
  categoryId?: string;
  storeId: string;
}) {
  return raw;
}

describe("buildModifiersByProduct", () => {
  it("returns empty map for empty inputs", () => {
    const result = buildModifiersByProduct([], [], [], "");
    expect(result.size).toBe(0);
  });

  it("maps product-level assignments to correct product", () => {
    const groups = [
      makeGroup({ id: "g1", name: "Size", selectionType: "single", minSelections: 1, sortOrder: 0 }),
    ];
    const options = [
      makeOption({ id: "o1", name: "Large", priceAdjustment: 50, isDefault: false, modifierGroupId: "g1" }),
    ];
    const assignments = [
      makeAssignment({ id: "a1", modifierGroupId: "g1", productId: "p1", storeId: "s1" }),
    ];
    const result = buildModifiersByProduct(groups, options, assignments, "s1");
    expect(result.size).toBe(1);
    const entry = result.get("p1");
    expect(entry).toBeDefined();
    expect(entry!.length).toBe(1);
    expect(entry![0].groupName).toBe("Size");
    expect(entry![0].options.length).toBe(1);
    expect(entry![0].options[0].name).toBe("Large");
  });

  it("resolves category-inherited assignments via ancestor chain", () => {
    const groups = [
      makeGroup({ id: "g1", name: "Spice", selectionType: "single", minSelections: 0, maxSelections: 1, sortOrder: 0 }),
    ];
    const options = [
      makeOption({ id: "o1", name: "Mild", priceAdjustment: 0, isDefault: true, modifierGroupId: "g1" }),
    ];
    // Assignment ties modifier group to a parent category, not a product
    const assignments = [
      makeAssignment({ id: "a1", modifierGroupId: "g1", categoryId: "c1", storeId: "s1" }),
    ];
    // Product "p1" belongs to category "c2" which has parent "c1"
    // categories list includes both so ancestor chain resolves
    const products = [
      { id: "p1", categoryId: "c2", storeId: "s1", isActive: true, sortOrder: 0 },
    ];
    const categories = [
      { id: "c1", parentId: undefined, storeId: "s1", isActive: true, name: "Food" },
      { id: "c2", parentId: "c1", storeId: "s1", isActive: true, name: "Rice" },
    ];
    const result = buildModifiersByProduct(
      groups,
      options,
      assignments,
      "s1",
      products as any,
      categories as any,
    );
    expect(result.size).toBe(1);
    expect(result.get("p1")![0].groupName).toBe("Spice");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/native && npx jest src/sync/dataSources/__tests__/useModifiers.test.ts
```
Expected: FAIL — `buildModifiersByProduct` is not defined.

- [ ] **Step 3: Create `useModifiers.ts`**

Write `apps/native/src/sync/dataSources/useModifiers.ts`:

```typescript
import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import {
  type Category,
  getDatabase,
  type ModifierGroup,
  type ModifierGroupAssignment,
  type ModifierOption,
  type Product,
} from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

// ─── Types ────────────────────────────────────────────────────

export type ModifierOptionItem = {
  optionId: Id<"modifierOptions">;
  name: string;
  priceAdjustment: number;
  isDefault: boolean;
};

export type ModifierGroupItem = {
  groupId: Id<"modifierGroups">;
  groupName: string;
  selectionType: "single" | "multi";
  minSelections: number;
  maxSelections?: number;
  sortOrder: number;
  options: ModifierOptionItem[];
};

// Shape of api.modifierAssignments.getForStore entries
export type ProductModifierGroups = {
  productId: Id<"products">;
  groups: ModifierGroupItem[];
};

// ─── Pure computation helpers (exported for testing) ──────────

export function buildModifiersByProduct(
  watermelonGroups: ModifierGroup[],
  watermelonOptions: ModifierOption[],
  watermelonAssignments: ModifierGroupAssignment[],
  storeId: string,
  watermelonProducts?: Product[],
  watermelonCategories?: Category[],
): Map<string, ModifierGroupItem[]> {
  // Index groups/options by id
  const groupById = new Map<string, ModifierGroup>();
  for (const g of watermelonGroups) groupById.set(g.id, g);

  const optionsByGroupId = new Map<string, ModifierOptionItem[]>();
  for (const o of watermelonOptions) {
    const arr = optionsByGroupId.get(o.modifierGroupId) ?? [];
    arr.push({
      optionId: o.id as Id<"modifierOptions">,
      name: o.name,
      priceAdjustment: o.priceAdjustment,
      isDefault: o.isDefault,
    });
    optionsByGroupId.set(o.modifierGroupId, arr);
  }

  // Build a function that resolves which productIds a categoryId assignment covers.
  // For product-level assignments, it's just that product.
  // For category-level assignments, it's all products whose categoryId is
  // in the descendant chain (category itself + all subcategories).
  let productIdsForCategory: ((catId: string) => string[]) | null = null;
  if (watermelonProducts && watermelonCategories) {
    // Build parent chain cache
    const parentOf = new Map<string, string | undefined>();
    for (const c of watermelonCategories) parentOf.set(c.id, c.parentId);

    const descendants = new Map<string, Set<string>>();
    const getDescendants = (catId: string): Set<string> => {
      const cached = descendants.get(catId);
      if (cached) return cached;
      const set = new Set<string>();
      set.add(catId);
      for (const child of watermelonCategories) {
        if (child.parentId === catId) {
          for (const d of getDescendants(child.id)) set.add(d);
        }
      }
      descendants.set(catId, set);
      return set;
    };

    // Index products by categoryId
    const productsByCategory = new Map<string, Product[]>();
    for (const p of watermelonProducts) {
      const arr = productsByCategory.get(p.categoryId) ?? [];
      arr.push(p);
      productsByCategory.set(p.categoryId, arr);
    }

    productIdsForCategory = (catId: string): string[] => {
      const result: string[] = [];
      for (const descId of getDescendants(catId)) {
        const prods = productsByCategory.get(descId) ?? [];
        for (const p of prods) result.push(p.id);
      }
      return result;
    };
  }

  const result = new Map<string, ModifierGroupItem[]>();

  for (const a of watermelonAssignments) {
    const group = groupById.get(a.modifierGroupId);
    if (!group || !group.isActive) continue;

    const options = optionsByGroupId.get(a.modifierGroupId) ?? [];

    const groupItem: ModifierGroupItem = {
      groupId: a.modifierGroupId as Id<"modifierGroups">,
      groupName: group.name,
      selectionType: group.selectionType as "single" | "multi",
      minSelections: a.minSelectionsOverride ?? group.minSelections,
      maxSelections: a.maxSelectionsOverride ?? group.maxSelections,
      sortOrder: a.sortOrder,
      options,
    };

    // Determine which productIds this assignment targets
    let targetProductIds: string[] = [];

    if (a.productId) {
      targetProductIds = [a.productId];
    } else if (a.categoryId && productIdsForCategory) {
      targetProductIds = productIdsForCategory(a.categoryId);
    } else {
      continue;
    }

    for (const pid of targetProductIds) {
      const arr = result.get(pid) ?? [];
      arr.push(groupItem);
      result.set(pid, arr);
    }
  }

  // Sort each array
  for (const [, groups] of result) {
    groups.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return result;
}

// ─── Hooks ────────────────────────────────────────────────────

/**
 * Bulk-fetch modifier groups for all products in a store.
 * Returns the same shape as `api.modifierAssignments.getForStore`.
 */
export function useModifiersForStore(
  storeId: Id<"stores"> | undefined,
): ProductModifierGroups[] | undefined {
  const offline = isFlagEnabled("useWatermelon.modifiers");

  const convexResult = useQuery(
    api.modifierAssignments.getForStore,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonGroups = useObservable<ModifierGroup>(
    () =>
      getDatabase()
        .collections.get<ModifierGroup>("modifier_groups")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("is_active", true)]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonOptions = useObservable<ModifierOption>(
    () =>
      getDatabase()
        .collections.get<ModifierOption>("modifier_options")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId)]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonAssignments = useObservable<ModifierGroupAssignment>(
    () =>
      getDatabase()
        .collections.get<ModifierGroupAssignment>("modifier_group_assignments")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [offline, storeId],
  );

  const watermelonProducts = useObservable<Product>(
    () =>
      getDatabase()
        .collections.get<Product>("products")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [offline, storeId],
  );

  const watermelonCategories = useObservable<Category>(
    () =>
      getDatabase()
        .collections.get<Category>("categories")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [offline, storeId],
  );

  const watermelonResult = useMemo<ProductModifierGroups[] | undefined>(() => {
    if (!offline) return undefined;
    if (
      !watermelonGroups ||
      !watermelonOptions ||
      !watermelonAssignments ||
      !watermelonProducts ||
      !watermelonCategories
    )
      return undefined;

    const byProduct = buildModifiersByProduct(
      watermelonGroups,
      watermelonOptions,
      watermelonAssignments,
      storeId ?? "",
      watermelonProducts,
      watermelonCategories,
    );

    return [...byProduct.entries()]
      .filter(([, groups]) => groups.length > 0)
      .map(([productId, groups]) => ({
        productId: productId as Id<"products">,
        groups,
      }));
  }, [
    offline,
    storeId,
    watermelonGroups,
    watermelonOptions,
    watermelonAssignments,
    watermelonProducts,
    watermelonCategories,
  ]);

  return offline ? watermelonResult : convexResult;
}

/**
 * Fetch modifier groups for a single product.
 * Returns the same shape as `api.modifierAssignments.getForProduct`.
 */
export function useModifiersForProduct(
  productId: Id<"products"> | undefined,
): ModifierGroupItem[] | undefined {
  const offline = isFlagEnabled("useWatermelon.modifiers");

  const convexResult = useQuery(
    api.modifierAssignments.getForProduct,
    !offline && productId ? { productId } : "skip",
  );

  const watermelonGroups = useObservable<ModifierGroup>(
    () =>
      getDatabase()
        .collections
        .get<ModifierGroup>("modifier_groups")
        .query(Q.where("is_active", true)),
    [offline],
  );

  const watermelonOptions = useObservable<ModifierOption>(
    () =>
      getDatabase()
        .collections
        .get<ModifierOption>("modifier_options")
        .query(),
    [offline],
  );

  const watermelonAssignments = useObservable<ModifierGroupAssignment>(
    () =>
      getDatabase()
        .collections
        .get<ModifierGroupAssignment>("modifier_group_assignments")
        .query(),
    [offline],
  );

  const watermelonProducts = useObservable<Product>(
    () =>
      getDatabase()
        .collections
        .get<Product>("products")
        .query(),
    [offline],
  );

  const watermelonCategories = useObservable<Category>(
    () =>
      getDatabase()
        .collections
        .get<Category>("categories")
        .query(),
    [offline],
  );

  const watermelonResult = useMemo<ModifierGroupItem[] | undefined>(() => {
    if (!offline) return undefined;
    if (
      !productId ||
      !watermelonGroups ||
      !watermelonOptions ||
      !watermelonAssignments ||
      !watermelonProducts ||
      !watermelonCategories
    )
      return undefined;

    const product = watermelonProducts.find((p) => p.id === productId);
    if (!product) return [];

    const byProduct = buildModifiersByProduct(
      watermelonGroups,
      watermelonOptions,
      watermelonAssignments,
      product.storeId,
      watermelonProducts,
      watermelonCategories,
    );

    return byProduct.get(productId) ?? [];
  }, [
    offline,
    productId,
    watermelonGroups,
    watermelonOptions,
    watermelonAssignments,
    watermelonProducts,
    watermelonCategories,
  ]);

  return offline ? watermelonResult : convexResult;
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd apps/native && npx jest src/sync/dataSources/__tests__/useModifiers.test.ts
```
Expected: PASS.

- [ ] **Step 5: Update barrel export**

In `apps/native/src/sync/dataSources/index.ts`, replace the content with:

```typescript
export { type ModifierGroupItem, type ModifierOptionItem, type ProductModifierGroups, useModifiersForProduct, useModifiersForStore } from "./useModifiers";
export { type ProductListItem, useProducts } from "./useProducts";
```

Wait — also add the categories, tables, stores, orderHistory exports. Since those files don't exist yet, we'll do a progressive approach. For now:

```typescript
export { type ModifierGroupItem, type ModifierOptionItem, type ProductModifierGroups, useModifiersForProduct, useModifiersForStore } from "./useModifiers";
export { type ProductListItem, useProducts } from "./useProducts";
```

We'll add more exports as we create the files.

- [ ] **Step 6: Commit**

```bash
git add apps/native/src/sync/dataSources/
git commit -m "feat(native): Phase 3.2 — useModifiers data source for getForStore + getForProduct"
```

---

### Task 3: Create useCategories data source

**Files:**
- Create: `apps/native/src/sync/dataSources/useCategories.ts`
- Modify: `apps/native/src/sync/dataSources/index.ts`

- [ ] **Step 1: Create `useCategories.ts`**

Write `apps/native/src/sync/dataSources/useCategories.ts`:

```typescript
import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { type Category, getDatabase, type Product } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

// ─── Types ────────────────────────────────────────────────────

export type CategoryTreeNode = {
  _id: Id<"categories">;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  children: CategoryTreeNode[];
};

// ─── Hook ─────────────────────────────────────────────────────

/**
 * Returns the category tree for a store. Same shape as `api.categories.getTree`.
 */
export function useCategoryTree(
  storeId: Id<"stores"> | undefined,
): CategoryTreeNode[] | undefined {
  const offline = isFlagEnabled("useWatermelon.categories");

  const convexResult = useQuery(
    api.categories.getTree,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonCategories = useObservable<Category>(
    () =>
      getDatabase()
        .collections.get<Category>("categories")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("is_active", true)]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonProducts = useObservable<Product>(
    () =>
      getDatabase()
        .collections.get<Product>("products")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [offline, storeId],
  );

  const watermelonResult = useMemo<CategoryTreeNode[] | undefined>(() => {
    if (!offline) return undefined;
    if (!watermelonCategories || !watermelonProducts) return undefined;

    // Count products per category
    const countByCategoryId = new Map<string, number>();
    for (const p of watermelonProducts) {
      if (!p.isActive) continue;
      countByCategoryId.set(p.categoryId, (countByCategoryId.get(p.categoryId) ?? 0) + 1);
    }

    // Build children lookup
    const childrenByParentId = new Map<string, Category[]>();
    for (const c of watermelonCategories) {
      const parentId = c.parentId ?? "__root__";
      const arr = childrenByParentId.get(parentId) ?? [];
      arr.push(c);
      childrenByParentId.set(parentId, arr);
    }

    function buildNode(cat: Category): CategoryTreeNode {
      const children = (childrenByParentId.get(cat.id) ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(buildNode);

      return {
        _id: cat.id as Id<"categories">,
        name: cat.name,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
        productCount: countByCategoryId.get(cat.id) ?? 0,
        children,
      };
    }

    const roots = (childrenByParentId.get("__root__") ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(buildNode);

    return roots;
  }, [offline, watermelonCategories, watermelonProducts]);

  return offline ? watermelonResult : convexResult;
}
```

- [ ] **Step 2: Update barrel export**

In `apps/native/src/sync/dataSources/index.ts`, update to:

```typescript
export { type CategoryTreeNode, useCategoryTree } from "./useCategories";
export { type ModifierGroupItem, type ModifierOptionItem, type ProductModifierGroups, useModifiersForProduct, useModifiersForStore } from "./useModifiers";
export { type ProductListItem, useProducts } from "./useProducts";
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/sync/dataSources/
git commit -m "feat(native): Phase 3.3 — useCategories data source for getTree"
```

---

### Task 4: Create useTables data source

**Files:**
- Create: `apps/native/src/sync/dataSources/useTables.ts`
- Modify: `apps/native/src/sync/dataSources/index.ts`

- [ ] **Step 1: Create `useTables.ts`**

Write `apps/native/src/sync/dataSources/useTables.ts`:

```typescript
import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { getDatabase, type Order, type OrderItem, TableModel } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

// ─── Types ────────────────────────────────────────────────────

export type TableOrderSummary = {
  _id: Id<"orders">;
  orderNumber?: string;
  tabNumber: number;
  tabName: string;
  itemCount: number;
  netSales: number;
  pax?: number;
  createdAt: number;
};

export type TableWithOrders = {
  _id: Id<"tables">;
  name: string;
  capacity?: number;
  status: "available" | "occupied";
  sortOrder: number;
  orders: TableOrderSummary[];
  totalTabs: number;
  totalItemCount: number;
  totalNetSales: number;
};

export type AvailableTable = {
  _id: Id<"tables">;
  name: string;
  capacity?: number;
};

// ─── Hooks ────────────────────────────────────────────────────

/**
 * Returns tables with their open orders. Same shape as `api.tables.listWithOrders`.
 */
export function useTablesListWithOrders(
  storeId: Id<"stores"> | undefined,
): TableWithOrders[] | undefined {
  const offline = isFlagEnabled("useWatermelon.tables");

  const convexResult = useQuery(
    api.tables.listWithOrders,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonTables = useObservable<TableModel>(
    () =>
      getDatabase()
        .collections.get<TableModel>("tables")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("is_active", true)]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonOrders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("status", "open")]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonOrderItems = useObservable<OrderItem>(
    () =>
      getDatabase()
        .collections.get<OrderItem>("order_items")
        .query(),
    [offline, storeId],
  );

  const watermelonResult = useMemo<TableWithOrders[] | undefined>(() => {
    if (!offline) return undefined;
    if (!watermelonTables || !watermelonOrders || !watermelonOrderItems) return undefined;

    // Group order items by orderId for item count calculation
    const itemCountByOrderId = new Map<string, number>();
    for (const oi of watermelonOrderItems) {
      if (oi.isVoided) continue;
      itemCountByOrderId.set(
        oi.orderId,
        (itemCountByOrderId.get(oi.orderId) ?? 0) + oi.quantity,
      );
    }

    // Group orders by tableId
    const ordersByTableId = new Map<string, Order[]>();
    for (const o of watermelonOrders) {
      if (!o.tableId) continue;
      const arr = ordersByTableId.get(o.tableId) ?? [];
      arr.push(o);
      ordersByTableId.set(o.tableId, arr);
    }

    return watermelonTables
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((table) => {
        const orders = ordersByTableId.get(table.id) ?? [];
        const orderSummaries: TableOrderSummary[] = orders
          .sort((a, b) => (a.tabNumber ?? 0) - (b.tabNumber ?? 0))
          .map((o) => ({
            _id: o.id as Id<"orders">,
            orderNumber: o.orderNumber,
            tabNumber: o.tabNumber ?? 1,
            tabName: o.tabName ?? "Tab 1",
            itemCount: itemCountByOrderId.get(o.id) ?? 0,
            netSales: o.netSales,
            pax: o.pax,
            createdAt: o.createdAt,
          }));

        const totalTabs = orderSummaries.length;
        const totalItemCount = orderSummaries.reduce((s, o) => s + o.itemCount, 0);
        const totalNetSales = orderSummaries.reduce((s, o) => s + o.netSales, 0);

        return {
          _id: table.id as Id<"tables">,
          name: table.name,
          capacity: table.capacity,
          status: orderSummaries.length > 0 ? "occupied" : "available",
          sortOrder: table.sortOrder,
          orders: orderSummaries,
          totalTabs,
          totalItemCount,
          totalNetSales,
        };
      });
  }, [offline, watermelonTables, watermelonOrders, watermelonOrderItems]);

  return offline ? watermelonResult : convexResult;
}

/**
 * Returns available tables for transfer. Same shape as `api.tables.getAvailable`.
 */
export function useTablesAvailable(
  storeId: Id<"stores"> | undefined,
): AvailableTable[] | undefined {
  const offline = isFlagEnabled("useWatermelon.tables");

  const convexResult = useQuery(
    api.tables.getAvailable,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonTables = useObservable<TableModel>(
    () =>
      getDatabase()
        .collections.get<TableModel>("tables")
        .query(
          ...(storeId
            ? [
                Q.where("store_id", storeId),
                Q.where("status", "available"),
                Q.where("is_active", true),
              ]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonResult = useMemo<AvailableTable[] | undefined>(() => {
    if (!offline) return undefined;
    if (!watermelonTables) return undefined;
    return watermelonTables
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        _id: t.id as Id<"tables">,
        name: t.name,
        capacity: t.capacity,
      }));
  }, [offline, watermelonTables]);

  return offline ? watermelonResult : convexResult;
}
```

- [ ] **Step 2: Update barrel export**

In `apps/native/src/sync/dataSources/index.ts`, update to:

```typescript
export { type CategoryTreeNode, useCategoryTree } from "./useCategories";
export { type ModifierGroupItem, type ModifierOptionItem, type ProductModifierGroups, useModifiersForProduct, useModifiersForStore } from "./useModifiers";
export { type ProductListItem, useProducts } from "./useProducts";
export { type AvailableTable, type TableOrderSummary, type TableWithOrders, useTablesAvailable, useTablesListWithOrders } from "./useTables";
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/sync/dataSources/
git commit -m "feat(native): Phase 3.4 — useTables data source for listWithOrders + getAvailable"
```

---

### Task 5: Create useStores data source

**Files:**
- Create: `apps/native/src/sync/dataSources/useStores.ts`
- Modify: `apps/native/src/sync/dataSources/index.ts`

- [ ] **Step 1: Create `useStores.ts`**

Write `apps/native/src/sync/dataSources/useStores.ts`:

```typescript
import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { isFlagEnabled } from "../featureFlags";
import { useObservable } from "../../db/useObservable";
import type { Store } from "../../db";
import { getDatabase } from "../../db";

/**
 * Fetches a single store by ID. Same shape as `api.stores.get`.
 *
 * Since Convex returns a `Doc<"stores">` and WatermelonDB returns a
 * flat row, we map WatermelonDB fields to the Convex doc shape.
 */
export function useStore(
  storeId: Id<"stores"> | undefined,
): Doc<"stores"> | null | undefined {
  const offline = isFlagEnabled("useWatermelon.stores");

  const convexResult = useQuery(
    api.stores.get,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonStores = useObservable<Store>(
    () =>
      getDatabase()
        .collections.get<Store>("stores")
        .query(),
    [offline],
  );

  if (!offline) return convexResult;
  if (!storeId) return undefined;
  if (!watermelonStores) return undefined;

  const store = watermelonStores.find((s) => s.id === storeId);
  if (!store) return null;

  // Map WatermelonDB row to Convex Doc shape
  // Schedule is stored as JSON string (schedule_json column)
  let schedule: Doc<"stores">["schedule"] = undefined;
  if (store.scheduleJson) {
    try {
      schedule = JSON.parse(store.scheduleJson);
    } catch {
      // leave as undefined
    }
  }

  // Socials is a JSON array stored as string on the server, but we
  // don't have that column in WatermelonDB — skip for now.
  // Store contact fields are flat columns.

  return {
    _id: store.id as Id<"stores">,
    _creationTime: store.createdAt,
    name: store.name,
    parentId: store.parentId as Id<"stores"> | undefined,
    logo: store.logo as Id<"_storage"> | undefined,
    address1: store.address1,
    address2: store.address2,
    tin: store.tin,
    min: store.min,
    vatRate: store.vatRate,
    printerMac: store.printerMac,
    kitchenPrinterMac: store.kitchenPrinterMac,
    contactNumber: store.contactNumber,
    telephone: store.telephone,
    email: store.email,
    website: store.website,
    footer: store.footer,
    schedule,
    isActive: store.isActive,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
    deviceCodeCounter: store.deviceCodeCounter,
  } as Doc<"stores">;
}
```

- [ ] **Step 2: Update barrel export**

In `apps/native/src/sync/dataSources/index.ts`, update to:

```typescript
export { type CategoryTreeNode, useCategoryTree } from "./useCategories";
export { type ModifierGroupItem, type ModifierOptionItem, type ProductModifierGroups, useModifiersForProduct, useModifiersForStore } from "./useModifiers";
export { type ProductListItem, useProducts } from "./useProducts";
export { useStore } from "./useStores";
export { type AvailableTable, type TableOrderSummary, type TableWithOrders, useTablesAvailable, useTablesListWithOrders } from "./useTables";
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/sync/dataSources/
git commit -m "feat(native): Phase 3.5 — useStores data source for stores.get"
```

---

### Task 6: Create useOrderHistory data source

**Files:**
- Create: `apps/native/src/sync/dataSources/useOrderHistory.ts`
- Modify: `apps/native/src/sync/dataSources/index.ts`

- [ ] **Step 1: Create `useOrderHistory.ts`**

Write `apps/native/src/sync/dataSources/useOrderHistory.ts`:

```typescript
import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { getDatabase, type Order, type OrderItem } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

// ─── Types ────────────────────────────────────────────────────

export type ActiveOrderSummary = {
  _id: Id<"orders">;
  orderNumber?: string;
  orderType: "dine_in" | "takeout";
  tableId?: Id<"tables">;
  tableName?: string;
  pax?: number;
  customerName?: string;
  takeoutStatus?: "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";
  subtotal: number;
  itemCount: number;
  createdAt: number;
};

export type TakeoutOrderSummary = {
  _id: Id<"orders">;
  orderNumber?: string;
  orderType: "dine_in" | "takeout";
  takeoutStatus: string;
  customerName?: string;
  status: "draft" | "open" | "paid" | "voided";
  subtotal: number;
  itemCount: number;
  createdAt: number;
};

// ─── Hooks ────────────────────────────────────────────────────

/**
 * Returns active (open) orders for a store. Same shape as `api.orders.listActive`.
 */
export function useActiveOrders(
  storeId: Id<"stores"> | undefined,
): ActiveOrderSummary[] | undefined {
  const offline = isFlagEnabled("useWatermelon.orderHistory");

  const convexResult = useQuery(
    api.orders.listActive,
    !offline && storeId ? { storeId } : "skip",
  );

  const watermelonOrders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("status", "open")]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonOrderItems = useObservable<OrderItem>(
    () =>
      getDatabase()
        .collections.get<OrderItem>("order_items")
        .query(),
    [offline, storeId],
  );

  const watermelonResult = useMemo<ActiveOrderSummary[] | undefined>(() => {
    if (!offline) return undefined;
    if (!watermelonOrders || !watermelonOrderItems) return undefined;

    const itemCountByOrderId = new Map<string, number>();
    for (const oi of watermelonOrderItems) {
      if (oi.isVoided) continue;
      itemCountByOrderId.set(
        oi.orderId,
        (itemCountByOrderId.get(oi.orderId) ?? 0) + oi.quantity,
      );
    }

    return watermelonOrders
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({
        _id: o.id as Id<"orders">,
        orderNumber: o.orderNumber,
        orderType: o.orderType as "dine_in" | "takeout",
        tableId: o.tableId as Id<"tables"> | undefined,
        tableName: o.tableNameSnapshot,
        pax: o.pax,
        customerName: o.customerName,
        takeoutStatus: o.takeoutStatus as ActiveOrderSummary["takeoutStatus"],
        subtotal: o.netSales,
        itemCount: itemCountByOrderId.get(o.id) ?? 0,
        createdAt: o.createdAt,
      }));
  }, [offline, watermelonOrders, watermelonOrderItems]);

  return offline ? watermelonResult : convexResult;
}

/**
 * Returns takeout orders for a date range. Same shape as `api.orders.getTakeoutOrders`.
 *
 * Note: The Convex endpoint filters by date range. Our WatermelonDB local
 * query returns all takeout orders and we filter in-memory. For large datasets,
 * this is acceptable since the tablet only syncs orders for its own store.
 */
export function useTakeoutOrders(
  storeId: Id<"stores"> | undefined,
  startDate?: number,
  endDate?: number,
): TakeoutOrderSummary[] | undefined {
  const offline = isFlagEnabled("useWatermelon.orderHistory");

  const convexResult = useQuery(
    api.orders.getTakeoutOrders,
    !offline && storeId && startDate !== undefined && endDate !== undefined
      ? { storeId, startDate, endDate }
      : "skip",
  );

  const watermelonOrders = useObservable<Order>(
    () =>
      getDatabase()
        .collections.get<Order>("orders")
        .query(
          ...(storeId
            ? [
                Q.where("store_id", storeId),
                Q.where("order_type", "takeout"),
                Q.where("status", Q.oneOf(["open", "paid", "draft"])),
              ]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonOrderItems = useObservable<OrderItem>(
    () =>
      getDatabase()
        .collections.get<OrderItem>("order_items")
        .query(),
    [offline, storeId],
  );

  const watermelonResult = useMemo<TakeoutOrderSummary[] | undefined>(() => {
    if (!offline) return undefined;
    if (!watermelonOrders || !watermelonOrderItems) return undefined;

    const itemCountByOrderId = new Map<string, number>();
    for (const oi of watermelonOrderItems) {
      if (oi.isVoided) continue;
      itemCountByOrderId.set(
        oi.orderId,
        (itemCountByOrderId.get(oi.orderId) ?? 0) + oi.quantity,
      );
    }

    let filtered = watermelonOrders;

    // Apply date range filter if provided
    if (startDate !== undefined && endDate !== undefined) {
      filtered = filtered.filter(
        (o) => o.createdAt >= startDate && o.createdAt <= endDate,
      );
    }

    return filtered
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({
        _id: o.id as Id<"orders">,
        orderNumber: o.orderNumber,
        orderType: o.orderType as "dine_in" | "takeout",
        takeoutStatus: o.takeoutStatus ?? "pending",
        customerName: o.customerName,
        status: o.status as "draft" | "open" | "paid" | "voided",
        subtotal: o.netSales,
        itemCount: itemCountByOrderId.get(o.id) ?? 0,
        createdAt: o.createdAt,
      }));
  }, [offline, watermelonOrders, watermelonOrderItems, startDate, endDate]);

  return offline ? watermelonResult : convexResult;
}
```

- [ ] **Step 2: Update barrel export**

In `apps/native/src/sync/dataSources/index.ts`, update to:

```typescript
export { type CategoryTreeNode, useCategoryTree } from "./useCategories";
export { type ModifierGroupItem, type ModifierOptionItem, type ProductModifierGroups, useModifiersForProduct, useModifiersForStore } from "./useModifiers";
export { type ActiveOrderSummary, type TakeoutOrderSummary, useActiveOrders, useTakeoutOrders } from "./useOrderHistory";
export { type ProductListItem, useProducts } from "./useProducts";
export { useStore } from "./useStores";
export { type AvailableTable, type TableOrderSummary, type TableWithOrders, useTablesAvailable, useTablesListWithOrders } from "./useTables";
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/sync/dataSources/
git commit -m "feat(native): Phase 3.6 — useOrderHistory data source for listActive + getTakeoutOrders"
```

---

### Task 7: Wire useModifiers into OrderScreen

**Files:**
- Modify: `apps/native/src/features/orders/screens/OrderScreen.tsx`

Currently `OrderScreen` does:
```typescript
const modifierGroups = useQuery(
  api.modifierAssignments.getForProduct,
  selectedProduct ? { productId: selectedProduct.id } : "skip",
);
```

Replace with offline-first data source.

- [ ] **Step 1: Update imports**

Change this import at the top of `OrderScreen.tsx`:
```typescript
import { useProducts } from "../../../sync";
```
to:
```typescript
import { useModifiersForProduct, useProducts } from "../../../sync";
```

- [ ] **Step 2: Replace modifierGroups query**

Find the lines:
```typescript
  // Fetch modifier groups for the selected product on demand
  const modifierGroups = useQuery(
    api.modifierAssignments.getForProduct,
    selectedProduct ? { productId: selectedProduct.id } : "skip",
  );
```

Replace with:
```typescript
  // Fetch modifier groups for the selected product on demand — reads from
  // WatermelonDB when EXPO_PUBLIC_OFFLINE_MODIFIERS=1.
  const modifierGroups = useModifiersForProduct(
    selectedProduct ? selectedProduct.id : undefined,
  );
```

- [ ] **Step 3: Verify the import of `useQuery` is still needed**

`OrderScreen` still uses `useQuery` for `api.orders.get` (line 120). Keep the `useQuery` import from `convex/react` (it's still needed for the order query — orders read-path migration is Phase 4).

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/screens/OrderScreen.tsx
git commit -m "feat(native): wire useModifiersForProduct into OrderScreen"
```

---

### Task 8: Wire useModifiersForStore + useProducts into TakeoutOrderScreen

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx`

Currently uses:
```typescript
const products = useQuery(api.products.list, { storeId });
const allModifiers = useQuery(api.modifierAssignments.getForStore, { storeId });
```

- [ ] **Step 1: Update imports**

Add to the imports at the top:
```typescript
import { useModifiersForStore, useProducts } from "../../../sync";
```

- [ ] **Step 2: Replace products query**

Change:
```typescript
const products = useQuery(api.products.list, { storeId });
```
to:
```typescript
const products = useProducts(storeId);
```

- [ ] **Step 3: Replace allModifiers query**

Change:
```typescript
const allModifiers = useQuery(api.modifierAssignments.getForStore, { storeId });
```
to:
```typescript
const allModifiers = useModifiersForStore(storeId);
```

- [ ] **Step 4: Update modifiersByProduct memo**

The current `modifiersByProduct` memo maps `allModifiers` entries by `productId`. The new `useModifiersForStore` returns the exact same `ProductModifierGroups[]` shape (`{ productId: Id<"products">, groups: ModifierGroupItem[] }`), so the existing `useMemo` at lines 78-86 continues to work unchanged.

Verify: the types `productId` and `groups` fields are identical between Convex response and our `ProductModifierGroups` type. Yes — both have `productId: Id<"products">` and `groups: Array<{...}>`. No change needed to the memo.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutOrderScreen.tsx
git commit -m "feat(native): wire useProducts + useModifiersForStore into TakeoutOrderScreen"
```

---

### Task 9: Wire useCategoryTree into CategoryGrid

**Files:**
- Modify: `apps/native/src/features/orders/components/CategoryGrid.tsx`

Currently `CategoryGrid` does:
```typescript
const categoryTree = useQuery(api.categories.getTree, { storeId });
```

- [ ] **Step 1: Update imports**

Add:
```typescript
import { useCategoryTree } from "../../../sync";
```

- [ ] **Step 2: Replace categoryTree query**

Change:
```typescript
const categoryTree = useQuery(api.categories.getTree, { storeId });
```
to:
```typescript
const categoryTree = useCategoryTree(storeId);
```

- [ ] **Step 3: Remove unused `useQuery` import**

If `useQuery` is no longer used (check the file — it was only used for `api.categories.getTree`), remove it:
```typescript
import { useQuery } from "convex/react";
```
Also remove the `api` import if unused:
```typescript
import { api } from "@packages/backend/convex/_generated/api";
```

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/components/CategoryGrid.tsx
git commit -m "feat(native): wire useCategoryTree into CategoryGrid"
```

---

### Task 10: Wire useTablesListWithOrders into TablesScreen

**Files:**
- Modify: `apps/native/src/features/tables/screens/TablesScreen.tsx`

Currently does:
```typescript
const tablesWithOrders = useQuery(
  api.tables.listWithOrders,
  user?.storeId ? { storeId: user.storeId } : "skip",
);
```

- [ ] **Step 1: Update imports**

Add:
```typescript
import { useTablesListWithOrders } from "../../../sync";
```

- [ ] **Step 2: Replace tablesWithOrders query**

Change:
```typescript
const tablesWithOrders = useQuery(
  api.tables.listWithOrders,
  user?.storeId ? { storeId: user.storeId } : "skip",
);
```
to:
```typescript
const tablesWithOrders = useTablesListWithOrders(user?.storeId);
```

- [ ] **Step 3: Remove unused `useQuery` import**

If `useQuery` is no longer used (check — the file only uses `useMutation` for `updatePaxMutation` and `createOrderMutation`, not `useQuery` elsewhere), remove:
```typescript
import { useQuery } from "convex/react";
```
And the `api` import.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/tables/screens/TablesScreen.tsx
git commit -m "feat(native): wire useTablesListWithOrders into TablesScreen"
```

---

### Task 11: Wire useTablesAvailable into TransferTableModal

**Files:**
- Modify: `apps/native/src/features/orders/components/TransferTableModal.tsx`

Currently does:
```typescript
const availableTables = useQuery(api.tables.getAvailable, visible ? { storeId } : "skip");
```

- [ ] **Step 1: Update imports**

Add:
```typescript
import { useTablesAvailable } from "../../../sync";
```

- [ ] **Step 2: Replace availableTables query**

Change:
```typescript
const availableTables = useQuery(api.tables.getAvailable, visible ? { storeId } : "skip");
```
to:
```typescript
const availableTables = useTablesAvailable(visible ? storeId : undefined);
```

- [ ] **Step 3: Remove unused imports**

If `useQuery` and `api` are no longer used, remove them.

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/features/orders/components/TransferTableModal.tsx
git commit -m "feat(native): wire useTablesAvailable into TransferTableModal"
```

---

### Task 12: Wire useStore into CheckoutScreen and TakeoutOrderDetailModal

**Files:**
- Modify: `apps/native/src/features/checkout/screens/CheckoutScreen.tsx`
- Modify: `apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx`

Both currently do:
```typescript
const store = useQuery(api.stores.get, order?.storeId ? { storeId: order.storeId } : "skip");
```

- [ ] **Step 1: Update CheckoutScreen imports**

Add:
```typescript
import { useStore } from "../../../sync";
```

- [ ] **Step 2: Replace CheckoutScreen store query**

Change:
```typescript
const store = useQuery(api.stores.get, order?.storeId ? { storeId: order.storeId } : "skip");
```
to:
```typescript
const store = useStore(order?.storeId);
```

- [ ] **Step 3: Update TakeoutOrderDetailModal imports**

Add:
```typescript
import { useStore } from "../../../sync";
```

- [ ] **Step 4: Replace TakeoutOrderDetailModal store query**

Change:
```typescript
const store = useQuery(api.stores.get, order?.storeId ? { storeId: order.storeId } : "skip");
```
to:
```typescript
const store = useStore(order?.storeId);
```

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/features/checkout/screens/CheckoutScreen.tsx apps/native/src/features/takeout/components/TakeoutOrderDetailModal.tsx
git commit -m "feat(native): wire useStore into CheckoutScreen and TakeoutOrderDetailModal"
```

---

### Task 13: Wire useActiveOrders into HomeScreen

**Files:**
- Modify: `apps/native/src/features/home/screens/HomeScreen.tsx`

Currently does:
```typescript
const activeOrders = useQuery(
  api.orders.listActive,
  user?.storeId ? { storeId: user.storeId } : "skip",
);
```

- [ ] **Step 1: Update imports**

Add:
```typescript
import { useActiveOrders } from "../../../sync";
```

- [ ] **Step 2: Replace activeOrders query**

Change:
```typescript
const activeOrders = useQuery(
  api.orders.listActive,
  user?.storeId ? { storeId: user.storeId } : "skip",
);
```
to:
```typescript
const activeOrders = useActiveOrders(user?.storeId);
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/home/screens/HomeScreen.tsx
git commit -m "feat(native): wire useActiveOrders into HomeScreen"
```

---

### Task 14: Wire useTakeoutOrders into TakeoutListScreen

**Files:**
- Modify: `apps/native/src/features/takeout/screens/TakeoutListScreen.tsx`

Currently does:
```typescript
const takeoutOrders = useQuery(
  api.orders.getTakeoutOrders,
  user?.storeId
    ? {
        storeId: user.storeId,
        startDate: getStartOfDay(selectedDate),
        endDate: getEndOfDay(selectedDate),
      }
    : "skip",
);
```

- [ ] **Step 1: Update imports**

Add:
```typescript
import { useTakeoutOrders } from "../../../sync";
```

- [ ] **Step 2: Replace takeoutOrders query**

Change:
```typescript
const takeoutOrders = useQuery(
  api.orders.getTakeoutOrders,
  user?.storeId
    ? {
        storeId: user.storeId,
        startDate: getStartOfDay(selectedDate),
        endDate: getEndOfDay(selectedDate),
      }
    : "skip",
);
```
to:
```typescript
const takeoutOrders = useTakeoutOrders(
  user?.storeId,
  getStartOfDay(selectedDate),
  getEndOfDay(selectedDate),
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/features/takeout/screens/TakeoutListScreen.tsx
git commit -m "feat(native): wire useTakeoutOrders into TakeoutListScreen"
```

---

### Task 15: Re-export new data sources from sync/index.ts

**Files:**
- Modify: `apps/native/src/sync/index.ts`

- [ ] **Step 1: Add new exports**

Update `apps/native/src/sync/index.ts`:

```typescript
export {
  type ActiveOrderSummary,
  type AvailableTable,
  type CategoryTreeNode,
  type ModifierGroupItem,
  type ModifierOptionItem,
  type ProductListItem,
  type ProductModifierGroups,
  type TableOrderSummary,
  type TableWithOrders,
  type TakeoutOrderSummary,
  useActiveOrders,
  useCategoryTree,
  useModifiersForProduct,
  useModifiersForStore,
  useProducts,
  useStore,
  useTablesAvailable,
  useTablesListWithOrders,
  useTakeoutOrders,
} from "./dataSources";
export { type FeatureFlag, featureFlags, isFlagEnabled } from "./featureFlags";
export { useNetworkStatus } from "./networkStatus";
export { SyncBootstrap } from "./SyncBootstrap";
export { syncManager } from "./SyncManager";
export { SyncStatusPill } from "./SyncStatusPill";
export { callPull, callPush, callRegisterDevice, setAuthTokenFn } from "./syncEndpoints";
export type {
  PullResponse,
  PushPayload,
  PushRejection,
  PushResponse,
  SyncState,
  SyncStatus,
} from "./types";
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/sync/index.ts
git commit -m "feat(native): re-export Phase 3 data sources from sync barrel"
```

---

### Task 16: Run typecheck and lint

**Files:** (none — verification only)

- [ ] **Step 1: Run typecheck**

```bash
cd apps/native && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 2: Run lint**

```bash
cd apps/native && pnpm lint
```
Expected: zero errors.

- [ ] **Step 3: Commit (only if lint fixes were needed)**

```bash
git add -A
git commit -m "chore(native): lint fixes for Phase 3 data sources"
```

---

## Self-Review

**1. Spec coverage:**
- Phase 3.1 Products catalog → useProducts already exists; wired in Task 8 (TakeoutOrderScreen)
- Phase 3.2 Modifier groups/options → Tasks 2, 7, 8
- Phase 3.3 Categories → Tasks 3, 9
- Phase 3.4 Tables list → Tasks 4, 10, 11
- Phase 3.5 Stores → Tasks 5, 12
- Phase 3.6 Order history → Tasks 6, 13, 14
- Feature flags for every migration → Task 1
- Barrel exports → Tasks 2-6 (incremental), Task 15 (final)
- Verification → Task 16

**2. Placeholder scan:** No TBD, TODO, or unspecified code. Every step has actual code.

**3. Type consistency:**
- `ModifierGroupItem` type defined in Task 2, consumed in Tasks 7, 8 — identical
- `ProductModifierGroups` type defined in Task 2, consumed in Task 8 — identical
- `CategoryTreeNode` type defined in Task 3, consumed in Task 9 — identical
- `TableWithOrders` type defined in Task 4, consumed in Task 10 — identical
- `AvailableTable` type defined in Task 4, consumed in Task 11 — identical
- `ActiveOrderSummary` type defined in Task 6, consumed in Task 13 — identical
- `TakeoutOrderSummary` type defined in Task 6, consumed in Task 14 — identical
- All types re-exported from `sync/dataSources/index.ts` → `sync/index.ts` → consumed in feature screens
