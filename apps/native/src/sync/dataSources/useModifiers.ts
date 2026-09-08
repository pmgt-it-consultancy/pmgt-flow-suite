import { type Model, Q, type Query } from "@nozbe/watermelondb";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useEffect, useMemo, useState } from "react";
import {
  type Category,
  getDatabase,
  type ModifierGroup,
  type ModifierGroupAssignment,
  type ModifierOption,
  type Product,
} from "../../db";
import { useObservable, useScreenQueryActive } from "../../db/useObservable";

const MODIFIER_GROUP_COLUMNS = [
  "name",
  "selection_type",
  "min_selections",
  "max_selections",
  "is_active",
  "sort_order",
];

const MODIFIER_OPTION_COLUMNS = [
  "modifier_group_id",
  "name",
  "price_adjustment",
  "is_default",
  "is_available",
  "sort_order",
];

const MODIFIER_ASSIGNMENT_COLUMNS = [
  "modifier_group_id",
  "product_id",
  "category_id",
  "sort_order",
  "min_selections_override",
  "max_selections_override",
];

const MODIFIER_PRODUCT_COLUMNS = ["store_id", "category_id"];
const MODIFIER_CATEGORY_COLUMNS = ["parent_id"];

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
  maxSelections: number | undefined;
  sortOrder: number;
  options: ModifierOptionItem[];
};

export type ProductModifierGroups = {
  productId: Id<"products">;
  groups: ModifierGroupItem[];
};

export function buildModifiersByProduct(
  groups: ModifierGroup[],
  options: ModifierOption[],
  assignments: ModifierGroupAssignment[],
  storeId: string,
  products?: Product[],
  categories?: Category[],
): Map<string, ModifierGroupItem[]> {
  const groupById = new Map<string, ModifierGroup>();
  for (const g of groups) {
    if (!g.isActive) continue;
    groupById.set(g.id, g);
  }

  const optionsByGroupId = new Map<string, ModifierOption[]>();
  for (const o of options) {
    if (!o.isAvailable) continue;
    const list = optionsByGroupId.get(o.modifierGroupId);
    if (list) list.push(o);
    else optionsByGroupId.set(o.modifierGroupId, [o]);
  }
  for (const list of optionsByGroupId.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const categoryById = new Map<string, Category>();
  if (categories) {
    for (const c of categories) categoryById.set(c.id, c);
  }

  const ancestorCache = new Map<string, Set<string>>();
  const getAncestors = (catId: string): Set<string> => {
    const cached = ancestorCache.get(catId);
    if (cached) return cached;
    const chain = new Set<string>();
    let cursor: string | undefined = catId;
    while (cursor) {
      chain.add(cursor);
      const parent: string | undefined = categoryById.get(cursor)?.parentId;
      if (!parent || chain.has(parent)) break;
      cursor = parent;
    }
    ancestorCache.set(catId, chain);
    return chain;
  };

  const productAssignments = new Map<string, ModifierGroupAssignment[]>();
  const categoryAssignments = new Map<string, ModifierGroupAssignment[]>();
  for (const a of assignments) {
    if (a.productId) {
      const list = productAssignments.get(a.productId);
      if (list) list.push(a);
      else productAssignments.set(a.productId, [a]);
    }
    if (a.categoryId) {
      const list = categoryAssignments.get(a.categoryId);
      if (list) list.push(a);
      else categoryAssignments.set(a.categoryId, [a]);
    }
  }

  const result = new Map<string, ModifierGroupItem[]>();

  for (const product of products ?? []) {
    if (product.storeId !== storeId) continue;
    const seenGroupIds = new Set<string>();
    const resolvedAssignments: ModifierGroupAssignment[] = [];

    const direct = productAssignments.get(product.id) ?? [];
    for (const a of direct) {
      resolvedAssignments.push(a);
      seenGroupIds.add(a.modifierGroupId);
    }

    if (categories) {
      const ancestors = getAncestors(product.categoryId);
      for (const ancId of ancestors) {
        const catAssignments = categoryAssignments.get(ancId) ?? [];
        for (const a of catAssignments) {
          if (!seenGroupIds.has(a.modifierGroupId)) {
            resolvedAssignments.push(a);
            seenGroupIds.add(a.modifierGroupId);
          }
        }
      }
    }

    resolvedAssignments.sort((a, b) => a.sortOrder - b.sortOrder);

    const resolvedGroups: ModifierGroupItem[] = [];
    for (const a of resolvedAssignments) {
      const group = groupById.get(a.modifierGroupId);
      if (!group) continue;
      const groupOptions = (optionsByGroupId.get(group.id) ?? []).map(
        (o): ModifierOptionItem => ({
          optionId: o.id as Id<"modifierOptions">,
          name: o.name,
          priceAdjustment: o.priceAdjustment,
          isDefault: o.isDefault,
        }),
      );
      resolvedGroups.push({
        groupId: group.id as Id<"modifierGroups">,
        groupName: group.name,
        selectionType: group.selectionType as "single" | "multi",
        minSelections: a.minSelectionsOverride ?? group.minSelections,
        maxSelections: a.maxSelectionsOverride ?? group.maxSelections,
        sortOrder: a.sortOrder,
        options: groupOptions,
      });
    }

    if (resolvedGroups.length > 0) {
      result.set(product.id, resolvedGroups);
    }
  }

  return result;
}

export function useModifiersForStore(
  storeId: Id<"stores"> | undefined,
): ProductModifierGroups[] | undefined {
  const watermelonGroups = useObservable<ModifierGroup>(
    () =>
      getDatabase()
        .collections.get<ModifierGroup>("modifier_groups")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("is_active", true)]
            : [Q.where("store_id", "__none__")]),
        ),
    [storeId],
    MODIFIER_GROUP_COLUMNS,
  );

  const watermelonOptions = useObservable<ModifierOption>(
    () =>
      getDatabase()
        .collections.get<ModifierOption>("modifier_options")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [storeId],
    MODIFIER_OPTION_COLUMNS,
  );

  const watermelonAssignments = useObservable<ModifierGroupAssignment>(
    () =>
      getDatabase()
        .collections.get<ModifierGroupAssignment>("modifier_group_assignments")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [storeId],
    MODIFIER_ASSIGNMENT_COLUMNS,
  );

  const watermelonProducts = useObservable<Product>(
    () =>
      getDatabase()
        .collections.get<Product>("products")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [storeId],
    MODIFIER_PRODUCT_COLUMNS,
  );

  const watermelonCategories = useObservable<Category>(
    () =>
      getDatabase()
        .collections.get<Category>("categories")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [storeId],
    MODIFIER_CATEGORY_COLUMNS,
  );

  return useMemo(() => {
    if (!storeId) return undefined;
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
      storeId,
      watermelonProducts,
      watermelonCategories,
    );
    return [...byProduct.entries()]
      .filter(([, groups]) => groups.length > 0)
      .map(([productId, groups]) => ({ productId: productId as Id<"products">, groups }));
  }, [
    storeId,
    watermelonGroups,
    watermelonOptions,
    watermelonAssignments,
    watermelonProducts,
    watermelonCategories,
  ]);
}

