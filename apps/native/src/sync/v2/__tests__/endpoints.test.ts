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

  it("downloads every snapshot page and exposes one atomic snapshot", async () => {
    const checkpoint = {
      stream: "operational_orders",
      eventCursor: "event-1",
      generation: "generation-1",
    };
    const response = (body: Record<string, unknown>) => ({
      ok: true,
      json: async () => body,
      text: async () => "",
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          protocolVersion: 2,
          stream: "operational_orders",
          aggregates: [{ order: { _id: "order-1" } }],
          checkpoint,
          hasMore: true,
          nextCursor: "snapshot-page-2",
        }),
      )
      .mockResolvedValueOnce(
        response({
          protocolVersion: 2,
          stream: "operational_orders",
          aggregates: [{ order: { _id: "order-2" } }],
          checkpoint: { ...checkpoint, eventCursor: "event-2" },
          hasMore: false,
          nextCursor: null,
        }),
      );
    const endpoints = createV2Endpoints({
      siteUrl: "https://example.convex.site",
      getAuthToken: async () => "token-1",
      fetchImpl,
    });

    const snapshot = await endpoints.snapshot({ retentionDays: 7 });

    expect(snapshot.aggregates.map((aggregate) => aggregate.order._id)).toEqual([
      "order-1",
      "order-2",
    ]);
    expect(snapshot.checkpoint.eventCursor).toBe("event-1");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.convex.site/sync/v2/snapshot",
      expect.objectContaining({
        body: JSON.stringify({ retentionDays: 7, cursor: "snapshot-page-2" }),
      }),
    );
  });
});
