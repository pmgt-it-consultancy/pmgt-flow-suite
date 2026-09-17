const SORT_ORDER_STEP = 1;

/**
 * Computes a new sortOrder for a row moved next to the given neighbors,
 * without needing (or touching) the sortOrder of any other row. Neighbors
 * are the rows immediately before/after the moved row in its new position.
 */
export function computeMoveSortOrder(before: number | null, after: number | null): number {
  if (before !== null && after !== null) return (before + after) / 2;
  if (after !== null) return after - SORT_ORDER_STEP;
  if (before !== null) return before + SORT_ORDER_STEP;
  throw new Error("computeMoveSortOrder requires at least one of before or after");
}
