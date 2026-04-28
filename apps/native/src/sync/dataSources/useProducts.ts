import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { type Category, getDatabase, type ModifierGroupAssignment, type Product } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

/**
 * Shape returned by api.products.list — clients expect this exact object.
 * When the WatermelonDB path is active, we compute the same shape locally.
 */
export type ProductListItem = {
  _id: Id<"products">;
  storeId: Id<"stores">;
  name: string;
  categoryId: Id<"categories">;
  categoryName: string;
  price: number;
  isVatable: boolean;
  isActive: boolean;
  isOpenPrice?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  hasModifiers: boolean;
};

/**
 * Data-source picker for the products catalog. When the
 * `useWatermelon.products` flag is on, reads from local SQLite via
 * WatermelonDB observables; otherwise falls through to Convex's reactive
 * `useQuery`.
 *
 * Returns `undefined` during initial load (matches Convex's loading
 * convention) — call sites that special-case `useQuery === undefined`
 * continue to work unchanged.
 */
export function useProducts(storeId: Id<"stores"> | undefined): ProductListItem[] | undefined {
  const offline = isFlagEnabled("useWatermelon.products");

  // Always call hooks in the same order — gate the data sources internally.
  const convexResult = useQuery(api.products.list, !offline && storeId ? { storeId } : "skip");

  const watermelonProducts = useObservable<Product>(
    () =>
      getDatabase()
        .collections.get<Product>("products")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("is_active", true)]
            : [Q.where("store_id", "__none__")]),
        ),
    [offline, storeId],
  );

  const watermelonCategories = useObservable<Category>(
    () =>
      getDatabase()
        .collections.get<Category>("categories")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [offline, storeId],
  );

  const watermelonAssignments = useObservable<ModifierGroupAssignment>(
    () =>
      getDatabase()
        .collections.get<ModifierGroupAssignment>("modifier_group_assignments")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [offline, storeId],
  );

  const watermelonResult = useMemo<ProductListItem[] | undefined>(() => {
    if (!offline) return undefined;
    if (!watermelonProducts || !watermelonCategories || !watermelonAssignments) return undefined;

    // Build category name lookup
    const categoryById = new Map<string, Category>();
    for (const c of watermelonCategories) categoryById.set(c.id, c);

    // Build category-chain lookup (id → ancestor ids including self)
    const chainCache = new Map<string, Set<string>>();
    const chainFor = (catId: string): Set<string> => {
      const cached = chainCache.get(catId);
      if (cached) return cached;
      const chain = new Set<string>();
      let cursor: string | undefined = catId;
      while (cursor) {
        chain.add(cursor);
        const parent: string | undefined = categoryById.get(cursor)?.parentId;
        if (!parent || chain.has(parent)) break;
        cursor = parent;
      }
      chainCache.set(catId, chain);
      return chain;
    };

    // Index assignments for fast hasModifiers lookups
    const productHasMods = new Set<string>();
    const categoryHasMods = new Set<string>();
    for (const a of watermelonAssignments) {
      if (a.productId) productHasMods.add(a.productId);
      if (a.categoryId) categoryHasMods.add(a.categoryId);
    }

    return watermelonProducts
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => {
        const cat = categoryById.get(p.categoryId);
        const hasModifiers =
          productHasMods.has(p.id) ||
          [...chainFor(p.categoryId)].some((id) => categoryHasMods.has(id));
        return {
          _id: p.id as Id<"products">,
          storeId: p.storeId as Id<"stores">,
          name: p.name,
          categoryId: p.categoryId as Id<"categories">,
          categoryName: cat?.name ?? "",
          price: p.price,
          isVatable: p.isVatable,
          isActive: p.isActive,
          isOpenPrice: p.isOpenPrice,
          minPrice: p.minPrice,
          maxPrice: p.maxPrice,
          sortOrder: p.sortOrder,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          hasModifiers,
        };
      });
  }, [offline, watermelonProducts, watermelonCategories, watermelonAssignments]);

  return offline ? watermelonResult : convexResult;
}
