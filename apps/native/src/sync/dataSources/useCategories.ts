import { Q } from "@nozbe/watermelondb";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { type Category, getDatabase, type Product } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

export type CategoryTreeNode = {
  _id: Id<"categories">;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  children: CategoryTreeNode[];
};

const ROOT_KEY = "__root__";

export function useCategoryTree(storeId: Id<"stores"> | undefined): CategoryTreeNode[] | undefined {
  const offline = isFlagEnabled("useWatermelon.categories");

  const convexResult = useQuery(api.categories.getTree, !offline && storeId ? { storeId } : "skip");

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

  const watermelonResult = useMemo(() => {
    if (!offline) return undefined;
    if (!watermelonCategories || !watermelonProducts) return undefined;

    const productCountByCategoryId = new Map<string, number>();
    for (const p of watermelonProducts) {
      const count = productCountByCategoryId.get(p.categoryId) ?? 0;
      productCountByCategoryId.set(p.categoryId, count + 1);
    }

    const childrenByParentId = new Map<string, Category[]>();
    for (const c of watermelonCategories) {
      const parentKey = c.parentId ?? ROOT_KEY;
      const list = childrenByParentId.get(parentKey);
      if (list) list.push(c);
      else childrenByParentId.set(parentKey, [c]);
    }

    const buildNode = (cat: Category): CategoryTreeNode => {
      const childList = childrenByParentId.get(cat.id) ?? [];
      childList.sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        _id: cat.id as Id<"categories">,
        name: cat.name,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
        productCount: productCountByCategoryId.get(cat.id) ?? 0,
        children: childList.map(buildNode),
      };
    };

    const rootList = childrenByParentId.get(ROOT_KEY) ?? [];
    rootList.sort((a, b) => a.sortOrder - b.sortOrder);

    return rootList.map(buildNode);
  }, [offline, watermelonCategories, watermelonProducts]);

  return offline ? watermelonResult : convexResult;
}
