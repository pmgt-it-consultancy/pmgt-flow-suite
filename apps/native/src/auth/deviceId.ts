import * as SecureStore from "expo-secure-store";

const KEY = "pmgt.deviceId";

/**
 * Returns the tablet's device UUID, generating + persisting it on first
 * call. The UUID is the stable identity used by /sync/registerDevice and
 * the x-device-id header on /sync/push. Stored encrypted in SecureStore.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : fallbackUuid();
  await SecureStore.setItemAsync(KEY, id);
  return id;
}

/**
 * Test/dev affordance: clear the persisted deviceId. The next call to
 * getOrCreateDeviceId() will generate a fresh UUID. Use sparingly —
 * the device will register again as a new device with a new deviceCode.
 */
export async function clearDeviceId(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

// RFC4122 v4 fallback for environments where crypto.randomUUID is missing
// (older Hermes builds in some test runners). Uses Math.random — fine for
// device-identity in this context, not for cryptographic purposes.
function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
