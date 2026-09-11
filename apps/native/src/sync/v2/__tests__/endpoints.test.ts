import { createV2Endpoints } from "../endpoints";

describe("v2 endpoints", () => {
  it("sends authenticated v2 request shapes", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ protocolVersion: 2 }),
      text: async () => "",
    });
    const endpoints = createV2Endpoints({
      siteUrl: "https://example.convex.site",
      getAuthToken: async () => "token-1",
      fetchImpl,
    });

    await endpoints.snapshot({ retentionDays: 7 });
    await endpoints.pull({ eventCursor: "cursor-1", limit: 50 });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.convex.site/sync/v2/snapshot",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
        body: JSON.stringify({ retentionDays: 7 }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.convex.site/sync/v2/pull",
      expect.objectContaining({ body: JSON.stringify({ eventCursor: "cursor-1", limit: 50 }) }),
    );
  });
});
