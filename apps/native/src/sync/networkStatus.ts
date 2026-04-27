import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export function isOnline(state: NetInfoState | null): boolean {
  if (!state?.isConnected) return false;
  // isInternetReachable is sometimes null on initial fetch — only treat
  // explicit `false` as offline.
  return state.isInternetReachable !== false;
}

/**
 * Hook for components that want to react to connectivity changes —
 * e.g. the SyncStatusPill displays "Offline" when this returns false.
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then((s) => {
      if (mounted) setOnline(isOnline(s));
    });
    const unsub = NetInfo.addEventListener((s) => {
      if (mounted) setOnline(isOnline(s));
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return online;
}

/**
 * Imperative subscription used by SyncManager so it can trigger a
 * push+pull cycle the moment connectivity returns.
 */
export function subscribeToNetworkChanges(cb: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((s) => cb(isOnline(s)));
}
