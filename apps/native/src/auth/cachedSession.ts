import * as SecureStore from "expo-secure-store";

const KEY = "pmgt.cachedSession";

/**
 * Snapshot of the cashier's session, persisted across app restarts so the
 * tablet can render screens, validate permissions, and produce receipts
 * while offline. Replaces the SDK's in-memory auth state for the
 * "is the cashier signed in?" question.
 */
export type CachedSession = {
  userId: string;
  email: string;
  name: string;
  roleId: string;
  permissions: string[];
  storeId: string;
  storeSnapshot: Record<string, unknown>;
  expiresAt: number; // ms epoch
  deviceCode?: string;
};

export async function readCachedSession(): Promise<CachedSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSession;
  } catch {
    return null;
  }
}

export async function writeCachedSession(s: CachedSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

export async function clearCachedSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export function isSessionValid(s: CachedSession | null): s is CachedSession {
  return s !== null && s.expiresAt > Date.now();
}
