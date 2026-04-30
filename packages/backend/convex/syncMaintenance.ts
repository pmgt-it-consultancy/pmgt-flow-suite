import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Daily cron job: deletes syncedMutations rows older than 7 days. The
 * idempotency cache only needs to live long enough that a tablet's retry
 * loop can find it; 7 days covers any realistic offline-then-reconnect
 * window.
 */
export const cleanupSyncedMutations = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const stale = await ctx.db
      .query("syncedMutations")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .collect();
    for (const doc of stale) {
      await ctx.db.delete(doc._id);
    }
    return { deleted: stale.length };
  },
});

// ---------------------------------------------------------------------------
// One-shot storeId backfill for order-child tables
// ---------------------------------------------------------------------------
//
// orderItems / orderItemModifiers / orderDiscounts / orderVoids declare
// `storeId` as v.optional(...). Pre-sync rows can therefore lack a storeId
// and are invisible to the by_store_updatedAt index, which is why
// `convex/sync.ts` has a paginated by-order legacy fallback.
//
// Once this backfill has been run to completion in production, the legacy
// fallback (and its `legacyCursor` / `legacyDone` cursor fields) can be
// removed from sync.ts.
//
// Run via `npx convex run --prod syncMaintenance:backfillAllStoreIds`. The
// driver action below loops the per-table mutations until every table
// reports isDone, so a single invocation is sufficient.

const BACKFILL_PAGE_SIZE = 100;

type BackfillPageResult = {
  patched: number;
  scanned: number;
};

// Each call processes one page of rows still missing storeId (using `take`,
// not `.paginate({ cursor })`). Pagination cursors break here because each
// patch moves the row OUT of the `storeId=undefined` partition mid-scan,
// invalidating any cursor we'd return. Driver action below loops the
// mutation until `scanned === 0`, which is the natural termination signal.
export const backfillOrderItemStoreId = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({ patched: v.number(), scanned: v.number() }),
  handler: async (ctx, args): Promise<BackfillPageResult> => {
    const numItems = args.pageSize ?? BACKFILL_PAGE_SIZE;
    const page = await ctx.db
      .query("orderItems")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    const orderCache = new Map<string, Id<"stores"> | undefined>();
    let patched = 0;
    for (const row of page) {
      const orderId = row.orderId as Id<"orders">;
      let storeId = orderCache.get(orderId);
      if (storeId === undefined && !orderCache.has(orderId)) {
        const order = (await ctx.db.get(orderId)) as Doc<"orders"> | null;
        storeId = order?.storeId;
        orderCache.set(orderId, storeId);
      }
      if (storeId) {
        await ctx.db.patch(row._id, { storeId });
        patched++;
      }
    }

    return { patched, scanned: page.length };
  },
});

export const backfillOrderItemModifierStoreId = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({ patched: v.number(), scanned: v.number() }),
  handler: async (ctx, args): Promise<BackfillPageResult> => {
    const numItems = args.pageSize ?? BACKFILL_PAGE_SIZE;
    const page = await ctx.db
      .query("orderItemModifiers")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    // Resolve storeId via orderItem; fall back to order if the orderItem itself
    // is still legacy. Cache both lookups within this page.
    const itemCache = new Map<string, Id<"stores"> | undefined>();
    const orderCache = new Map<string, Id<"stores"> | undefined>();
    let patched = 0;
    for (const row of page) {
      const itemId = row.orderItemId as Id<"orderItems">;
      let storeId = itemCache.get(itemId);
      if (storeId === undefined && !itemCache.has(itemId)) {
        const item = (await ctx.db.get(itemId)) as Doc<"orderItems"> | null;
        storeId = item?.storeId;
        if (!storeId && item?.orderId) {
          const orderId = item.orderId as Id<"orders">;
          storeId = orderCache.get(orderId);
          if (storeId === undefined && !orderCache.has(orderId)) {
            const order = (await ctx.db.get(orderId)) as Doc<"orders"> | null;
            storeId = order?.storeId;
            orderCache.set(orderId, storeId);
          }
        }
        itemCache.set(itemId, storeId);
      }
      if (storeId) {
        await ctx.db.patch(row._id, { storeId });
        patched++;
      }
    }

    return { patched, scanned: page.length };
  },
});

