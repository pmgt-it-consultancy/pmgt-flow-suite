import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx, mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { requirePermission } from "./lib/permissions";
import { deviceCodeFromIndex } from "./lib/sync";

/**
 * Moving a tablet between stores is two audited halves: Device Retirement takes it out of one
 * store's reconciliation, Device Commissioning makes it an Active Tablet of the next. Plain
 * registration refuses a store change outright, so this is the only sanctioned route.
 */

async function authorize(ctx: MutationCtx, storeId: Id<"stores">) {
  const user = await getAuthenticatedUser(ctx);
  if (!user) throw new Error("Authentication required");
  await requirePermission(ctx, user._id, "devices.manage");
  if (user.storeId && user.storeId !== storeId) {
    throw new Error("That store is outside your scope");
  }
  return user;
}

async function activeBinding(ctx: MutationCtx, deviceId: string) {
  const bindings = await ctx.db
    .query("syncDevices")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
    .collect();
  return bindings.find((binding) => binding.retiredAt === undefined) ?? null;
}

async function audit(
  ctx: MutationCtx,
  storeId: Id<"stores">,
  userId: Id<"users">,
  action: string,
  deviceId: string,
  details: string,
) {
  await ctx.db.insert("auditLogs", {
    storeId,
    action,
    entityType: "syncDevice",
    entityId: deviceId,
    details,
    userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export const retire = mutation({
  args: { deviceId: v.string(), storeId: v.id("stores") },
  returns: v.object({ retiredAt: v.number() }),
  handler: async (ctx, args) => {
    const user = await authorize(ctx, args.storeId);
    const binding = await activeBinding(ctx, args.deviceId);

    if (!binding) {
      // Idempotent: a tablet already retired from this store retires again without a second entry.
      const retired = await ctx.db
        .query("syncDevices")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
        .collect();
      const here = retired.find(
        (row) => row.storeId === args.storeId && row.retiredAt !== undefined,
      );
      if (here?.retiredAt !== undefined) return { retiredAt: here.retiredAt };
      throw new Error(`Device ${args.deviceId} is not registered to this store`);
    }
    if (binding.storeId !== args.storeId) {
      throw new Error(`Device ${args.deviceId} belongs to another store`);
    }

    // Sync-Clean is the tablet's own reported pending count, which day closing already records.
    const states = await ctx.db
      .query("deviceSyncStates")
      .withIndex("by_store_device_stream", (q) =>
        q.eq("storeId", args.storeId).eq("deviceId", args.deviceId),
      )
      .collect();
    if (states.length === 0) {
      throw new Error(
        "This tablet has not reported that it is Sync-Clean. Run Sync Now on the tablet first.",
      );
    }
    const pending = states.reduce((total, state) => total + state.pendingCount, 0);
    if (pending > 0) {
      throw new Error(
        `This tablet still has ${pending} record(s) waiting to sync. Clear them before retiring it.`,
      );
    }

    const retiredAt = Date.now();
    await ctx.db.patch(binding._id, { retiredAt, retiredBy: user._id });
    for (const state of states) {
      await ctx.db.patch(state._id, { status: "retired" as const, updatedAt: retiredAt });
    }
    await audit(
      ctx,
      args.storeId,
      user._id,
      "device.retired",
      args.deviceId,
      `Retired device ${binding.deviceCode} from store ${args.storeId}`,
    );
    return { retiredAt };
  },
});

export const commission = mutation({
  args: { deviceId: v.string(), storeId: v.id("stores") },
  returns: v.object({ deviceCode: v.string() }),
  handler: async (ctx, args) => {
    const user = await authorize(ctx, args.storeId);
    const binding = await activeBinding(ctx, args.deviceId);

    if (binding) {
      // Idempotent against the store it already serves; never claimed by two stores at once.
      if (binding.storeId === args.storeId) return { deviceCode: binding.deviceCode };
      throw new Error(
        `Device ${args.deviceId} is still an Active Tablet of store ${binding.storeId}. ` +
          `Retire it there before commissioning it here.`,
      );
    }

    const store = await ctx.db.get(args.storeId);
    if (!store) throw new Error(`Store ${args.storeId} not found`);
    const nextIndex = store.deviceCodeCounter ?? 0;
    const deviceCode = deviceCodeFromIndex(nextIndex);
    await ctx.db.patch(args.storeId, {
      deviceCodeCounter: nextIndex + 1,
      updatedAt: Date.now(),
    });
    // A fresh binding with empty order-number counters: numbers must never collide with the
    // ones this tablet issued at its previous store.
    await ctx.db.insert("syncDevices", {
      deviceId: args.deviceId,
      storeId: args.storeId,
      deviceCode,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    await audit(
      ctx,
      args.storeId,
      user._id,
      "device.commissioned",
      args.deviceId,
      `Commissioned device ${deviceCode} to store ${args.storeId}`,
    );
    return { deviceCode };
  },
});
