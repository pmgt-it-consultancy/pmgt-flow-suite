import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { appendReplicationEvent } from "./replicationEvents";

const modules = import.meta.glob("../**/*.ts");

async function createStore(t: ReturnType<typeof convexTest>, name: string) {
  return t.run(async (ctx) =>
    ctx.db.insert("stores", {
      name,
      address1: "1 Test Street",
      tin: `TIN-${name}`,
      min: `MIN-${name}`,
      vatRate: 12,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

describe("appendReplicationEvent", () => {
  it("keeps ordered stream events isolated by store", async () => {
    const t = convexTest(schema, modules);
    const firstStore = await createStore(t, "First");
    const secondStore = await createStore(t, "Second");

    await t.run(async (ctx) => {
      await appendReplicationEvent(ctx, {
        storeId: firstStore,
        stream: "operational_orders",
        entityType: "order",
        entityId: "order-a",
        aggregateVersion: 1,
        eventKind: "upsert",
        operationId: "operation-a",
      });
      await appendReplicationEvent(ctx, {
        storeId: secondStore,
        stream: "operational_orders",
        entityType: "order",
        entityId: "order-other-store",
        aggregateVersion: 1,
        eventKind: "upsert",
      });
      await appendReplicationEvent(ctx, {
        storeId: firstStore,
        stream: "operational_orders",
        entityType: "order",
        entityId: "order-b",
        aggregateVersion: 2,
        eventKind: "membership_enter",
      });
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("replicationEvents")
        .withIndex("by_store_stream", (q) =>
          q.eq("storeId", firstStore).eq("stream", "operational_orders"),
        )
        .collect(),
    );

    expect(events.map(({ entityId, eventKind }) => [entityId, eventKind])).toEqual([
      ["order-a", "upsert"],
      ["order-b", "membership_enter"],
    ]);
    expect(events[0].operationId).toBe("operation-a");
    expect(events[0].protocolVersion).toBe(2);
  });

  it("rejects non-positive aggregate versions", async () => {
    const t = convexTest(schema, modules);
    const storeId = await createStore(t, "Versioned");

    await expect(
      t.run(async (ctx) =>
        appendReplicationEvent(ctx, {
          storeId,
          stream: "operational_orders",
          entityType: "order",
          entityId: "order-a",
          aggregateVersion: 0,
          eventKind: "upsert",
        }),
      ),
    ).rejects.toThrow("aggregateVersion must be a positive integer");
  });
});
