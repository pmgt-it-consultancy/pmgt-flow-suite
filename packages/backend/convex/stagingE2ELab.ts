"use node";

import { createAccount } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { requireStagingLab } from "./lib/stagingLab";

type Preparation = {
  storeId: Id<"stores">;
  managerRoleId: Id<"roles">;
  cashierRoleId: Id<"roles">;
  created: boolean;
};

type ProvisionResult = {
  storeId: Id<"stores">;
  managerUserId: Id<"users">;
  cashierUserId: Id<"users">;
  storeCreated: boolean;
};

const prepareRef = makeFunctionReference<"mutation", Record<string, never>, Preparation>(
  "stagingE2ELabData:prepareLab",
);
const assignRef = makeFunctionReference<
  "mutation",
  { userId: Id<"users">; storeId: Id<"stores">; roleId: Id<"roles"> },
  null
>("stagingE2ELabData:assignUser");
const accountByEmailRef = makeFunctionReference<
  "query",
  { email: string },
  { accountId: Id<"authAccounts">; userId: Id<"users"> } | null
>("helpers/usersHelpers:getAuthAccountByEmail");

export const provisionLab = action({
  args: {
    managerEmail: v.string(),
    managerPassword: v.string(),
    cashierEmail: v.string(),
    cashierPassword: v.string(),
  },
  returns: v.object({
    storeId: v.id("stores"),
    managerUserId: v.id("users"),
    cashierUserId: v.id("users"),
    storeCreated: v.boolean(),
  }),
  handler: async (ctx, args): Promise<ProvisionResult> => {
    requireStagingLab();
    for (const [email, password] of [
      [args.managerEmail, args.managerPassword],
      [args.cashierEmail, args.cashierPassword],
    ]) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid lab email");
      if (password.length < 12) throw new Error("Lab passwords must be at least 12 characters");
    }
    if (args.managerEmail.toLowerCase() === args.cashierEmail.toLowerCase()) {
      throw new Error("Manager and Cashier emails must differ");
    }

    const lab = await ctx.runMutation(prepareRef, {});
    const ensureAccount = async (
      email: string,
      password: string,
      name: string,
    ): Promise<Id<"users">> => {
      const normalizedEmail = email.toLowerCase();
      const existing = await ctx.runQuery(accountByEmailRef, {
        email: normalizedEmail,
      });
      if (existing) return existing.userId;
      const { user } = await createAccount(ctx, {
        provider: "password",
        account: { id: normalizedEmail, secret: password },
        profile: { name, email: normalizedEmail },
      });
      return user._id;
    };

    const managerUserId = await ensureAccount(
      args.managerEmail,
      args.managerPassword,
      "Bounded Sync Manager",
    );
    const cashierUserId = await ensureAccount(
      args.cashierEmail,
      args.cashierPassword,
      "Bounded Sync Cashier",
    );
    await ctx.runMutation(assignRef, {
      userId: managerUserId,
      storeId: lab.storeId,
      roleId: lab.managerRoleId,
    });
    await ctx.runMutation(assignRef, {
      userId: cashierUserId,
      storeId: lab.storeId,
      roleId: lab.cashierRoleId,
    });
    return {
      storeId: lab.storeId,
      managerUserId,
      cashierUserId,
      storeCreated: lab.created,
    };
  },
});
