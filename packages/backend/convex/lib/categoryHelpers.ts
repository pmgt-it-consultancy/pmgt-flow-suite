import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Returns the category chain from the given category up to the root.
 * For a root category: [categoryId]
 * For a subcategory: [subcategoryId, parentCategoryId]
 * Max 2 levels deep (matches category tree structure).
 */
export async function getCategoryChain(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<"categories">,
): Promise<Id<"categories">[]> {
  const category = await ctx.db.get(categoryId);
  if (!category) return [categoryId];

  if (category.parentId) {
    return [categoryId, category.parentId];
  }

  return [categoryId];
}
