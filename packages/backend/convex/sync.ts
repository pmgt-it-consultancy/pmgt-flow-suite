import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { deviceCodeFromIndex, newClientId } from "./lib/sync";

/**
 * /sync/registerDevice, /sync/pull, /sync/push
 *
 * The three HTTP endpoints that bridge WatermelonDB on the tablet to Convex.
 * See docs/superpowers/specs/2026-04-27-offline-first-pos-tablet-design.md
 * for the full design.
 *
 * Pull translates Convex docs into Watermelon-shaped diff payloads;
 * push translates Watermelon-shaped writes back into Convex inserts/patches.
 * IDs flow as `clientId` (UUID) on the tablet side, `_id` on the Convex side;
 * FK columns are translated by lookup at the boundary.
 */

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

const unauthorized = () => json({ error: "Unauthorized" }, { status: 401 });
const forbidden = (msg: string) => json({ error: msg }, { status: 403 });
const badRequest = (msg: string) => json({ error: msg }, { status: 400 });

// ---------------------------------------------------------------------------
// /sync/registerDevice
// ---------------------------------------------------------------------------

export const registerDeviceCore = internalMutation({
  args: { deviceId: v.string(), storeId: v.id("stores") },
  returns: v.object({ deviceCode: v.string() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("syncDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();

    if (existing && existing.storeId === args.storeId) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return { deviceCode: existing.deviceCode };
    }

    const store = await ctx.db.get(args.storeId);
    if (!store) throw new Error(`Store ${args.storeId} not found`);

    const nextIndex = store.deviceCodeCounter ?? 0;
    const deviceCode = deviceCodeFromIndex(nextIndex);

    await ctx.db.patch(args.storeId, { deviceCodeCounter: nextIndex + 1, updatedAt: Date.now() });
    await ctx.db.insert("syncDevices", {
      deviceId: args.deviceId,
      storeId: args.storeId,
      deviceCode,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    return { deviceCode };
  },
});

export const registerDevice = httpAction(async (ctx, request) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return unauthorized();

  const body = (await request.json()) as { deviceId?: unknown; storeId?: unknown };
  if (typeof body.deviceId !== "string" || typeof body.storeId !== "string") {
    return badRequest("deviceId and storeId must be strings");
  }

  const result = await ctx.runMutation(internal.sync.registerDeviceCore, {
    deviceId: body.deviceId,
    storeId: body.storeId as Id<"stores">,
  });
  return json(result);
});

// ---------------------------------------------------------------------------
// /sync/pull — Watermelon-shaped diff (paged)
// ---------------------------------------------------------------------------
//
// The pull is split into per-table internalQueries so each table gets its own
// 4096-read budget. Within a table we use Convex .paginate() with a continuation
// cursor; the orchestrator (action) calls pages across tables in sequence,
// stopping at a per-request row budget so a single HTTP response stays bounded.
//
// Cursor shape (sent by client and echoed back):
//   { [tableName]: { cursor: string | null; isDone: boolean } }

type WatermelonRow = {
  id: string; // clientId UUID — the tablet's primary key
  server_id: string; // the Convex _id, used by push to recognize the same row
  [k: string]: unknown;
};

type ChangeBucket = { created: WatermelonRow[]; updated: WatermelonRow[]; deleted: string[] };

type TableCursor = {
  cursor: string | null; // paginated query continuation
  isDone: boolean; // table fully streamed
};
type CursorMap = Record<string, TableCursor>;

type PullPagePayload = {
  changes: Record<string, ChangeBucket>;
  cursors: CursorMap;
  complete: boolean;
  timestamp: number;
};

const emptyBucket = (): ChangeBucket => ({ created: [], updated: [], deleted: [] });
const emptyCursor = (): TableCursor => ({ cursor: null, isDone: false });

// Paginated table fetch: numItems per page, capped per HTTP request by the
// orchestrator. Smaller pages reduce per-query reads (each row + its FK gets
// charge against the 4096 budget); 250 leaves headroom for FK lookups even
// with 5+ FK fields per row.
const TABLE_PAGE_SIZE = 250;

// Per-HTTP-request row budget. Once hit, orchestrator stops paging more tables
// and returns; client loops with the returned cursors.
const PER_REQUEST_ROW_BUDGET = 1500;

const STORE_SCOPED_TABLES: ReadonlyArray<{
  table: SyncTableName;
  fkFields: readonly string[];
}> = [
  { table: "categories", fkFields: ["parentId"] },
  { table: "products", fkFields: ["categoryId"] },
  { table: "modifierGroups", fkFields: [] },
  { table: "modifierOptions", fkFields: ["modifierGroupId"] },
  {
    table: "modifierGroupAssignments",
    fkFields: ["modifierGroupId", "productId", "categoryId"],
  },
  { table: "tables", fkFields: ["currentOrderId"] },
  {
    table: "orders",
    fkFields: ["tableId", "createdBy", "paidBy", "refundedFromOrderId"],
  },
  { table: "orderItems", fkFields: ["orderId", "productId", "voidedBy"] },
  { table: "orderItemModifiers", fkFields: ["orderItemId"] },
  { table: "orderDiscounts", fkFields: ["orderId", "orderItemId", "approvedBy"] },
  {
    table: "orderVoids",
    fkFields: ["orderId", "orderItemId", "approvedBy", "requestedBy", "replacementOrderId"],
  },
  { table: "orderPayments", fkFields: ["orderId", "createdBy"] },
  { table: "settings", fkFields: ["updatedBy"] },
  { table: "appConfig", fkFields: [] },
  { table: "users", fkFields: ["roleId", "storeId"] },
];

type SyncTableName =
  | "categories"
  | "products"
  | "modifierGroups"
  | "modifierOptions"
  | "modifierGroupAssignments"
  | "tables"
  | "orders"
  | "orderItems"
  | "orderItemModifiers"
  | "orderDiscounts"
  | "orderVoids"
  | "orderPayments"
  | "settings"
  | "appConfig"
  | "users"
  | "roles"
  | "stores";

const SYNC_TABLES: ReadonlyArray<SyncTableName> = [
  ...STORE_SCOPED_TABLES.map((t) => t.table),
  "roles",
  "stores",
];

async function toWatermelon(
  ctx: any,
  doc: any,
  fkFields: readonly string[],
  fkCache: Map<string, string | undefined>,
): Promise<WatermelonRow> {
  const out: WatermelonRow = {
    id: doc.clientId ?? (doc._id as string), // pre-backfill rows fall back to _id
    server_id: doc._id as string,
    updated_at: (doc.updatedAt as number | undefined) ?? doc._creationTime,
  };
  for (const [k, val] of Object.entries(doc)) {
    if (k.startsWith("_") || k === "clientId") continue;
    if (k === "updatedAt") {
      out.updated_at = (val as number | undefined) ?? doc._creationTime;
      continue;
    }
    if (fkFields.includes(k) && typeof val === "string") {
      let mapped = fkCache.get(val);
      if (mapped === undefined && !fkCache.has(val)) {
        const fkDoc = await ctx.db.get(val as any);
        mapped = (fkDoc as any)?.clientId ?? val;
        fkCache.set(val, mapped);
      }
      out[k] = mapped;
    } else {
      out[k] = val;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-table page query — runs in its own 4096-read budget
// ---------------------------------------------------------------------------

type TablePageResult = {
  bucket: ChangeBucket;
  continueCursor: string | null;
  isDone: boolean;
};

export const pullTablePage = internalQuery({
  args: {
    storeId: v.id("stores"),
    table: v.string(),
    since: v.number(),
    cursor: v.union(v.string(), v.null()),
    fkFields: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<TablePageResult> => {
    // Single-phase paginated read on by_store_updatedAt. With since>0 we add a
    // gt(updatedAt) range so the index filters at the DB layer; with since===0
    // we drop the range so legacy rows that lack updatedAt still surface (their
    // _creationTime backstops the ordering). All four order-child tables now
    // require storeId in the schema, so there is no longer a "rows missing
    // storeId" path to worry about.
    const fkCache = new Map<string, string | undefined>();
    const bucket = emptyBucket();

    const directPage = await ctx.db
      .query(args.table as any)
      .withIndex("by_store_updatedAt", (q: any) =>
        args.since > 0
          ? q.eq("storeId", args.storeId).gt("updatedAt", args.since)
          : q.eq("storeId", args.storeId),
      )
      .paginate({ cursor: args.cursor, numItems: TABLE_PAGE_SIZE });

    for (const r of directPage.page) {
      const effectiveUpdatedAt = (r.updatedAt as number | undefined) ?? r._creationTime;
      if (effectiveUpdatedAt <= args.since) continue;
      bucket[r._creationTime > args.since ? "created" : "updated"].push(
        await toWatermelon(ctx, r, args.fkFields, fkCache),
      );
    }

    return {
      bucket: dedupePulledBucket(bucket),
      continueCursor: directPage.isDone ? null : directPage.continueCursor,
      isDone: directPage.isDone,
    };
  },
});

// ---------------------------------------------------------------------------
// Roles + the user's own store row — non-store-scoped, always one tiny page
// ---------------------------------------------------------------------------

export const pullRolesAndStorePage = internalQuery({
  args: { storeId: v.id("stores"), since: v.number() },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<{ rolesBucket: ChangeBucket; storesBucket: ChangeBucket }> => {
    const fkCache = new Map<string, string | undefined>();

    const roles = await ctx.db.query("roles").collect();
    const rolesBucket = emptyBucket();
    for (const r of roles) {
      const effectiveUpdatedAt = (r.updatedAt as number | undefined) ?? r._creationTime;
      if (effectiveUpdatedAt <= args.since) continue;
      rolesBucket[r._creationTime > args.since ? "created" : "updated"].push(
        await toWatermelon(ctx, r, [], fkCache),
      );
    }

    const storesBucket = emptyBucket();
    const storeDoc = await ctx.db.get(args.storeId);
    if (storeDoc) {
      const isCreated = storeDoc._creationTime > args.since;
      const lastTouched = storeDoc.updatedAt ?? storeDoc._creationTime;
      if (lastTouched > args.since) {
        storesBucket[isCreated ? "created" : "updated"].push(
          await toWatermelon(ctx, storeDoc, ["parentId"], fkCache),
        );
      }
    }

    return {
      rolesBucket: dedupePulledBucket(rolesBucket),
      storesBucket: dedupePulledBucket(storesBucket),
    };
  },
});

// ---------------------------------------------------------------------------
// Orchestrator — one HTTP request worth of pages
// ---------------------------------------------------------------------------

export const syncPullPage = internalAction({
  args: {
    storeId: v.id("stores"),
    lastPulledAt: v.optional(v.number()),
    cursors: v.optional(v.any()),
    serverNow: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<PullPagePayload> => {
    const since = args.lastPulledAt ?? 0;
    const inputCursors = (args.cursors ?? {}) as CursorMap;

    // Stamp the server timestamp on the FIRST page only. Client echoes it back
    // on subsequent pages, so the lastPulledAt the client commits is always the
    // moment the pull started — anything written during pull is captured next time.
    const isFirstPage = !args.cursors || Object.keys(inputCursors).length === 0;
    const timestamp = isFirstPage ? Date.now() : (args.serverNow ?? Date.now());

    const outCursors: CursorMap = { ...inputCursors };
    const changes: Record<string, ChangeBucket> = {};
    let rowsThisRequest = 0;

    // First-page only: roles + store doc (cheap, single query, never paginated)
    if (isFirstPage) {
      const { rolesBucket, storesBucket } = (await ctx.runQuery(
        internal.sync.pullRolesAndStorePage,
        { storeId: args.storeId, since },
      )) as { rolesBucket: ChangeBucket; storesBucket: ChangeBucket };
      changes.roles = rolesBucket;
      changes.stores = storesBucket;
      outCursors.roles = { cursor: null, isDone: true };
      outCursors.stores = { cursor: null, isDone: true };
      rowsThisRequest +=
        rolesBucket.created.length +
        rolesBucket.updated.length +
        storesBucket.created.length +
        storesBucket.updated.length;
    }

    // Page each store-scoped table in declaration order, stopping when
    // the per-request row budget is hit.
    for (const { table, fkFields } of STORE_SCOPED_TABLES) {
      const cursorState = outCursors[table] ?? emptyCursor();
      if (cursorState.isDone) {
        outCursors[table] = cursorState;
        continue;
      }
      if (rowsThisRequest >= PER_REQUEST_ROW_BUDGET) {
        outCursors[table] = cursorState;
        continue;
      }

      const result = (await ctx.runQuery(internal.sync.pullTablePage, {
        storeId: args.storeId,
        table,
        since,
        cursor: cursorState.cursor,
        fkFields: [...fkFields],
      })) as TablePageResult;

      const existing = changes[table] ?? emptyBucket();
      changes[table] = mergeBuckets(existing, result.bucket);
      outCursors[table] = {
        cursor: result.continueCursor,
        isDone: result.isDone,
      };
      rowsThisRequest += result.bucket.created.length + result.bucket.updated.length;
    }

    const complete = SYNC_TABLES.every((t) => (outCursors[t] ?? emptyCursor()).isDone);

    return { changes, cursors: outCursors, complete, timestamp };
  },
});

function mergeBuckets(a: ChangeBucket, b: ChangeBucket): ChangeBucket {
  const out: ChangeBucket = {
    created: [...a.created, ...b.created],
    updated: [...a.updated, ...b.updated],
    deleted: [...a.deleted, ...b.deleted],
  };
  return dedupePulledBucket(out);
}

export const syncPull = httpAction(async (ctx, request) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return unauthorized();

  const user = (await ctx.runQuery(internal.sync.getUserStoreScopeInternal, { userId })) as {
    storeId: Id<"stores">;
  } | null;
  if (!user?.storeId) return forbidden("User has no store");

  const body = (await request.json()) as {
    lastPulledAt?: unknown;
    cursors?: unknown;
    serverNow?: unknown;
  };
  const lastPulledAt = typeof body.lastPulledAt === "number" ? body.lastPulledAt : undefined;
  const cursors =
    body.cursors && typeof body.cursors === "object" ? (body.cursors as CursorMap) : undefined;
  const serverNow = typeof body.serverNow === "number" ? body.serverNow : undefined;

  const result = await ctx.runAction(internal.sync.syncPullPage, {
    storeId: user.storeId,
    lastPulledAt,
    cursors,
    serverNow,
  });
  return json(result);
});

// Internal helper to resolve a userId to its scoped store, used by
// the HTTP entry points (which receive a userId from getAuthUserId).
export const getUserStoreScopeInternal = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.object({ storeId: v.id("stores") }), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.storeId || user.isActive === false) return null;
    return { storeId: user.storeId };
  },
});

// ---------------------------------------------------------------------------
// /sync/push — write Watermelon-shaped changes back into Convex
// ---------------------------------------------------------------------------

type PushChange = { id: string; [k: string]: unknown };
type PushPayload = {
  lastPulledAt: number;
  changes: Record<string, { created: PushChange[]; updated: PushChange[]; deleted?: string[] }>;
  clientMutationId: string;
};
type PushRejection = { table: string; clientId: string; reason: string };
type PushResponse = { success: true } | { rejected: PushRejection[] };

const PUSH_TABLE_ORDER = [
  "orders",
  "tables",
  "orderItems",
  "orderItemModifiers",
  "orderDiscounts",
  "orderPayments",
  "orderVoids",
  "auditLogs",
] as const;

function dedupePulledBucket(bucket: ChangeBucket): ChangeBucket {
  const chosen = new Map<string, { row: WatermelonRow; bucketName: "created" | "updated" }>();

  for (const bucketName of ["created", "updated"] as const) {
    for (const row of bucket[bucketName] ?? []) {
      const previous = chosen.get(row.id);
      if (!previous || shouldPreferPulledRow(row, previous.row)) {
        chosen.set(row.id, { row, bucketName });
      }
    }
  }

  const out = emptyBucket();
  for (const { row, bucketName } of chosen.values()) {
    out[bucketName].push(row);
  }
  out.deleted = bucket.deleted;
  return out;
}

function shouldPreferPulledRow(candidate: WatermelonRow, current: WatermelonRow): boolean {
  const candidateUpdatedAt = rowSyncTimestamp(candidate);
  const currentUpdatedAt = rowSyncTimestamp(current);
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt;
  }

  // If a legacy document lacks clientId and a newer duplicate was created with
  // clientId equal to that legacy _id, both map to the same Watermelon id.
  // Prefer the document that has a distinct Convex server id because it is the
  // row future pushes will resolve through by_clientId.
  return candidate.server_id !== candidate.id && current.server_id === current.id;
}

function rowSyncTimestamp(row: WatermelonRow): number {
  const updatedAt = row.updated_at;
  if (typeof updatedAt === "number") return updatedAt;
  const createdAt = row.createdAt;
  if (typeof createdAt === "number") return createdAt;
  return 0;
}

export const syncPushCore = internalMutation({
  args: {
    storeId: v.id("stores"),
    userId: v.id("users"),
    deviceId: v.string(),
    payload: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<PushResponse> => {
    const payload = args.payload as PushPayload;

    // Idempotency: if we've seen this clientMutationId before, return the cached response.
    const cached = await ctx.db
      .query("syncedMutations")
      .withIndex("by_clientMutationId", (q) => q.eq("clientMutationId", payload.clientMutationId))
      .first();
    if (cached) return JSON.parse(cached.response) as PushResponse;

    const rejected: PushRejection[] = [];

    // Cached lookup: clientId → Convex _id, scoped per push
    const fkCache = new Map<string, string | undefined>();

    const resolveFk = async (
      table: string,
      clientId: string | undefined,
    ): Promise<string | undefined> => {
      if (!clientId) return undefined;
      const cacheKey = `${table}:${clientId}`;
      if (fkCache.has(cacheKey)) return fkCache.get(cacheKey);
      const doc = await findSyncedDoc(ctx, table, clientId);
      const id = doc?._id as string | undefined;
      fkCache.set(cacheKey, id);
      return id;
    };

    for (const table of PUSH_TABLE_ORDER) {
      const tableChanges = payload.changes?.[table];
      if (!tableChanges) continue;
      for (const syncId of tableChanges.deleted ?? []) {
        try {
          await applyPushedDelete({ ctx, table, syncId });
        } catch (e) {
          rejected.push({
            table,
            clientId: syncId,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
      for (const row of [...(tableChanges.created ?? []), ...(tableChanges.updated ?? [])]) {
        try {
          await applyPushedRow({
            ctx,
            table,
            row,
            storeId: args.storeId,
            userId: args.userId,
            deviceId: args.deviceId,
            resolveFk,
          });
        } catch (e) {
          rejected.push({
            table,
            clientId: row.id,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const response: PushResponse = rejected.length > 0 ? { rejected } : { success: true };
    await ctx.db.insert("syncedMutations", {
      clientMutationId: payload.clientMutationId,
      storeId: args.storeId,
      response: JSON.stringify(response),
      createdAt: Date.now(),
    });
    return response;
  },
});

type ApplyArgs = {
  ctx: any;
  table: (typeof PUSH_TABLE_ORDER)[number];
  row: PushChange;
  storeId: Id<"stores">;
  userId: Id<"users">;
  deviceId: string;
  resolveFk: (table: string, clientId: string | undefined) => Promise<string | undefined>;
};

type DeleteArgs = {
  ctx: any;
  table: (typeof PUSH_TABLE_ORDER)[number];
  syncId: string;
};

async function findExistingSyncedRow(
  ctx: any,
  table: (typeof PUSH_TABLE_ORDER)[number],
  syncId: string,
): Promise<any | null> {
  return findSyncedDoc(ctx, table, syncId);
}

async function findSyncedDoc(ctx: any, table: string, syncId: string): Promise<any | null> {
  const byClientId = await ctx.db
    .query(table as any)
    .withIndex("by_clientId", (q: any) => q.eq("clientId", syncId))
    .first();
  if (byClientId) return byClientId;

  let convexId: string | null = null;
  try {
    convexId = ctx.db.normalizeId(table, syncId);
  } catch {
    convexId = null;
  }
  if (!convexId) return null;

  const byConvexId = await ctx.db.get(convexId);
  if (!byConvexId) return null;
  return byConvexId;
}

async function applyPushedDelete({ ctx, table, syncId }: DeleteArgs): Promise<void> {
  if (table !== "orderDiscounts") return;

  const existing = await findSyncedDoc(ctx, table, syncId);
  if (!existing) return;
  await ctx.db.delete(existing._id);
}

async function resolveActorId(
  resolveFk: (table: string, clientId: string | undefined) => Promise<string | undefined>,
  actorId: unknown,
  fallbackUserId: Id<"users">,
): Promise<Id<"users">> {
  if (typeof actorId !== "string" || actorId.length === 0) return fallbackUserId;
  const resolved = await resolveFk("users", actorId);
  return (resolved ?? fallbackUserId) as Id<"users">;
}

async function resolveProductIdForOrderItem(
  ctx: any,
  args: {
    resolveFk: (table: string, clientId: string | undefined) => Promise<string | undefined>;
    productId: unknown;
    productName: unknown;
    storeId: Id<"stores">;
  },
): Promise<Id<"products"> | undefined> {
  const resolved = (await args.resolveFk("products", args.productId as string | undefined)) as
    | Id<"products">
    | undefined;
  if (resolved) return resolved;

  if (typeof args.productName !== "string" || args.productName.trim().length === 0) {
    return undefined;
  }

  // Indexed lookup by (storeId, name). Reads only rows that match the name —
  // the previous .collect() on by_store scanned every product in the store,
  // which exceeds the 4096-read mutation budget on large catalogs.
  const matchingProducts = await ctx.db
    .query("products")
    .withIndex("by_store_name", (q: any) =>
      q.eq("storeId", args.storeId).eq("name", args.productName),
    )
    .collect();

  if (matchingProducts.length === 1) {
    return matchingProducts[0]._id as Id<"products">;
  }

  return undefined;
}

async function resolveOrderNumber(
  ctx: any,
  args: {
    storeId: Id<"stores">;
    clientId: string;
    deviceId: string;
    orderType: Doc<"orders">["orderType"];
    incomingOrderNumber?: string;
  },
): Promise<string> {
  // 1. Honor an incoming order number if it doesn't conflict with an existing
  //    order owned by a different clientId. Indexed eq lookup, O(1).
  const incoming = args.incomingOrderNumber;
  if (incoming && !(await orderNumberConflicts(ctx, args.storeId, incoming, args.clientId))) {
    return incoming;
  }

  // 2. Otherwise, generate the next number using a counter on the device doc.
  //    First call per (device, prefix) bootstraps the counter with one indexed
  //    .first() read; subsequent calls are O(1) read + 1 patch.
  const device = await ctx.db
    .query("syncDevices")
    .withIndex("by_deviceId", (q: any) => q.eq("deviceId", args.deviceId))
    .first();
  const deviceCode = await resolveDeviceCode(ctx, args.storeId, args.deviceId);
  const prefix = `${args.orderType === "dine_in" ? "D" : "T"}-${deviceCode}`;

  let nextSuffix: number;
  if (device) {
    const counters = device.orderNumberCounters ?? {};
    let current = counters[prefix];
    if (current === undefined) {
      // Bootstrap: lex-greatest order number with this prefix has the largest
      // numeric suffix as long as padding is consistent (we always pad to 3
      // digits). One read.
      const last = await ctx.db
        .query("orders")
        .withIndex("by_store_orderNumber", (q: any) =>
          q
            .eq("storeId", args.storeId)
            .gte("orderNumber", prefix)
            .lt("orderNumber", `${prefix}\uffff`),
        )
        .order("desc")
        .first();
      const parsed = last?.orderNumber
        ? Number.parseInt((last.orderNumber as string).slice(prefix.length), 10)
        : 0;
      current = Number.isFinite(parsed) ? parsed : 0;
    }
    nextSuffix = current + 1;
    await ctx.db.patch(device._id, {
      orderNumberCounters: { ...counters, [prefix]: nextSuffix },
    });
  } else {
    // Device row missing — should never happen post-registerDevice, but fall
    // back to the indexed bootstrap so we still produce a non-colliding number.
    const last = await ctx.db
      .query("orders")
      .withIndex("by_store_orderNumber", (q: any) =>
        q
          .eq("storeId", args.storeId)
          .gte("orderNumber", prefix)
          .lt("orderNumber", `${prefix}\uffff`),
      )
      .order("desc")
      .first();
    const parsed = last?.orderNumber
      ? Number.parseInt((last.orderNumber as string).slice(prefix.length), 10)
      : 0;
    nextSuffix = (Number.isFinite(parsed) ? parsed : 0) + 1;
  }

  return `${prefix}${String(nextSuffix).padStart(3, "0")}`;
}

async function orderNumberConflicts(
  ctx: any,
  storeId: Id<"stores">,
  orderNumber: string,
  clientId: string,
): Promise<boolean> {
  // Indexed eq lookup on (storeId, orderNumber) — at most one row matches.
  const existing = await ctx.db
    .query("orders")
    .withIndex("by_store_orderNumber", (q: any) =>
      q.eq("storeId", storeId).eq("orderNumber", orderNumber),
    )
    .first();
  return !!existing && existing.clientId !== clientId;
}

async function resolveDeviceCode(
  ctx: any,
  storeId: Id<"stores">,
  deviceId: string,
): Promise<string> {
  const device = await ctx.db
    .query("syncDevices")
    .withIndex("by_deviceId", (q: any) => q.eq("deviceId", deviceId))
    .first();

  if (device?.storeId === storeId && device.deviceCode) return device.deviceCode;
  return (
    deviceId
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 4)
      .toUpperCase() || "X"
  );
}

async function applyPushedRow({
  ctx,
  table,
  row: rawRow,
  storeId,
  userId,
  deviceId,
  resolveFk,
}: ApplyArgs): Promise<void> {
  const row = Object.fromEntries(
    Object.entries(rawRow).map(([k, v]) => [k, v ?? undefined]),
  ) as PushChange;
  const existing = await findExistingSyncedRow(ctx, table, row.id);

  switch (table) {
    case "orders": {
      // Conflict rule: paid/voided orders are normally frozen, but allow:
      //   - paid → voided  (offline-first void/refund of a completed order)
      //   - voided → voided (idempotent no-op replay from a retry)
      const incomingStatus = row.status as Doc<"orders">["status"] | undefined;
      const isPaidToVoided = existing?.status === "paid" && incomingStatus === "voided";
      const isPaidReplay =
        existing?.status === "paid" &&
        incomingStatus === "paid" &&
        (!existing.originDeviceId || existing.originDeviceId === deviceId);
      const isPaidWorkflowUpdate =
        existing?.status === "paid" &&
        incomingStatus === "paid" &&
        existing.orderType === "takeout" &&
        row.takeoutStatus !== undefined;
      const isVoidedReplay = existing?.status === "voided" && incomingStatus === "voided";
      if (
        existing &&
        (existing.status === "paid" || existing.status === "voided") &&
        !isPaidToVoided &&
        !isPaidReplay &&
        !isPaidWorkflowUpdate &&
        !isVoidedReplay
      ) {
        throw new Error("Order is closed");
      }
      // Origin tablet wins for open orders. For paid → voided we relax this
      // so a paid order can be refunded/voided from any device in the store.
      if (
        existing?.originDeviceId &&
        existing.originDeviceId !== deviceId &&
        !isPaidToVoided &&
        !isPaidReplay &&
        !isPaidWorkflowUpdate &&
        !isVoidedReplay
      ) {
        throw new Error(`Order is owned by another device (${existing.originDeviceId})`);
      }
      if (existing && isPaidWorkflowUpdate && !isPaidToVoided && !isPaidReplay) {
        await ctx.db.patch(existing._id, {
          takeoutStatus: row.takeoutStatus as Doc<"orders">["takeoutStatus"],
          updatedAt: Date.now(),
        });
        return;
      }
      const tableId = (await resolveFk("tables", row.tableId as string | undefined)) as
        | Id<"tables">
        | undefined;
      const refundedFromOrderId = (await resolveFk(
        "orders",
        row.refundedFromOrderId as string | undefined,
      )) as Id<"orders"> | undefined;
      const data: Partial<Doc<"orders">> = {
        storeId,
        orderNumber:
          existing?.orderNumber ??
          (await resolveOrderNumber(ctx, {
            storeId,
            clientId: row.id,
            deviceId,
            orderType: row.orderType as Doc<"orders">["orderType"],
            incomingOrderNumber: row.orderNumber as string | undefined,
          })),
        orderType: row.orderType as Doc<"orders">["orderType"],
        orderChannel: row.orderChannel as Doc<"orders">["orderChannel"],
        takeoutStatus: row.takeoutStatus as Doc<"orders">["takeoutStatus"],
        tableId,
        customerName: row.customerName as string | undefined,
        draftLabel: row.draftLabel as string | undefined,
        status: row.status as Doc<"orders">["status"],
        grossSales: row.grossSales as number,
        vatableSales: row.vatableSales as number,
        vatAmount: row.vatAmount as number,
        vatExemptSales: row.vatExemptSales as number,
        nonVatSales: row.nonVatSales as number,
        discountAmount: row.discountAmount as number,
        netSales: row.netSales as number,
        paymentMethod: row.paymentMethod as Doc<"orders">["paymentMethod"],
        cashReceived: row.cashReceived as number | undefined,
        changeGiven: row.changeGiven as number | undefined,
        cardPaymentType: row.cardPaymentType as string | undefined,
        cardReferenceNumber: row.cardReferenceNumber as string | undefined,
        orderCategory: row.orderCategory as Doc<"orders">["orderCategory"],
        tableMarker: row.tableMarker as string | undefined,
        createdBy: await resolveActorId(resolveFk, row.createdBy, userId),
        createdAt: (row.createdAt as number | undefined) ?? Date.now(),
        paidAt: row.paidAt as number | undefined,
        paidBy:
          row.paidBy != null ? await resolveActorId(resolveFk, row.paidBy, userId) : undefined,
        pax: row.pax as number | undefined,
        tabNumber: row.tabNumber as number | undefined,
        tabName: row.tabName as string | undefined,
        requestId: row.requestId as string | undefined,
        refundedFromOrderId,
        tableName: row.tableName as string | undefined,
        itemCount: row.itemCount as number | undefined,
        clientId: row.id,
        originDeviceId: deviceId,
        updatedAt: Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, data);
      else await ctx.db.insert("orders", data);
      return;
    }
    case "tables": {
      if (!existing) throw new Error("Missing table");
      const currentOrderId = (await resolveFk(
        "orders",
        row.currentOrderId as string | undefined,
      )) as Id<"orders"> | undefined;

      await ctx.db.patch(existing._id, {
        status: row.status as Doc<"tables">["status"],
        currentOrderId,
        updatedAt: Date.now(),
      });
      return;
    }
    case "orderItems": {
      const orderId = (await resolveFk("orders", row.orderId as string | undefined)) as
        | Id<"orders">
        | undefined;
      const productId = await resolveProductIdForOrderItem(ctx, {
        resolveFk,
        productId: row.productId,
        productName: row.productName,
        storeId,
      });
      if (!orderId || !productId) {
        throw new Error("Missing FK: orderId or productId");
      }
      const data: Partial<Doc<"orderItems">> = {
        orderId,
        storeId,
        productId,
        productName: row.productName as string,
        productPrice: row.productPrice as number,
        quantity: row.quantity as number,
        notes: row.notes as string | undefined,
        serviceType: row.serviceType as Doc<"orderItems">["serviceType"],
        isVoided: (row.isVoided as boolean | undefined) ?? false,
        isSentToKitchen: row.isSentToKitchen as boolean | undefined,
        voidedBy:
          row.voidedBy != null ? await resolveActorId(resolveFk, row.voidedBy, userId) : undefined,
        voidedAt: row.voidedAt as number | undefined,
        voidReason: row.voidReason as string | undefined,
        clientId: row.id,
        updatedAt: Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, data);
      else await ctx.db.insert("orderItems", data);
      return;
    }
    case "orderItemModifiers": {
      // Append-only — second-write idempotent skip
      if (existing) return;
      const orderItemId = (await resolveFk("orderItems", row.orderItemId as string | undefined)) as
        | Id<"orderItems">
        | undefined;
      if (!orderItemId) throw new Error("Missing orderItemId FK");
      await ctx.db.insert("orderItemModifiers", {
        orderItemId,
        storeId,
        modifierGroupName: row.modifierGroupName as string,
        modifierOptionName: row.modifierOptionName as string,
        priceAdjustment: row.priceAdjustment as number,
        clientId: row.id,
        updatedAt: Date.now(),
      });
      return;
    }
    case "orderDiscounts": {
      if (existing) return; // append-only
      const orderId = (await resolveFk("orders", row.orderId as string | undefined)) as
        | Id<"orders">
        | undefined;
      if (!orderId) throw new Error("Missing orderId FK");
      const orderItemId = (await resolveFk("orderItems", row.orderItemId as string | undefined)) as
        | Id<"orderItems">
        | undefined;
      await ctx.db.insert("orderDiscounts", {
        orderId,
        storeId,
        orderItemId,
        discountType: row.discountType as Doc<"orderDiscounts">["discountType"],
        customerName: row.customerName as string,
        customerId: row.customerId as string,
        quantityApplied: row.quantityApplied as number,
        discountAmount: row.discountAmount as number,
        vatExemptAmount: row.vatExemptAmount as number,
        approvedBy: await resolveActorId(resolveFk, row.approvedBy, userId),
        createdAt: (row.createdAt as number | undefined) ?? Date.now(),
        clientId: row.id,
        updatedAt: Date.now(),
      });
      return;
    }
    case "orderPayments": {
      if (existing) return; // append-only
      const orderId = (await resolveFk("orders", row.orderId as string | undefined)) as
        | Id<"orders">
        | undefined;
      if (!orderId) throw new Error("Missing orderId FK");
      await ctx.db.insert("orderPayments", {
        orderId,
        storeId,
        paymentMethod: row.paymentMethod as Doc<"orderPayments">["paymentMethod"],
        amount: row.amount as number,
        cashReceived: row.cashReceived as number | undefined,
        changeGiven: row.changeGiven as number | undefined,
        cardPaymentType: row.cardPaymentType as string | undefined,
        cardReferenceNumber: row.cardReferenceNumber as string | undefined,
        createdAt: (row.createdAt as number | undefined) ?? Date.now(),
        createdBy: await resolveActorId(resolveFk, row.createdBy, userId),
        clientId: row.id,
        updatedAt: Date.now(),
      });
      return;
    }
    case "orderVoids": {
      if (existing) return; // append-only
      const orderId = (await resolveFk("orders", row.orderId as string | undefined)) as
        | Id<"orders">
        | undefined;
      if (!orderId) throw new Error("Missing orderId FK");
      const orderItemId = (await resolveFk("orderItems", row.orderItemId as string | undefined)) as
        | Id<"orderItems">
        | undefined;
      const replacementOrderId = (await resolveFk(
        "orders",
        row.replacementOrderId as string | undefined,
      )) as Id<"orders"> | undefined;
      await ctx.db.insert("orderVoids", {
        orderId,
        storeId,
        voidType: row.voidType as Doc<"orderVoids">["voidType"],
        orderItemId,
        reason: row.reason as string,
        approvedBy: await resolveActorId(resolveFk, row.approvedBy, userId),
        requestedBy: await resolveActorId(resolveFk, row.requestedBy, userId),
        amount: row.amount as number,
        createdAt: (row.createdAt as number | undefined) ?? Date.now(),
        refundMethod: row.refundMethod as Doc<"orderVoids">["refundMethod"],
        replacementOrderId,
        clientId: row.id,
        updatedAt: Date.now(),
      });
      return;
    }
    case "auditLogs": {
      if (existing) return; // append-only, idempotent
      await ctx.db.insert("auditLogs", {
        storeId,
        action: row.action as string,
        entityType: row.entityType as string,
        entityId: row.entityId as string,
        details: row.details as string,
        userId: await resolveActorId(resolveFk, row.userId, userId),
        createdAt: (row.createdAt as number | undefined) ?? Date.now(),
        clientId: row.id,
        updatedAt: Date.now(),
      });
      return;
    }
  }
}

export const syncPush = httpAction(async (ctx, request) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return unauthorized();

  const user = (await ctx.runQuery(internal.sync.getUserStoreScopeInternal, { userId })) as {
    storeId: Id<"stores">;
  } | null;
  if (!user?.storeId) return forbidden("User has no store");

  const deviceId = request.headers.get("x-device-id");
  if (!deviceId) return badRequest("Missing x-device-id header");

  const payload = (await request.json()) as PushPayload;
  if (typeof payload?.clientMutationId !== "string") {
    return badRequest("Missing clientMutationId");
  }

  const result = await ctx.runMutation(internal.sync.syncPushCore, {
    storeId: user.storeId,
    userId,
    deviceId,
    payload,
  });
  return json(result);
});

// Suppress unused import warning — newClientId is intentionally exported via lib/sync,
// kept here as a re-export so domain mutations can `import { newClientId } from "../sync"`.
export { newClientId };
