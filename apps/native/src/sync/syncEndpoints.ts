import type { PullResponse, PushPayload, PushResponse } from "./types";

/**
 * HTTP client for the three Convex sync endpoints.
 *
 * Convex serves HTTP actions on the `.convex.site` domain, while
 * `useQuery`/`useMutation` go through `.convex.cloud`. We derive the
 * site URL from the standard EXPO_PUBLIC_CONVEX_URL.
 *
 * Authentication: getAuthTokenFn is injected at startup by the host app
 * (which has access to the live Convex client). The SyncManager calls
 * setAuthTokenFn() once on boot.
 */

const CLOUD_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";
const SITE_URL = CLOUD_URL.replace(".convex.cloud", ".convex.site");

let _getAuthToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenFn(fn: () => Promise<string | null>): void {
  _getAuthToken = fn;
}

async function authHeader(): Promise<Record<string, string>> {
  if (!_getAuthToken) throw new Error("syncEndpoints: setAuthTokenFn() never called");
  const token = await _getAuthToken();
  if (!token) throw new Error("syncEndpoints: no auth token (cashier not signed in)");
  return { Authorization: `Bearer ${token}` };
}

async function postJson<T>(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  if (!SITE_URL) throw new Error("syncEndpoints: EXPO_PUBLIC_CONVEX_URL is not set");
  const res = await fetch(`${SITE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function callPull(lastPulledAt: number | null): Promise<PullResponse> {
  return postJson<PullResponse>("/sync/pull", { lastPulledAt });
}

export async function callPush(payload: PushPayload, deviceId: string): Promise<PushResponse> {
  return postJson<PushResponse>("/sync/push", payload, { "x-device-id": deviceId });
}

export async function callRegisterDevice(
  deviceId: string,
  storeId: string,
): Promise<{ deviceCode: string }> {
  return postJson<{ deviceCode: string }>("/sync/registerDevice", { deviceId, storeId });
}
