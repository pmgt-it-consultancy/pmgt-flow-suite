import { Q } from "@nozbe/watermelondb";
import { createTestDatabase } from "../../../db/testing/createTestDatabase";
import { applyAggregateEnvelope, replaceOperationalReplica } from "../aggregateApply";

describe("applyAggregateEnvelope", () => {
  it("stores one complete aggregate atomically and ignores older versions", async () => {
    const database = createTestDatabase();
    const base = {
      order: { _id: "order-1", customerName: "First" },
      items: [{ _id: "item-1", quantity: 1 }],
      modifiers: [],
      discounts: [],
      voids: [],
      payments: [],
    };

    await applyAggregateEnvelope(database, {
      storeId: "store-1",
      entityId: "order-1",
      aggregateVersion: 2,
      aggregate: base,
    });
    await applyAggregateEnvelope(database, {
      storeId: "store-1",
      entityId: "order-1",
      aggregateVersion: 1,
      aggregate: { ...base, order: { _id: "order-1", customerName: "Stale" } },
    });

    const rows = await database
      .get("sync_v2_aggregates")
      .query(Q.where("store_id", "store-1"), Q.where("order_id", "order-1"))
      .fetch();
    expect(rows).toHaveLength(1);
    const raw = rows[0]._raw as Record<string, unknown>;
    expect(raw.aggregate_version).toBe(2);
    expect(JSON.parse(raw.payload as string)).toEqual(base);
  });

  it("atomically replaces one store's downloaded generation", async () => {
    const database = createTestDatabase();
    await applyAggregateEnvelope(database, {
      storeId: "store-1",
      entityId: "old-order",
      aggregateVersion: 1,
      aggregate: {
        order: { _id: "old-order" },
        items: [],
        modifiers: [],
        discounts: [],
        voids: [],
        payments: [],
      },
    });
    await replaceOperationalReplica(database, "store-1", [
      {
        order: { _id: "new-order", replicationVersion: 3 },
        items: [],
        modifiers: [],
        discounts: [],
        voids: [],
        payments: [],
      },
    ]);

    const rows = await database
      .get("sync_v2_aggregates")
      .query(Q.where("store_id", "store-1"))
      .fetch();
    expect(rows.map((row) => (row._raw as Record<string, unknown>).order_id)).toEqual([
      "new-order",
    ]);
  });
});
