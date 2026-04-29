import type { Model, Query } from "@nozbe/watermelondb";
import { useEffect, useState } from "react";

/**
 * Subscribes a React component to a WatermelonDB query. Re-renders on
 * any change to a row matching the query (insert, update, delete).
 *
 * Usage:
 *   const products = useObservable(
 *     () => database.collections.get<Product>("products")
 *       .query(Q.where("store_id", storeId), Q.where("is_active", true))
 *       .observe(),
 *     [storeId],
 *   );
 *
 * The factory closure is only re-invoked when deps change, so you can
 * safely build queries inside it.
 *
 * Returns `undefined` until the first emission lands (parity with
 * Convex's `useQuery` loading state).
 */
export function useObservable<T extends Model>(
  factory: () => Query<T>,
  deps: ReadonlyArray<unknown>,
  observedColumns: string[] = [],
): T[] | undefined {
  const [value, setValue] = useState<T[] | undefined>(undefined);
  const observedColumnsKey = observedColumns.join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: factory is intentionally keyed by caller-provided deps
  useEffect(() => {
    setValue(undefined);
    let cancelled = false;
    let sub: { unsubscribe: () => void } | null = null;
    const columns = observedColumnsKey ? observedColumnsKey.split("|") : [];
    const query = factory();
    const observable = columns.length > 0 ? query.observeWithColumns(columns) : query.observe();
    sub = observable.subscribe({
      next: (rows: T[]) => {
        if (!cancelled) setValue(rows);
      },
    });
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }, [observedColumnsKey, ...deps]);

  return value;
}