export function useModifiersForProduct(
  productId: Id<"products"> | undefined,
): ModifierGroupItem[] | undefined {
  const active = useScreenQueryActive();
  const [snapshot, setSnapshot] = useState<{
    productId: string;
    groups: ModifierGroupItem[] | undefined;
  }>();

  useEffect(() => {
    if (!productId || !active) return;
    const db = getDatabase();
    const publish = (groups: ModifierGroupItem[] | undefined) => setSnapshot({ productId, groups });
    publish(undefined);

    // Each observation owns its downstream subscriptions. Membership changes
    // replace that subtree, and selection changes dispose the complete chain.
    function watch<T extends Model>(
      query: Query<T>,
      columns: string[],
      next: (rows: T[]) => (() => void) | undefined,
    ): () => void {
      let cleanup: (() => void) | undefined;
      let active = true;
      const subscription = query.observeWithColumns(columns).subscribe({
        next: (rows) => {
          if (!active) return;
          cleanup?.();
          publish(undefined);
          cleanup = next(rows);
        },
      });
      return () => {
        active = false;
        subscription.unsubscribe();
        cleanup?.();
      };
    }

    function resolve(product: Product, categories: Category[], categoryIds: string[]) {
      return watch(
        db.collections
          .get<ModifierGroupAssignment>("modifier_group_assignments")
          .query(
            Q.or(Q.where("product_id", product.id), Q.where("category_id", Q.oneOf(categoryIds))),
          ),
        MODIFIER_ASSIGNMENT_COLUMNS,
        (assignments) => {
          const groupIds = [...new Set(assignments.map((a) => a.modifierGroupId))];
          if (!groupIds.length) {
            publish([]);
            return;
          }
          return watch(
            db.collections
              .get<ModifierGroup>("modifier_groups")
              .query(Q.where("id", Q.oneOf(groupIds)), Q.where("is_active", true)),
            MODIFIER_GROUP_COLUMNS,
            (groups) => {
              if (!groups.length) {
                publish([]);
                return;
              }
              return watch(
                db.collections
                  .get<ModifierOption>("modifier_options")
                  .query(
                    Q.where("modifier_group_id", Q.oneOf(groups.map((g) => g.id))),
                    Q.where("is_available", true),
                  ),
                MODIFIER_OPTION_COLUMNS,
                (options) => {
                  publish(
                    buildModifiersByProduct(
                      groups,
                      options,
                      assignments,
                      product.storeId,
                      [product],
                      categories,
                    ).get(product.id) ?? [],
                  );
                  return undefined;
                },
              );
            },
          );
        },
      );
    }

    function ancestry(
      product: Product,
      id: string | undefined,
      categories: Category[],
      ids: string[],
    ): () => void {
      if (!id || ids.includes(id)) return resolve(product, categories, ids);
      return watch(
        db.collections.get<Category>("categories").query(Q.where("id", id)),
        MODIFIER_CATEGORY_COLUMNS,
        (rows) => ancestry(product, rows[0]?.parentId, [...categories, ...rows], [...ids, id]),
      );
    }

    return watch(
      db.collections.get<Product>("products").query(Q.where("id", productId)),
      MODIFIER_PRODUCT_COLUMNS,
      (products) =>
        products[0] ? ancestry(products[0], products[0].categoryId, [], []) : undefined,
    );
  }, [productId, active]);

  return productId && snapshot?.productId === productId ? snapshot.groups : undefined;
}
