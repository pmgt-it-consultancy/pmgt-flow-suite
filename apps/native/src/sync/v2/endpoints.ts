import { getSyncAuthToken } from "../syncEndpoints";
import type { OperationalDelta, OperationalSnapshot } from "./types";

type EndpointOptions = {
  siteUrl: string;
  getAuthToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export function createV2Endpoints(options: EndpointOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function post<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const token = await options.getAuthToken();
    if (!token) throw new Error("sync v2: no auth token");
    const response = await fetchImpl(`${options.siteUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${path} failed: ${response.status} ${detail}`);
    }
    return (await response.json()) as T;
  }

  return {
    capabilities: () => post<Record<string, unknown>>("/sync/v2/capabilities", {}),
    snapshot: (body: { retentionDays?: number } = {}) =>
      post<OperationalSnapshot>("/sync/v2/snapshot", body),
    pull: (body: { eventCursor?: string; limit?: number }) =>
      post<OperationalDelta>("/sync/v2/pull", body),
    searchHistory: (body: Record<string, unknown>) =>
      post<Record<string, unknown>>("/sync/v2/history/search", body),
    loadHistoricalOrder: (orderId: string) =>
      post<Record<string, unknown>>("/sync/v2/history/order", { orderId }),
    uploadCommands: (
      commands: Array<{
        operationId: string;
        schemaVersion: number;
        command: Record<string, unknown>;
      }>,
      deviceId: string,
    ) =>
      post<{
        results: Array<{ operationId: string; status: "accepted" | "rejected"; error?: string }>;
      }>("/sync/v2/commands", { commands }, { "x-device-id": deviceId }),
  };
}

const cloudUrl = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";
export const syncV2Endpoints = createV2Endpoints({
  siteUrl: cloudUrl.replace(".convex.cloud", ".convex.site"),
  getAuthToken: getSyncAuthToken,
});
