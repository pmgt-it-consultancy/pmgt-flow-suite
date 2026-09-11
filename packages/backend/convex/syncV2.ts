import { getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { httpAction, internalQuery } from "./_generated/server";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPERATIONAL_STREAM = "operational_orders" as const;
const PROTOCOL_VERSION = 2 as const;
const operationalSnapshotRef = makeFunctionReference<
  "query",
  { storeId: Id<"stores">; now: number; retentionDays: number }
>("syncV2:getOperationalSnapshotCore");
const operationalPullRef = makeFunctionReference<
  "query",
  { storeId: Id<"stores">; eventCursor?: string; limit: number }
>("syncV2:pullOperationalEventsCore");

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

async function authenticatedStoreId(ctx: any): Promise<Id<"stores"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.runQuery(internal.sync.getUserStoreScopeInternal, { userId });
  return user?.storeId ?? null;
}

type AggregateEnvelope = {
  order: Doc<"orders">;
  items: Doc<"orderItems">[];
  modifiers: Doc<"orderItemModifiers">[];
  discounts: Doc<"orderDiscounts">[];
  voids: Doc<"orderVoids">[];
  payments: Doc<"orderPayments">[];
};

function generationForStore(storeId: Id<"stores">): string {
  return `operational-v2:${storeId}`;
}

function eventCursor(event: Doc<"replicationEvents"> | null): string | null {
  return event ? `${event._creationTime}:${event._id}` : null;
}

function parseEventCursor(cursor: string | undefined): {
  creationTime: number;
  id: string;
} | null {
  if (!cursor) return null;
  const separator = cursor.indexOf(":");
  const creationTime = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (separator < 1 || !Number.isFinite(creationTime) || !id) {
    throw new Error("Invalid operational event cursor");
  }
  return { creationTime, id };
}

async function hydrateOrderAggregate(
  ctx: QueryCtx,
  order: Doc<"orders">,
): Promise<AggregateEnvelope> {
  const [items, discounts, voids, payments] = await Promise.all([
    ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect(),
    ctx.db
      .query("orderDiscounts")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect(),
    ctx.db
      .query("orderVoids")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect(),
    ctx.db
      .query("orderPayments")
      .withIndex("by_order", (q) => q.eq("orderId", order._id))
      .collect(),
  ]);
  const modifierGroups = await Promise.all(
    items.map((item) =>
      ctx.db
        .query("orderItemModifiers")
        .withIndex("by_orderItem", (q) => q.eq("orderItemId", item._id))
        .collect(),
    ),
  );

  return {
    order,
    items,
    modifiers: modifierGroups.flat(),
    discounts,
    voids,
    payments,
  };
}

export const getCapabilitiesCore = internalQuery({
  args: {},
  returns: v.any(),
  handler: async () => ({
    protocolVersion: PROTOCOL_VERSION,
    legacyV1Available: true,
    streams: ["store_core", "catalog", "floor", OPERATIONAL_STREAM],
    maxOperationalRetentionDays: 7,
    supportsScopedRepair: true,
  }),
});