export const backfillOrderDiscountStoreId = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({ patched: v.number(), scanned: v.number() }),
  handler: async (ctx, args): Promise<BackfillPageResult> => {
    const numItems = args.pageSize ?? BACKFILL_PAGE_SIZE;
    const page = await ctx.db
      .query("orderDiscounts")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    const orderCache = new Map<string, Id<"stores"> | undefined>();
    let patched = 0;
    for (const row of page) {
      const orderId = row.orderId as Id<"orders">;
      let storeId = orderCache.get(orderId);
      if (storeId === undefined && !orderCache.has(orderId)) {
        const order = (await ctx.db.get(orderId)) as Doc<"orders"> | null;
        storeId = order?.storeId;
        orderCache.set(orderId, storeId);
      }
      if (storeId) {
        await ctx.db.patch(row._id, { storeId });
        patched++;
      }
    }

    return { patched, scanned: page.length };
  },
});

export const backfillOrderVoidStoreId = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({ patched: v.number(), scanned: v.number() }),
  handler: async (ctx, args): Promise<BackfillPageResult> => {
    const numItems = args.pageSize ?? BACKFILL_PAGE_SIZE;
    const page = await ctx.db
      .query("orderVoids")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    const orderCache = new Map<string, Id<"stores"> | undefined>();
    let patched = 0;
    for (const row of page) {
      const orderId = row.orderId as Id<"orders">;
      let storeId = orderCache.get(orderId);
      if (storeId === undefined && !orderCache.has(orderId)) {
        const order = (await ctx.db.get(orderId)) as Doc<"orders"> | null;
        storeId = order?.storeId;
        orderCache.set(orderId, storeId);
      }
      if (storeId) {
        await ctx.db.patch(row._id, { storeId });
        patched++;
      }
    }

    return { patched, scanned: page.length };
  },
});

// Driver: loops each per-table mutation until it reports scanned===0 (no
// remaining rows missing storeId). Bound iterations defensively; 1000 pages *
// 100/page = 100k unpatchable rows would have to exist for this to spin —
// far above any realistic store volume.
const MAX_BACKFILL_PAGES = 1000;

export const backfillAllStoreIds = internalAction({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({
    orderItems: v.object({ patched: v.number(), scanned: v.number() }),
    orderItemModifiers: v.object({ patched: v.number(), scanned: v.number() }),
    orderDiscounts: v.object({ patched: v.number(), scanned: v.number() }),
    orderVoids: v.object({ patched: v.number(), scanned: v.number() }),
  }),
  handler: async (ctx, args) => {
    // orderItems first so orderItemModifiers can resolve storeId via the
    // now-backfilled item without chaining to the order.
    const sequence = [
      { key: "orderItems" as const, fn: internal.syncMaintenance.backfillOrderItemStoreId },
      {
        key: "orderItemModifiers" as const,
        fn: internal.syncMaintenance.backfillOrderItemModifierStoreId,
      },
      {
        key: "orderDiscounts" as const,
        fn: internal.syncMaintenance.backfillOrderDiscountStoreId,
      },
      { key: "orderVoids" as const, fn: internal.syncMaintenance.backfillOrderVoidStoreId },
    ];

    const totals = {
      orderItems: { patched: 0, scanned: 0 },
      orderItemModifiers: { patched: 0, scanned: 0 },
      orderDiscounts: { patched: 0, scanned: 0 },
      orderVoids: { patched: 0, scanned: 0 },
    };

    for (const { key, fn } of sequence) {
      for (let pages = 0; pages < MAX_BACKFILL_PAGES; pages++) {
        const result: BackfillPageResult = await ctx.runMutation(fn, {
          pageSize: args.pageSize,
        });
        totals[key].patched += result.patched;
        totals[key].scanned += result.scanned;
        // Two stop conditions:
        //   - scanned===0: no rows left missing storeId (success)
        //   - patched===0 with scanned>0: this page found rows we can't fix
        //     (e.g. orphans whose parent order was deleted). Break to avoid
        //     looping forever on unfixable rows.
        if (result.scanned === 0) break;
        if (result.patched === 0) break;
      }
    }

    return totals;
  },
});

