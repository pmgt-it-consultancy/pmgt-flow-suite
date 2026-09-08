import type { Model, Query } from "@nozbe/watermelondb";
import { NavigationContext } from "@react-navigation/native";
import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

/** Screen-owned queries pause on blur. Non-screen consumers remain active. */
export function useScreenQueryActive(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribeToFocus = useCallback(
    (notify: () => void) => {
      if (!navigation) return () => {};
      const offFocus = navigation.addListener("focus", notify);
      const offBlur = navigation.addListener("blur", notify);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  const getFocused = useCallback(() => navigation?.isFocused() ?? true, [navigation]);
  return useSyncExternalStore(subscribeToFocus, getFocused, getFocused);
}

/** Observe query rows while focused; caller dependencies identify the query scope. */
export function useObservable<T extends Model>(
  factory: () => Query<T>,
  deps: ReadonlyArray<unknown>,
  observedColumns: string[] = [],
): T[] | undefined {
  const active = useScreenQueryActive();
  const observedColumnsKey = observedColumns.join("|");
  // A new scope must never expose rows from the previous store/order, even
  // before its effect runs. Retain the last same-scope snapshot while hidden.
  // biome-ignore lint/correctness/useExhaustiveDependencies: caller-defined query dependencies
  const scope = useMemo(() => ({}), [observedColumnsKey, ...deps]);
  const [snapshot, setSnapshot] = useState<{ scope: object; rows: T[] }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: factory is intentionally keyed by caller-provided deps
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let sub: { unsubscribe: () => void } | null = null;
    const columns = observedColumnsKey ? observedColumnsKey.split("|") : [];
    const query = factory();
    const observable = columns.length > 0 ? query.observeWithColumns(columns) : query.observe();
    sub = observable.subscribe({
      next: (rows: T[]) => {
        if (!cancelled) setSnapshot({ scope, rows });
      },
    });
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }, [active, scope]);

  return snapshot?.scope === scope ? snapshot.rows : undefined;
}
