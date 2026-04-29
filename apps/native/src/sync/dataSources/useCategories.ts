import { Q } from "@nozbe/watermelondb";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMemo } from "react";
import { type Category, getDatabase, type Product } from "../../db";
import { useObservable } from "../../db/useObservable";

const CATEGORY_TREE_COLUMNS = ["name", "parent_id", "sort_order", "is_active"];
const PRODUCT_COUNT_COLUMNS = ["category_id"];

export type CategoryChild = {
  _id: Id<"categories">;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
};

export interface CategoryTreeNode extends CategoryChild {
  children: CategoryChild[];
}

const ROOT_KEY = "__root__";

export function useCategoryTree(storeId: Id<"stores"> | undefined): CategoryTreeNode[] | undefined {
  const watermelonCategories = useObservable<Category>(
    () =>
      getDatabase()
        .collections.get<Category>("categories")
        .query(
          ...(storeId
            ? [Q.where("store_id", storeId), Q.where("is_active", true)]
            : [Q.where("store_id", "__none__")]),
        ),
    [storeId],
    CATEGORY_TREE_COLUMNS,
  );

  const watermelonProducts = useObservable<Product>(
    () =>
      getDatabase()
        .collections.get<Product>("products")
        .query(...(storeId ? [Q.where("store_id", storeId)] : [Q.where("store_id", "__none__")])),
    [storeId],
    PRODUCT_COUNT_COLUMNS,
  );

  return useMemo((): CategoryTreeNode[] | undefined => {
    if (!storeId) return undefined;
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
      const node: CategoryTreeNode = {
        _id: cat.id as Id<"categories">,
        name: cat.name,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
        productCount: productCountByCategoryId.get(cat.id) ?? 0,
        children: [],
      };
      node.children = childList.map(buildNode);
      return node;
    };

    const rootList = childrenByParentId.get(ROOT_KEY) ?? [];
    rootList.sort((a, b) => a.sortOrder - b.sortOrder);

    return rootList.map(buildNode);
  }, [storeId, watermelonCategories, watermelonProducts]);
}