// ---------------------------------------------------------------------------
// Diagnostic — count residual undefined-storeId rows after a backfill run
// ---------------------------------------------------------------------------
//
// Reports the true total per table plus a few sample rows. Use this BEFORE
// running cleanupOrphanedLegacyRows so you can eyeball the data and confirm
// it's safe to delete.
//
// Run via: `npx convex run --prod syncMaintenance:countLegacyOrphans`

const LEGACY_SAMPLE_SIZE = 5;

export const countLegacyOrphans = internalQuery({
  args: {},
  returns: v.object({
    orderItems: v.object({ total: v.number(), samples: v.array(v.any()) }),
    orderItemModifiers: v.object({ total: v.number(), samples: v.array(v.any()) }),
    orderDiscounts: v.object({ total: v.number(), samples: v.array(v.any()) }),
    orderVoids: v.object({ total: v.number(), samples: v.array(v.any()) }),
  }),
  handler: async (ctx) => {
    // .collect() of the storeId=undefined partition is bounded by the count
    // of legacy rows. Per the user's run those totals are < 1000 each, well
    // under the 4096 read limit. If a future operator runs this on a worse
    // dataset, swap to .take(SOME_LIMIT) and report a "may be more" flag.
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .collect();
    const modifiers = await ctx.db
      .query("orderItemModifiers")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .collect();
    const discounts = await ctx.db
      .query("orderDiscounts")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .collect();
    const voids = await ctx.db
      .query("orderVoids")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .collect();

    const sample = (rows: any[]) => rows.slice(0, LEGACY_SAMPLE_SIZE);
    return {
      orderItems: { total: items.length, samples: sample(items) },
      orderItemModifiers: { total: modifiers.length, samples: sample(modifiers) },
      orderDiscounts: { total: discounts.length, samples: sample(discounts) },
      orderVoids: { total: voids.length, samples: sample(voids) },
    };
  },
});

// ---------------------------------------------------------------------------
// Cleanup — delete rows that are still missing storeId AND whose parent
// order/orderItem no longer exists. Anything else is left alone — the operator
// must investigate before re-running.
// ---------------------------------------------------------------------------

const CLEANUP_PAGE_SIZE = 100;

type CleanupPageResult = {
  deleted: number;
  scanned: number;
  retained: number;
};

export const cleanupOrphanedOrderItems = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({
    deleted: v.number(),
    scanned: v.number(),
    retained: v.number(),
  }),
  handler: async (ctx, args): Promise<CleanupPageResult> => {
    const numItems = args.pageSize ?? CLEANUP_PAGE_SIZE;
    const page = await ctx.db
      .query("orderItems")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    let deleted = 0;
    let retained = 0;
    for (const row of page) {
      const order = (await ctx.db.get(row.orderId as Id<"orders">)) as Doc<"orders"> | null;
      if (!order) {
        await ctx.db.delete(row._id);
        deleted++;
      } else {
        // Parent exists — should have been backfilled. Leave it for inspection.
        retained++;
      }
    }
    return { deleted, scanned: page.length, retained };
  },
});

export const cleanupOrphanedOrderItemModifiers = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({
    deleted: v.number(),
    scanned: v.number(),
    retained: v.number(),
  }),
  handler: async (ctx, args): Promise<CleanupPageResult> => {
    const numItems = args.pageSize ?? CLEANUP_PAGE_SIZE;
    const page = await ctx.db
      .query("orderItemModifiers")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    let deleted = 0;
    let retained = 0;
    for (const row of page) {
      const item = (await ctx.db.get(
        row.orderItemId as Id<"orderItems">,
      )) as Doc<"orderItems"> | null;
      // A modifier is orphaned if its orderItem is gone, OR if the item is
      // also legacy (no storeId) AND the order behind it is gone.
      if (!item) {
        await ctx.db.delete(row._id);
        deleted++;
        continue;
      }
      if (!item.storeId && item.orderId) {
        const order = (await ctx.db.get(item.orderId as Id<"orders">)) as Doc<"orders"> | null;
        if (!order) {
          await ctx.db.delete(row._id);
          deleted++;
          continue;
        }
      }
      retained++;
    }
    return { deleted, scanned: page.length, retained };
  },
});

