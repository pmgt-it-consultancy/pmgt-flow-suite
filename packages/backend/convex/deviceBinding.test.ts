import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createStore(t: any, name: string) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("stores", {
      name,
      address1: "123 Test St",
      tin: "123-456-789-000",
      min: `MIN-${name}`,
      vatRate: 12,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function bindingsFor(t: any, deviceId: string) {
  return await t.run(async (ctx: any) =>
    ctx.db
      .query("syncDevices")
      .withIndex("by_deviceId", (q: any) => q.eq("deviceId", deviceId))
      .collect(),
  );
}

describe("device binding", () => {
  it("allocates a device code on first registration", async () => {
    const t = convexTest(schema, modules);
    const storeId = await createStore(t, "Store A");

    const first = await t.mutation(internal.sync.registerDeviceCore, {
      deviceId: "tablet-1",
      storeId,
    });

    expect(first.deviceCode).toBeTruthy();
    expect(await bindingsFor(t, "tablet-1")).toHaveLength(1);
  });

  it("is idempotent for the store the tablet is already bound to", async () => {
    const t = convexTest(schema, modules);
    const storeId = await createStore(t, "Store A");

    const first = await t.mutation(internal.sync.registerDeviceCore, {
      deviceId: "tablet-1",
      storeId,
    });
    const again = await t.mutation(internal.sync.registerDeviceCore, {
      deviceId: "tablet-1",
      storeId,
    });

    expect(again.deviceCode).toBe(first.deviceCode);
    expect(await bindingsFor(t, "tablet-1")).toHaveLength(1);
  });

  /**
   * A tablet belongs to one store. Registering it against another must be refused, not recorded
   * alongside the first: two rows on by_deviceId make the device code and the order-number
   * counters ambiguous, which is how duplicate order numbers become possible.
   */
  it("refuses to move a bound tablet to another store", async () => {
    const t = convexTest(schema, modules);
    const storeA = await createStore(t, "Store A");
    const storeB = await createStore(t, "Store B");

    await t.mutation(internal.sync.registerDeviceCore, {
      deviceId: "tablet-1",
      storeId: storeA,
    });

    await expect(
      t.mutation(internal.sync.registerDeviceCore, {
        deviceId: "tablet-1",
        storeId: storeB,
      }),
    ).rejects.toThrow(/bound/i);

    const bindings = await bindingsFor(t, "tablet-1");
    expect(bindings).toHaveLength(1);
    expect(bindings[0].storeId).toBe(storeA);
  });
});
