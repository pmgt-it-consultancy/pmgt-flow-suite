import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthenticatedUser } from "./lib/auth";

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
