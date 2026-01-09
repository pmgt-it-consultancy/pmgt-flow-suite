"use node";

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import bcrypt from "bcryptjs";

// Type definitions for return values
type LoginSuccess = {
  success: true;
  token: string;
  user: {
    id: string;
    username: string;
    name: string;
    roleId: string;
    storeId?: string;
  };
};

type LoginFailure = {
  success: false;
  error: string;
};

type LoginResult = LoginSuccess | LoginFailure;

// Internal query to get user by username
export const getUserByUsername = internalQuery({
  args: { username: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      username: v.string(),
      passwordHash: v.string(),
      name: v.string(),
      roleId: v.id("roles"),
      storeId: v.optional(v.id("stores")),
      isActive: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();

    if (!user) return null;

    return {
      _id: user._id,
      username: user.username,
      passwordHash: user.passwordHash,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      isActive: user.isActive,
    };
  },
});

// Internal query to get user by ID
export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      username: v.string(),
      passwordHash: v.string(),
      name: v.string(),
      roleId: v.id("roles"),
      storeId: v.optional(v.id("stores")),
      isActive: v.boolean(),
      pin: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    if (!user) return null;

    return {
      _id: user._id,
      username: user.username,
      passwordHash: user.passwordHash,
      name: user.name,
      roleId: user.roleId,
      storeId: user.storeId,
      isActive: user.isActive,
      pin: user.pin,
    };
  },
});

// Internal mutation to create session
export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    // Update last login
    await ctx.db.patch(args.userId, { lastLoginAt: Date.now() });

    // Create session
    return await ctx.db.insert("sessions", {
      userId: args.userId,
      token: args.token,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

// Internal mutation to delete session
export const deleteSession = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

// Login action (uses Node.js for bcrypt)
export const login = action({
  args: {
    username: v.string(),
    password: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      token: v.string(),
      user: v.object({
        id: v.string(),
        username: v.string(),
        name: v.string(),
        roleId: v.string(),
        storeId: v.optional(v.string()),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<LoginResult> => {
    // Get user
    const user = await ctx.runQuery(internal.auth.getUserByUsername, {
      username: args.username,
    });

    if (!user) {
      return { success: false as const, error: "Invalid username or password" };
    }

    if (!user.isActive) {
      return { success: false as const, error: "Account is disabled" };
    }

    // Verify password
    const validPassword = await bcrypt.compare(args.password, user.passwordHash);
    if (!validPassword) {
      return { success: false as const, error: "Invalid username or password" };
    }

    // Generate session token
    const token = generateToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Create session
    await ctx.runMutation(internal.auth.createSession, {
      userId: user._id,
      token,
      expiresAt,
    });

    return {
      success: true as const,
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        roleId: user.roleId,
        storeId: user.storeId,
      },
    };
  },
});

// Logout action
export const logout = action({
  args: { token: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.auth.deleteSession, { token: args.token });
    return { success: true };
  },
});

// Helper to generate token
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Hash password (for user creation)
export const hashPassword = action({
  args: { password: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(args.password, salt);
  },
});

// Verify manager PIN
export const verifyManagerPin = action({
  args: {
    userId: v.id("users"),
    pin: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const user = await ctx.runQuery(internal.auth.getUserById, {
      userId: args.userId,
    });

    if (!user || !user.isActive || !user.pin) {
      return false;
    }

    // Compare PIN (stored as bcrypt hash for security)
    return await bcrypt.compare(args.pin, user.pin);
  },
});
