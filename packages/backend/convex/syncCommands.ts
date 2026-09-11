import { getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalMutation } from "./_generated/server";
import { processPaymentCore } from "./checkout";

type CommandEnvelope = {
  operationId: string;
  schemaVersion: number;
  command: Record<string, unknown>;
};

type CommandResult = {
  operationId: string;
  status: "accepted" | "rejected";
  error?: string;
};

function upcast(envelope: CommandEnvelope): CommandEnvelope {
  if (envelope.schemaVersion === 1) return envelope;
  if (envelope.schemaVersion === 0 && typeof envelope.command.type === "string") {
    const { type, ...rest } = envelope.command;
    return { ...envelope, schemaVersion: 1, command: { ...rest, kind: type } };
  }
  throw new Error(`Unsupported command schema version ${envelope.schemaVersion}`);
}

export const applyCommandsCore = internalMutation({
  args: {
    storeId: v.id("stores"),
    userId: v.id("users"),
    deviceId: v.string(),
    commands: v.array(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ results: CommandResult[] }> => {
    const results: CommandResult[] = [];
    for (const rawEnvelope of args.commands as CommandEnvelope[]) {
      const previous = await ctx.db
        .query("businessCommandReceipts")
        .withIndex("by_operation", (q) => q.eq("operationId", rawEnvelope.operationId))
        .unique();
      if (previous) {
        results.push({
          operationId: previous.operationId,
          status: previous.status,
          error: previous.error,
        });
        continue;
      }

      let envelope = rawEnvelope;
      let result: CommandResult;
      try {
        envelope = upcast(rawEnvelope);
        if (!envelope.operationId) throw new Error("operationId is required");
        const kind = envelope.command.kind;
        const aggregateId = envelope.command.aggregateId;
        if (typeof kind !== "string" || typeof aggregateId !== "string") {
          throw new Error("Command kind and aggregateId are required");
        }
        const orderId = aggregateId as Id<"orders">;
        const order = await ctx.db.get(orderId);
        if (!order || order.storeId !== args.storeId) throw new Error("Order not found");

        if (kind === "SettleOrder") {
          if (!Array.isArray(envelope.command.payments)) throw new Error("payments are required");
          await processPaymentCore(
            ctx,
            orderId,
            envelope.command.payments as Array<{
              paymentMethod: "cash" | "card_ewallet";
              amount: number;
              cashReceived?: number;
              cardPaymentType?: string;
              cardReferenceNumber?: string;
            }>,
            args.userId,
            envelope.operationId,
          );
        } else {
          throw new Error(`Unsupported command kind ${kind}`);
        }
        result = { operationId: envelope.operationId, status: "accepted" };
      } catch (error) {
        result = {
          operationId: rawEnvelope.operationId,
          status: "rejected",
          error: error instanceof Error ? error.message : String(error),
        };
      }

      await ctx.db.insert("businessCommandReceipts", {
        operationId: result.operationId,
        storeId: args.storeId,
        deviceId: args.deviceId,
        schemaVersion: envelope.schemaVersion,
        commandKind: String(envelope.command.kind ?? envelope.command.type ?? "unknown"),
        aggregateId: String(envelope.command.aggregateId ?? "unknown"),
        status: result.status,
        error: result.error,
        createdAt: Date.now(),
      });
      results.push(result);
    }
    return { results };
  },
});

const applyCommandsRef = makeFunctionReference<
  "mutation",
  {
    storeId: Id<"stores">;
    userId: Id<"users">;
    deviceId: string;
    commands: unknown[];
  }
>("syncCommands:applyCommandsCore");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const syncV2Commands = httpAction(async (ctx, request) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const user = await ctx.runQuery(internal.sync.getUserStoreScopeInternal, { userId });
  if (!user?.storeId) return json({ error: "User has no store" }, 403);
  const deviceId = request.headers.get("x-device-id");
  if (!deviceId) return json({ error: "Missing x-device-id header" }, 400);
  const body = (await request.json().catch(() => ({}))) as { commands?: unknown };
  if (!Array.isArray(body.commands)) return json({ error: "commands must be an array" }, 400);
  const result = await ctx.runMutation(applyCommandsRef, {
    storeId: user.storeId,
    userId,
    deviceId,
    commands: body.commands,
  });
  return json(result);
});