export const cleanupOrphanedOrderDiscounts = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({
    deleted: v.number(),
    scanned: v.number(),
    retained: v.number(),
  }),
  handler: async (ctx, args): Promise<CleanupPageResult> => {
    const numItems = args.pageSize ?? CLEANUP_PAGE_SIZE;
    const page = await ctx.db
      .query("orderDiscounts")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    let deleted = 0;
    let retained = 0;
    for (const row of page) {
      const order = (await ctx.db.get(row.orderId as Id<"orders">)) as Doc<"orders"> | null;
      if (!order) {
        await ctx.db.delete(row._id);
        deleted++;
      } else {
        retained++;
      }
    }
    return { deleted, scanned: page.length, retained };
  },
});

export const cleanupOrphanedOrderVoids = internalMutation({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({
    deleted: v.number(),
    scanned: v.number(),
    retained: v.number(),
  }),
  handler: async (ctx, args): Promise<CleanupPageResult> => {
    const numItems = args.pageSize ?? CLEANUP_PAGE_SIZE;
    const page = await ctx.db
      .query("orderVoids")
      .withIndex("by_store_updatedAt", (q) => q.eq("storeId", undefined))
      .take(numItems);

    let deleted = 0;
    let retained = 0;
    for (const row of page) {
      const order = (await ctx.db.get(row.orderId as Id<"orders">)) as Doc<"orders"> | null;
      if (!order) {
        await ctx.db.delete(row._id);
        deleted++;
      } else {
        retained++;
      }
    }
    return { deleted, scanned: page.length, retained };
  },
});

// Driver: deletes confirmed orphans from all four tables. Loops until each
// table reports either scanned===0 (done) or deleted===0 (the page was all
// retained-with-parent rows, meaning the operator must investigate manually).
const MAX_CLEANUP_PAGES = 1000;

export const cleanupOrphanedLegacyRows = internalAction({
  args: { pageSize: v.optional(v.number()) },
  returns: v.object({
    orderItems: v.object({ deleted: v.number(), scanned: v.number(), retained: v.number() }),
    orderItemModifiers: v.object({
      deleted: v.number(),
      scanned: v.number(),
      retained: v.number(),
    }),
    orderDiscounts: v.object({ deleted: v.number(), scanned: v.number(), retained: v.number() }),
    orderVoids: v.object({ deleted: v.number(), scanned: v.number(), retained: v.number() }),
  }),
  handler: async (ctx, args) => {
    const sequence = [
      {
        key: "orderItemModifiers" as const,
        fn: internal.syncMaintenance.cleanupOrphanedOrderItemModifiers,
      },
      { key: "orderItems" as const, fn: internal.syncMaintenance.cleanupOrphanedOrderItems },
      {
        key: "orderDiscounts" as const,
        fn: internal.syncMaintenance.cleanupOrphanedOrderDiscounts,
      },
      { key: "orderVoids" as const, fn: internal.syncMaintenance.cleanupOrphanedOrderVoids },
    ];

    const totals = {
      orderItems: { deleted: 0, scanned: 0, retained: 0 },
      orderItemModifiers: { deleted: 0, scanned: 0, retained: 0 },
      orderDiscounts: { deleted: 0, scanned: 0, retained: 0 },
      orderVoids: { deleted: 0, scanned: 0, retained: 0 },
    };

    for (const { key, fn } of sequence) {
      for (let pages = 0; pages < MAX_CLEANUP_PAGES; pages++) {
        const result: CleanupPageResult = await ctx.runMutation(fn, {
          pageSize: args.pageSize,
        });
        totals[key].deleted += result.deleted;
        totals[key].scanned += result.scanned;
        totals[key].retained += result.retained;
        if (result.scanned === 0) break;
        if (result.deleted === 0) break; // all rows on this page have a live parent
      }
    }

    return totals;
  },
});
