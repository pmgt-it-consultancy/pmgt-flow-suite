import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";
import { activeDeviceBinding } from "./lib/deviceBinding";
import { requirePermission } from "./lib/permissions";
import { appendReplicationEvent } from "./lib/replicationEvents";
import {
  pendingTotalsReconciliations,
  scheduleTotalsReconciliation,
  unresolvedTotalsDivergences,
} from "./lib/totalsReconciliation";

const STREAM = "operational_orders";
const CLOCK_DRIFT_WARNING_MS = 2 * 60 * 1000;
const CLOCK_DRIFT_BLOCK_MS = 10 * 60 * 1000;

export const getPendingTotalsReconciliations = query({
  args: { storeId: v.id("stores"), reportDate: v.string() },
  returns: v.array(
    v.object({
      jobId: v.id("totalsReconciliationJobs"),
      orderId: v.id("orders"),
      mutationId: v.string(),
      status: v.union(v.literal("pending"), v.literal("failed")),
      blockedReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user || user.storeId !== args.storeId) throw new Error("Authentication required");
    const jobs = await pendingTotalsReconciliations(ctx, args.storeId, args.reportDate).collect();
    return Promise.all(
      jobs.map(async (job) => {
        const scheduled = job.scheduledFunctionId
          ? await ctx.db.system.get(job.scheduledFunctionId)
          : null;
        const status =
          !job.blockedReason &&
          (scheduled?.state.kind === "pending" || scheduled?.state.kind === "inProgress")
            ? ("pending" as const)
            : ("failed" as const);
        return {
          jobId: job._id,
          orderId: job.orderId,
          mutationId: job.mutationId,
          status,
          blockedReason: job.blockedReason,
        };
      }),
    );
  },
});

export const retryTotalsReconciliation = mutation({
  args: { jobId: v.id("totalsReconciliationJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!user || !job || user.storeId !== job.storeId) throw new Error("Authentication required");
    await requirePermission(ctx, user._id, "reports.print_eod");
    if (job.status === "pending") await scheduleTotalsReconciliation(ctx, job._id);
    return null;
  },
});

export const getTotalsDivergences = query({
  args: { storeId: v.id("stores"), reportDate: v.string() },
  returns: v.array(
    v.object({
      orderId: v.id("orders"),
      deviceTotals: v.record(v.string(), v.number()),
      reconciledTotals: v.record(v.string(), v.number()),
      fields: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user || user.storeId !== args.storeId) throw new Error("Authentication required");
    const records = await unresolvedTotalsDivergences(ctx, args.storeId, args.reportDate);
    return records.map(({ orderId, deviceTotals, reconciledTotals, fields }) => ({
      orderId,
      deviceTotals,
      reconciledTotals,
      fields,
    }));
  },
});

async function readiness(ctx: { db: any }, storeId: any) {
  const devices = await ctx.db
    .query("syncDevices")
    .withIndex("by_storeId_deviceCode", (q: any) => q.eq("storeId", storeId))
    .collect();
  const missingDeviceIds: string[] = [];
  const attentionDeviceIds: string[] = [];
  const clockWarningDeviceIds: string[] = [];
  for (const device of devices) {
    const state = await ctx.db
      .query("deviceSyncStates")
      .withIndex("by_store_device_stream", (q: any) =>
        q.eq("storeId", storeId).eq("deviceId", device.deviceId).eq("stream", STREAM),
      )
      .unique();
    if (state?.status === "retired") continue;
    if (!state) missingDeviceIds.push(device.deviceId);
    else if (state.status === "attention_required" || state.pendingCount > 0)
      attentionDeviceIds.push(device.deviceId);
    if ((state?.clockDriftMs ?? 0) > CLOCK_DRIFT_WARNING_MS)
      clockWarningDeviceIds.push(device.deviceId);
  }
  return {
    ready: missingDeviceIds.length === 0 && attentionDeviceIds.length === 0,
    missingDeviceIds,
    attentionDeviceIds,
    clockWarningDeviceIds,
  };
}

async function upsertDeviceState(
  ctx: { db: any },
  args: {
    storeId: any;
    deviceId: string;
    generation: string;
    checkpoint?: string;
    pendingCount: number;
    clientNow: number;
  },
) {
  const device = await activeDeviceBinding(ctx, args.deviceId);
  if (!device || device.storeId !== args.storeId) throw new Error("Device is not registered");
  const now = Date.now();
  const clockDriftMs = Math.abs(now - args.clientNow);
  const existing = await ctx.db
    .query("deviceSyncStates")
    .withIndex("by_store_device_stream", (q: any) =>
      q.eq("storeId", args.storeId).eq("deviceId", args.deviceId).eq("stream", STREAM),
    )
    .unique();
  const value = {
    storeId: args.storeId,
    deviceId: args.deviceId,
    stream: STREAM,
    generation: args.generation,
    checkpoint: args.checkpoint,
    pendingCount: args.pendingCount,
    status:
      args.pendingCount > 0 || clockDriftMs > CLOCK_DRIFT_BLOCK_MS
        ? ("attention_required" as const)
        : ("active" as const),
    clockDriftMs,
    updatedAt: now,
  };
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("deviceSyncStates", value);
  return readiness(ctx, args.storeId);
}

export const confirmReadyForDayClosing = mutation({
  args: {
    storeId: v.id("stores"),
    deviceId: v.string(),
    generation: v.string(),
    checkpoint: v.optional(v.string()),
    pendingCount: v.number(),
    clientNow: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user || user.storeId !== args.storeId) throw new Error("Authentication required");
    return upsertDeviceState(ctx, args);
  },
});

export const confirmDeviceStateCore = internalMutation({
  args: {
    storeId: v.id("stores"),
    deviceId: v.string(),
    generation: v.string(),
    checkpoint: v.optional(v.string()),
    pendingCount: v.number(),
    clientNow: v.number(),
  },
  returns: v.any(),
  handler: upsertDeviceState,
});

export const getDayClosingReadiness = query({
  args: { storeId: v.id("stores") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user || user.storeId !== args.storeId) throw new Error("Authentication required");
    return readiness(ctx, args.storeId);
  },
});

export const retireDevice = mutation({
  args: { storeId: v.id("stores"), deviceId: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user || user.storeId !== args.storeId) throw new Error("Authentication required");
    const existing = await ctx.db
      .query("deviceSyncStates")
      .withIndex("by_store_device_stream", (q) =>
        q.eq("storeId", args.storeId).eq("deviceId", args.deviceId).eq("stream", STREAM),
      )
      .unique();
    const value = {
      storeId: args.storeId,
      deviceId: args.deviceId,
      stream: STREAM,
      generation: existing?.generation ?? "retired",
      checkpoint: existing?.checkpoint,
      pendingCount: 0,
      status: "retired" as const,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("deviceSyncStates", value);
    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "sync_device_retired",
      entityType: "syncDevice",
      entityId: args.deviceId,
      details: JSON.stringify({ reason: args.reason }),
      userId: user._id,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const logDayClosing = mutation({
  args: {
    storeId: v.id("stores"),
    reportDate: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }
    if (await pendingTotalsReconciliations(ctx, args.storeId, args.reportDate).first()) {
      throw new Error(
        "Totals Reconciliation pending; complete or retry the check before final day closing",
      );
    }
    const divergences = await unresolvedTotalsDivergences(ctx, args.storeId, args.reportDate);
    if (divergences.length > 0) {
      throw new Error("Unresolved Totals Divergences require attention before final day closing");
    }
    const closingFlag = await ctx.db
      .query("appConfig")
      .withIndex("by_store_key", (q) =>
        q.eq("storeId", args.storeId).eq("key", "sync_clean_closing_v2"),
      )
      .first();
    if (closingFlag?.value === "1") {
      const syncReadiness = await readiness(ctx, args.storeId);
      if (!syncReadiness.ready) {
        throw new Error("All active devices must be sync-clean before final day closing");
      }
      const existingFinal = await ctx.db
        .query("businessDayReportRevisions")
        .withIndex("by_store_date_status", (q) =>
          q.eq("storeId", args.storeId).eq("reportDate", args.reportDate).eq("status", "final"),
        )
        .first();
      if (existingFinal) return null;
      const revisions = await ctx.db
        .query("businessDayReportRevisions")
        .withIndex("by_store_date_revision", (q) =>
          q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
        )
        .collect();
      const report = await ctx.db
        .query("dailyReports")
        .withIndex("by_store_date", (q) =>
          q.eq("storeId", args.storeId).eq("reportDate", args.reportDate),
        )
        .first();
      const revision =
        revisions.reduce((max: number, item: any) => Math.max(max, item.revision), 0) + 1;
      await ctx.db.insert("businessDayReportRevisions", {
        storeId: args.storeId,
        reportDate: args.reportDate,
        revision,
        status: "final",
        missingDeviceIds: [],
        snapshot: JSON.stringify(report ?? {}),
        generatedAt: Date.now(),
        generatedBy: user._id,
      });
      await appendReplicationEvent(ctx, {
        storeId: args.storeId,
        stream: "operational_orders",
        entityType: "businessDay",
        entityId: args.reportDate,
        aggregateVersion: revision,
        eventKind: "business_day_settled",
      });
    }
    await ctx.db.insert("auditLogs", {
      storeId: args.storeId,
      action: "day_closing",
      entityType: "dailyReports",
      entityId: args.reportDate,
      details: JSON.stringify({
        reportDate: args.reportDate,
        closedBy: user.name ?? "Unknown",
      }),
      userId: user._id,
      createdAt: Date.now(),
    });
    return null;
  },
});