export const getOperationalSnapshotCore = internalQuery({
  args: {
    storeId: v.id("stores"),
    now: v.number(),
    retentionDays: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const retentionDays = Math.max(1, Math.min(Math.floor(args.retentionDays), 7));
    const cutoff = args.now - retentionDays * DAY_MS;

    const [recent, drafts, open, latestEvent] = await Promise.all([
      ctx.db
        .query("orders")
        .withIndex("by_store_createdAt", (q) =>
          q.eq("storeId", args.storeId).gte("createdAt", cutoff),
        )
        .collect(),
      ctx.db
        .query("orders")
        .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", "draft"))
        .collect(),
      ctx.db
        .query("orders")
        .withIndex("by_store_status", (q) => q.eq("storeId", args.storeId).eq("status", "open"))
        .collect(),
      ctx.db
        .query("replicationEvents")
        .withIndex("by_store_stream", (q) =>
          q.eq("storeId", args.storeId).eq("stream", OPERATIONAL_STREAM),
        )
        .order("desc")
        .first(),
    ]);

    const roots = new Map<Id<"orders">, Doc<"orders">>();
    for (const order of [...recent, ...drafts, ...open]) roots.set(order._id, order);
    const aggregates = await Promise.all(
      [...roots.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((order) => hydrateOrderAggregate(ctx, order)),
    );

    return {
      protocolVersion: PROTOCOL_VERSION,
      stream: OPERATIONAL_STREAM,
      aggregates,
      checkpoint: {
        stream: OPERATIONAL_STREAM,
        eventCursor: eventCursor(latestEvent),
        generation: generationForStore(args.storeId),
      },
    };
  },
});

export const pullOperationalEventsCore = internalQuery({
  args: {
    storeId: v.id("stores"),
    eventCursor: v.optional(v.string()),
    limit: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const cursor = parseEventCursor(args.eventCursor);
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 250));
    const candidates = await ctx.db
      .query("replicationEvents")
      .withIndex("by_store_stream", (q) => {
        const streamQuery = q.eq("storeId", args.storeId).eq("stream", OPERATIONAL_STREAM);
        return cursor ? streamQuery.gte("_creationTime", cursor.creationTime) : streamQuery;
      })
      .order("asc")
      .take(limit + 1);
    const events = candidates
      .filter(
        (event) =>
          !cursor ||
          event._creationTime > cursor.creationTime ||
          (event._creationTime === cursor.creationTime && event._id > cursor.id),
      )
      .slice(0, limit);

    const latestByRoot = new Map<string, Doc<"replicationEvents">>();
    for (const event of events) latestByRoot.set(event.entityId, event);
    const changes = await Promise.all(
      [...latestByRoot.values()].map(async (event) => {
        const order = await ctx.db.get(event.entityId as Id<"orders">);
        return {
          entityId: event.entityId,
          eventKind: event.eventKind,
          aggregateVersion: event.aggregateVersion,
          operationId: event.operationId,
          aggregate: order ? await hydrateOrderAggregate(ctx, order) : null,
        };
      }),
    );
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;

    return {
      protocolVersion: PROTOCOL_VERSION,
      stream: OPERATIONAL_STREAM,
      changes,
      hasMore: candidates.length > events.length,
      checkpoint: {
        stream: OPERATIONAL_STREAM,
        eventCursor: lastEvent ? eventCursor(lastEvent) : (args.eventCursor ?? null),
        generation: generationForStore(args.storeId),
      },
    };
  },
});

export const syncV2Capabilities = httpAction(async (ctx) => {
  const storeId = await authenticatedStoreId(ctx);
  if (!storeId) return json({ error: "Unauthorized" }, { status: 401 });
  return json({
    protocolVersion: PROTOCOL_VERSION,
    legacyV1Available: true,
    streams: ["store_core", "catalog", "floor", OPERATIONAL_STREAM],
    maxOperationalRetentionDays: 7,
    supportsScopedRepair: true,
  });
});

export const syncV2Snapshot = httpAction(async (ctx, request) => {
  const storeId = await authenticatedStoreId(ctx);
  if (!storeId) return json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { retentionDays?: unknown };
  const retentionDays = typeof body.retentionDays === "number" ? body.retentionDays : 7;
  const result = await ctx.runQuery(operationalSnapshotRef, {
    storeId,
    now: Date.now(),
    retentionDays,
  });
  return json(result);
});

export const syncV2Pull = httpAction(async (ctx, request) => {
  const storeId = await authenticatedStoreId(ctx);
  if (!storeId) return json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    eventCursor?: unknown;
    limit?: unknown;
  };
  if (body.eventCursor !== undefined && typeof body.eventCursor !== "string") {
    return json({ error: "eventCursor must be a string" }, { status: 400 });
  }
  const result = await ctx.runQuery(operationalPullRef, {
    storeId,
    eventCursor: body.eventCursor as string | undefined,
    limit: typeof body.limit === "number" ? body.limit : 100,
  });
  return json(result);
});
