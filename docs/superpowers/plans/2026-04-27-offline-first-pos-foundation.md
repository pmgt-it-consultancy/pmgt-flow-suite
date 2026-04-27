# Offline-First POS Foundation (Phases 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the offline-first sync foundation: install WatermelonDB on the tablet, add sync HTTP endpoints + idempotency layer to Convex, build the native data + sync infrastructure. UI does not change yet — foundation lights up the data layer end-to-end (offline writes flow to WatermelonDB → SyncManager → /sync/push → Convex; pulls flow back).

**Architecture:** Tablet uses WatermelonDB v0.28+ as a local SQLite cache; Convex stays server-authoritative. Sync transport is HTTPS, not WebSocket, via three new `httpAction`s (`/sync/pull`, `/sync/push`, `/sync/registerDevice`). Per-tablet UUIDs (`clientId`) on every synced row make IDs collision-free across multi-tablet offline operation. Idempotency cache (`syncedMutations`) makes push retries safe.

**Tech Stack:** WatermelonDB 0.28.x, `@nozbe/with-observables`, Convex `httpAction`, React Native 0.81.5, Expo SDK 54 (new architecture), `@convex-dev/auth`, `@react-native-community/netinfo`, `expo-secure-store`, in-tree Expo config plugin.

**Spec:** [docs/superpowers/specs/2026-04-27-offline-first-pos-tablet-design.md](../specs/2026-04-27-offline-first-pos-tablet-design.md)

---

## Phase 0 — Spike & Verify

The spike runs inside the real codebase, not a throwaway app. We install WatermelonDB end-to-end and verify the JSI adapter boots before the larger refactor.

### Task 0.1 — Install WatermelonDB dependencies

**Files:**
- Modify: `apps/native/package.json`
- Modify: `apps/native/babel.config.js`

- [ ] **Step 1: Install runtime dependencies**

Run from `apps/native/`:
```bash
pnpm add @nozbe/watermelondb@^0.28.0 @nozbe/with-observables@^1.6.0
```

- [ ] **Step 2: Install dev dependencies**

```bash
pnpm add -D @babel/plugin-proposal-decorators
```

- [ ] **Step 3: Update babel config to support decorators**

`apps/native/babel.config.js`:
```js
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ["@babel/plugin-proposal-decorators", { legacy: true }],
      "react-native-worklets/plugin",
    ],
  };
};
```

(Verify whether `react-native-worklets/plugin` is already present — keep existing plugins, just add decorators in front.)

- [ ] **Step 4: Commit**

```bash
git add apps/native/package.json apps/native/babel.config.js apps/native/pnpm-lock.yaml
git commit -m "chore(native): install WatermelonDB v0.28 and decorator support"
```

### Task 0.2 — Author the WatermelonDB Expo config plugin

**Files:**
- Create: `apps/native/plugins/withWatermelonDB.js`
- Modify: `apps/native/app.config.ts`

- [ ] **Step 1: Create the plugin**

Per [DevYuns Nov 2025 recipe](https://github.com/Nozbe/WatermelonDB/issues/1769#issuecomment-3551166833) — adds ProGuard rule + registers `WatermelonDBJSIPackage` in MainApplication.kt.

`apps/native/plugins/withWatermelonDB.js`:
```js
const { withDangerousMod, withProjectBuildGradle } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const PROGUARD_RULE = "-keep class com.nozbe.watermelondb.** { *; }";
const JSI_IMPORT = "import com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage";
const JSI_REGISTER = "add(WatermelonDBJSIPackage())";

function withProguard(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro",
      );
      let contents = fs.existsSync(proguardPath) ? fs.readFileSync(proguardPath, "utf8") : "";
      if (!contents.includes(PROGUARD_RULE)) {
        contents = contents.trimEnd() + "\n\n# WatermelonDB\n" + PROGUARD_RULE + "\n";
        fs.writeFileSync(proguardPath, contents);
      }
      return config;
    },
  ]);
}

function withMainApplication(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const mainAppPath = findMainApplication(config.modRequest.platformProjectRoot);
      if (!mainAppPath) {
        throw new Error("withWatermelonDB: MainApplication.kt not found");
      }
      let src = fs.readFileSync(mainAppPath, "utf8");

      if (!src.includes(JSI_IMPORT)) {
        src = src.replace(
          /(import com\.facebook\.react\.[^\n]+\n)(?!import)/,
          `$1${JSI_IMPORT}\n`,
        );
      }

      if (!src.includes(JSI_REGISTER)) {
        src = src.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (m) => `${m}\n              ${JSI_REGISTER}`,
        );
      }

      fs.writeFileSync(mainAppPath, src);
      return config;
    },
  ]);
}

function findMainApplication(platformRoot) {
  const javaRoot = path.join(platformRoot, "app", "src", "main", "java");
  if (!fs.existsSync(javaRoot)) return null;
  const stack = [javaRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === "MainApplication.kt") return full;
    }
  }
  return null;
}

module.exports = (config) => withMainApplication(withProguard(config));
```

- [ ] **Step 2: Register the plugin in `app.config.ts`**

Add to the `plugins` array (after `withReactNativeArchitectures`):
```ts
plugins: [
  // ... existing plugins
  ["./plugins/withReactNativeArchitectures", "arm64-v8a,x86_64"],
  "./plugins/withWatermelonDB",
  "./plugins/withApkInstaller",
],
```

- [ ] **Step 3: Run prebuild and verify the plugin applied**

```bash
cd apps/native && pnpm prebuild:staging:clean
```

Verify:
```bash
grep -A 1 "WatermelonDB" android/app/proguard-rules.pro
grep -E "WatermelonDBJSIPackage" android/app/src/main/java/com/pmgtitconsultancy/pmgtflow/stg/MainApplication.kt
```

Both should return matches.

- [ ] **Step 4: Commit**

```bash
git add apps/native/plugins/withWatermelonDB.js apps/native/app.config.ts
git commit -m "feat(native): Expo config plugin for WatermelonDB JSI registration"
```

### Task 0.3 — Spike schema + smoke test

**Files:**
- Create: `apps/native/src/db/spike/schema.ts`
- Create: `apps/native/src/db/spike/Product.ts`
- Create: `apps/native/src/db/spike/database.ts`
- Modify: `apps/native/src/App.tsx` (or main entry; add a one-time smoke test on boot)

- [ ] **Step 1: Create minimal spike schema**

`apps/native/src/db/spike/schema.ts`:
```ts
import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const spikeSchema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: "spike_products",
      columns: [
        { name: "name", type: "string" },
        { name: "price", type: "number" },
      ],
    }),
  ],
});
```

- [ ] **Step 2: Create spike Model**

`apps/native/src/db/spike/Product.ts`:
```ts
import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

export class SpikeProduct extends Model {
  static table = "spike_products";

  @field("name") name!: string;
  @field("price") price!: number;
}
```

- [ ] **Step 3: Create database init**

`apps/native/src/db/spike/database.ts`:
```ts
import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { spikeSchema } from "./schema";
import { SpikeProduct } from "./Product";

export function createSpikeDatabase() {
  const adapter = new SQLiteAdapter({
    schema: spikeSchema,
    jsi: true,
    onSetUpError: (error) => {
      console.error("[WatermelonDB spike] setup error:", error);
    },
  });

  return new Database({
    adapter,
    modelClasses: [SpikeProduct],
  });
}
```

- [ ] **Step 4: Add a one-shot smoke test at app boot**

In `apps/native/index.tsx` (or wherever the app initializes), add behind `__DEV__`:

```ts
if (__DEV__) {
  import("./src/db/spike/database").then(async ({ createSpikeDatabase }) => {
    try {
      const db = createSpikeDatabase();
      const collection = db.get<import("./src/db/spike/Product").SpikeProduct>("spike_products");
      await db.write(async () => {
        await collection.create((p) => {
          p.name = "Test";
          p.price = 100;
        });
      });
      const all = await collection.query().fetch();
      console.log(`[WatermelonDB spike] OK — ${all.length} row(s) in spike_products`);
    } catch (err) {
      console.error("[WatermelonDB spike] FAIL —", err);
    }
  });
}
```

- [ ] **Step 5: Build and run on a real Android tablet**

```bash
cd apps/native && pnpm android:staging
```

**Expected logcat output:**
```
[WatermelonDB spike] OK — 1 row(s) in spike_products
```

If you see this — JSI works, schema works, decorators work, plugin works. Spike PASSES.

If you see "[WatermelonDB spike] FAIL —" or the app crashes at boot — STOP. Diagnose using DevYuns recipe + open issues. Do NOT proceed to Phase 1.

- [ ] **Step 6: Validate EAS release build**

```bash
cd apps/native && pnpm build:staging
```

Install the resulting APK on a real tablet. Same smoke test should pass in release mode (verifies ProGuard rule is correctly applied).

- [ ] **Step 7: Remove the spike code (we now know it works)**

```bash
rm -rf apps/native/src/db/spike
```

Remove the `if (__DEV__)` block from `index.tsx`.

- [ ] **Step 8: Commit**

```bash
git add apps/native/src/db apps/native/index.tsx
git commit -m "chore(native): Phase 0 spike validated — remove spike harness"
```

---

## Phase 1 — Convex Foundation (Non-Breaking)

All changes are additive: optional new fields, new tables, new endpoints. Admin web and current tablet build continue working unchanged.

### Task 1.1 — Add `updatedAt` + `clientId` to synced tables

**Files:**
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add fields to all synced tables**

Synced tables: `users`, `roles`, `stores`, `categories`, `products`, `modifierGroups`, `modifierOptions`, `modifierGroupAssignments`, `tables`, `orders`, `orderItems`, `orderItemModifiers`, `orderDiscounts`, `orderVoids`, `orderPayments`, `auditLogs`, `dailyReports`, `settings`, `appConfig`.

For each, add:
```typescript
updatedAt: v.optional(v.number()),
clientId: v.optional(v.string()),
```

(Optional initially so existing rows pass validation; the backfill in Task 1.7 fills them in.)

Add new compound indexes for pull cursor — for each table that has `storeId`:
```typescript
.index("by_store_updatedAt", ["storeId", "updatedAt"])
```

For tables without `storeId` (e.g. `roles`, top-level `appConfig`):
```typescript
.index("by_updatedAt", ["updatedAt"])
```

- [ ] **Step 2: Verify schema compiles**

```bash
cd packages/backend && pnpm dlx convex dev --once
```

Expected: schema accepted, no validation errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add updatedAt + clientId fields and pull-cursor indexes for sync"
```

### Task 1.2 — Add `syncedMutations` and `syncDevices` tables

**Files:**
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add the two new tables**

Append to `defineSchema({ ... })`:

```typescript
syncedMutations: defineTable({
  clientMutationId: v.string(),
  storeId: v.id("stores"),
  response: v.string(),  // JSON-stringified push response
  createdAt: v.number(),
})
  .index("by_clientMutationId", ["clientMutationId"])
  .index("by_createdAt", ["createdAt"]),

syncDevices: defineTable({
  deviceId: v.string(),     // UUID generated on first install (stored in SecureStore)
  storeId: v.id("stores"),
  deviceCode: v.string(),   // "A", "B", ..., "Z", "AA", ... (Excel-style)
  registeredAt: v.number(),
  lastSeenAt: v.number(),
})
  .index("by_storeId_deviceCode", ["storeId", "deviceCode"])
  .index("by_deviceId", ["deviceId"]),
```

- [ ] **Step 2: Add `deviceCodeCounter` to `stores`**

In the `stores: defineTable({ ... })` block, add:
```typescript
deviceCodeCounter: v.optional(v.number()),
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): syncedMutations + syncDevices tables, deviceCodeCounter on stores"
```

### Task 1.3 — Sync helpers library

**Files:**
- Create: `packages/backend/convex/lib/sync.ts`
- Create: `packages/backend/convex/lib/sync.test.ts`

- [ ] **Step 1: Write the tests first**

`packages/backend/convex/lib/sync.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { deviceCodeFromIndex } from "./sync";

describe("deviceCodeFromIndex", () => {
  it.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("encodes index %i as %s", (n, expected) => {
    expect(deviceCodeFromIndex(n)).toBe(expected);
  });

  it("rejects negative index", () => {
    expect(() => deviceCodeFromIndex(-1)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd packages/backend && pnpm vitest run lib/sync.test.ts
```

Expected: all FAIL with "deviceCodeFromIndex is not a function".

- [ ] **Step 3: Implement helpers**

`packages/backend/convex/lib/sync.ts`:
```typescript
/**
 * Encodes a 0-indexed integer as an Excel-style alphabetic code.
 * 0 → "A", 25 → "Z", 26 → "AA", 51 → "AZ", 52 → "BA", 701 → "ZZ", 702 → "AAA"
 */
export function deviceCodeFromIndex(n: number): string {
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error(`deviceCodeFromIndex: invalid index ${n}`);
  }
  let code = "";
  while (n >= 0) {
    code = String.fromCharCode(65 + (n % 26)) + code;
    n = Math.floor(n / 26) - 1;
  }
  return code;
}

/**
 * Generates a new clientId UUID. Used by server-side mutations (admin web)
 * to assign clientIds to rows that didn't come from a tablet push.
 */
export function newClientId(): string {
  return crypto.randomUUID();
}

/**
 * The complete list of synced table names. Update when adding/removing
 * tables from the sync surface.
 */
export const SYNCED_TABLES = [
  "users",
  "roles",
  "stores",
  "categories",
  "products",
  "modifierGroups",
  "modifierOptions",
  "modifierGroupAssignments",
  "tables",
  "orders",
  "orderItems",
  "orderItemModifiers",
  "orderDiscounts",
  "orderVoids",
  "orderPayments",
  "settings",
  "appConfig",
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

export const TABLET_WRITABLE_TABLES = new Set<SyncedTable>([
  "orders",
  "orderItems",
  "orderItemModifiers",
  "orderDiscounts",
  "orderVoids",
  "orderPayments",
]);
```

- [ ] **Step 4: Re-run tests**

```bash
pnpm vitest run lib/sync.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/sync.ts packages/backend/convex/lib/sync.test.ts
git commit -m "feat(backend): sync helpers — deviceCodeFromIndex, newClientId, table sets"
```

### Task 1.4 — `/sync/registerDevice` HTTP action

**Files:**
- Create: `packages/backend/convex/sync.ts`
- Modify: `packages/backend/convex/http.ts`

- [ ] **Step 1: Implement registerDevice**

`packages/backend/convex/sync.ts`:
```typescript
import { httpAction } from "./_generated/server";
import { v } from "convex/values";
import { deviceCodeFromIndex } from "./lib/sync";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";

// ---------- registerDevice ----------

export const registerDeviceCore = internalMutation({
  args: {
    deviceId: v.string(),
    storeId: v.id("stores"),
  },
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

    await ctx.db.patch(args.storeId, { deviceCodeCounter: nextIndex + 1 });
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
  // Authentication check
  const userId = await ctx.auth.getUserIdentity();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = await request.json();
  const { deviceId, storeId } = body;

  if (typeof deviceId !== "string" || typeof storeId !== "string") {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const result = await ctx.runMutation(internal.sync.registerDeviceCore, { deviceId, storeId });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Wire up in http.ts**

```typescript
import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { registerDevice, syncPull, syncPush } from "./sync";

const http = httpRouter();
auth.addHttpRoutes(http);

http.route({
  path: "/sync/registerDevice",
  method: "POST",
  handler: registerDevice,
});

// syncPull and syncPush wired in Tasks 1.5 and 1.6

export default http;
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/sync.ts packages/backend/convex/http.ts
git commit -m "feat(backend): /sync/registerDevice HTTP action"
```

### Task 1.5 — `/sync/pull` HTTP action

**Files:**
- Modify: `packages/backend/convex/sync.ts`
- Modify: `packages/backend/convex/http.ts`

- [ ] **Step 1: Implement pull**

Append to `packages/backend/convex/sync.ts`:

```typescript
const PULL_BATCH_SIZE = 500;

type ChangePayload = {
  changes: Record<string, { created: any[]; updated: any[]; deleted: string[] }>;
  timestamp: number;
};

export const syncPullCore = internalQuery({
  args: {
    storeId: v.id("stores"),
    lastPulledAt: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ChangePayload> => {
    const since = args.lastPulledAt ?? 0;
    const now = Date.now();
    const changes: ChangePayload["changes"] = {};

    // Helper: convert a Convex doc to a Watermelon-shaped record
    // - id = clientId (UUID)
    // - server_id = Convex _id
    // - all FKs translated from Convex Id → clientId via lookup helper
    const toWatermelon = async (doc: any, fkFields: string[] = []) => {
      const out: any = {
        id: doc.clientId ?? doc._id, // fallback for pre-backfill rows
        server_id: doc._id,
        updated_at: doc.updatedAt ?? doc._creationTime,
      };
      for (const [k, v] of Object.entries(doc)) {
        if (k.startsWith("_") || k === "clientId" || k === "updatedAt") continue;
        if (fkFields.includes(k) && typeof v === "string") {
          const fkDoc = await ctx.db.get(v as any);
          out[k] = (fkDoc as any)?.clientId ?? v;
        } else {
          out[k] = v;
        }
      }
      return out;
    };

    // Per-table fetcher
    const fetchTable = async (table: string, fkFields: string[]) => {
      const rows = await (ctx.db.query(table as any) as any)
        .withIndex("by_store_updatedAt" as any, (q: any) =>
          q.eq("storeId", args.storeId).gt("updatedAt", since),
        )
        .take(PULL_BATCH_SIZE);
      const created: any[] = [];
      const updated: any[] = [];
      for (const r of rows) {
        const wm = await toWatermelon(r, fkFields);
        if ((r._creationTime ?? 0) > since) created.push(wm);
        else updated.push(wm);
      }
      changes[table] = { created, updated, deleted: [] };
    };

    // The synced read-paths. Order matters for FK resolution.
    await fetchTable("categories", []);
    await fetchTable("products", ["categoryId"]);
    await fetchTable("modifierGroups", []);
    await fetchTable("modifierOptions", ["modifierGroupId"]);
    await fetchTable("modifierGroupAssignments", ["modifierGroupId", "productId", "categoryId"]);
    await fetchTable("tables", ["currentOrderId"]);
    await fetchTable("orders", ["tableId", "createdBy", "paidBy", "refundedFromOrderId"]);
    await fetchTable("orderItems", ["orderId", "productId", "voidedBy"]);
    await fetchTable("orderItemModifiers", ["orderItemId"]);
    await fetchTable("orderDiscounts", ["orderId", "orderItemId", "approvedBy"]);
    await fetchTable("orderVoids", ["orderId", "orderItemId", "approvedBy", "requestedBy", "replacementOrderId"]);
    await fetchTable("orderPayments", ["orderId", "createdBy"]);
    await fetchTable("settings", ["updatedBy"]);
    await fetchTable("appConfig", []);
    // users — only members of this store
    const users = await ctx.db
      .query("users")
      .withIndex("by_store", (q) => q.eq("storeId", args.storeId))
      .collect();
    changes.users = {
      created: [],
      updated: await Promise.all(users.map((u) => toWatermelon(u, ["roleId", "storeId"]))),
      deleted: [],
    };
    // roles — global; pull all
    const roles = await ctx.db.query("roles").collect();
    changes.roles = {
      created: [],
      updated: await Promise.all(roles.map((r) => toWatermelon(r))),
      deleted: [],
    };
    // store record
    const storeDoc = await ctx.db.get(args.storeId);
    changes.stores = {
      created: storeDoc ? [await toWatermelon(storeDoc, ["parentId"])] : [],
      updated: [],
      deleted: [],
    };

    return { changes, timestamp: now };
  },
});

export const syncPull = httpAction(async (ctx, request) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const user = await ctx.runQuery(internal.users.getUserByTokenIdentifier, {
    tokenIdentifier: identity.tokenIdentifier,
  });
  if (!user?.storeId) {
    return new Response(JSON.stringify({ error: "User has no store" }), { status: 403 });
  }
  const body = await request.json();
  const lastPulledAt = typeof body.lastPulledAt === "number" ? body.lastPulledAt : undefined;
  const result = await ctx.runQuery(internal.sync.syncPullCore, {
    storeId: user.storeId,
    lastPulledAt,
  });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Wire up the route**

Add to `http.ts`:
```typescript
http.route({ path: "/sync/pull", method: "POST", handler: syncPull });
```

- [ ] **Step 3: Add `getUserByTokenIdentifier` helper if missing**

Check `packages/backend/convex/users.ts` for an existing helper that resolves a token to a user. If absent, add:
```typescript
export const getUserByTokenIdentifier = internalQuery({
  args: { tokenIdentifier: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .first();
  },
});
```

(Verify the actual index name on `users`; the auth tables have their own. If the index doesn't exist for token→user, use the existing `getAuthenticatedUser` from `lib/auth.ts` instead.)

- [ ] **Step 4: Smoke test**

After `pnpm convex dev` is running, hit the endpoint with curl + a valid auth token:
```bash
curl -X POST $CONVEX_HTTP_URL/sync/pull \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lastPulledAt": null}' | jq .
```

Expected: JSON with `changes` object containing per-table `created`/`updated`/`deleted` arrays and `timestamp`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/sync.ts packages/backend/convex/http.ts
git commit -m "feat(backend): /sync/pull HTTP action with FK→clientId translation"
```

### Task 1.6 — `/sync/push` HTTP action

**Files:**
- Modify: `packages/backend/convex/sync.ts`
- Modify: `packages/backend/convex/http.ts`

- [ ] **Step 1: Implement push (idempotent)**

Append to `packages/backend/convex/sync.ts`:

```typescript
type PushPayload = {
  lastPulledAt: number;
  changes: Record<string, { created: any[]; updated: any[] }>;
  clientMutationId: string;
};

type PushResponse =
  | { success: true }
  | { rejected: Array<{ table: string; clientId: string; reason: string }> };

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

    // Idempotency check
    const cached = await ctx.db
      .query("syncedMutations")
      .withIndex("by_clientMutationId", (q) =>
        q.eq("clientMutationId", payload.clientMutationId),
      )
      .first();
    if (cached) {
      return JSON.parse(cached.response) as PushResponse;
    }

    const rejected: Array<{ table: string; clientId: string; reason: string }> = [];

    // Resolve clientId → Convex Id helper
    const resolveFk = async (table: string, clientId: string | undefined) => {
      if (!clientId) return undefined;
      const doc = await (ctx.db.query(table as any) as any)
        .withIndex("by_clientId" as any, (q: any) => q.eq("clientId", clientId))
        .first();
      return doc?._id;
    };

    // For each tablet-writable table, translate FKs and call existing
    // domain mutations. We only support tables in TABLET_WRITABLE_TABLES.
    const writableOrder: SyncedTable[] = [
      "orders",
      "orderItems",
      "orderItemModifiers",
      "orderDiscounts",
      "orderPayments",
      "orderVoids",
    ];

    for (const table of writableOrder) {
      const tableChanges = payload.changes[table];
      if (!tableChanges) continue;

      for (const row of [...tableChanges.created, ...tableChanges.updated]) {
        try {
          await applyRow(ctx, table, row, args.storeId, args.userId, resolveFk);
        } catch (e: any) {
          rejected.push({
            table,
            clientId: row.id ?? row.clientId ?? "",
            reason: e?.message ?? "unknown",
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

// Domain-specific apply logic. Each branch translates FKs then either
// inserts or patches the row. Append-only tables never patch.
async function applyRow(
  ctx: any,
  table: SyncedTable,
  row: any,
  storeId: any,
  userId: any,
  resolveFk: (t: string, c?: string) => Promise<any>,
) {
  // Look up an existing row by clientId for upsert logic
  const existing = row.id
    ? await ctx.db
        .query(table)
        .withIndex("by_clientId" as any, (q: any) => q.eq("clientId", row.id))
        .first()
    : null;

  switch (table) {
    case "orders": {
      const tableId = await resolveFk("tables", row.tableId);
      const data = {
        storeId,
        orderNumber: row.orderNumber,
        orderType: row.orderType,
        orderChannel: row.orderChannel,
        takeoutStatus: row.takeoutStatus,
        tableId,
        customerName: row.customerName,
        draftLabel: row.draftLabel,
        status: row.status,
        grossSales: row.grossSales,
        vatableSales: row.vatableSales,
        vatAmount: row.vatAmount,
        vatExemptSales: row.vatExemptSales,
        nonVatSales: row.nonVatSales,
        discountAmount: row.discountAmount,
        netSales: row.netSales,
        paymentMethod: row.paymentMethod,
        cashReceived: row.cashReceived,
        changeGiven: row.changeGiven,
        cardPaymentType: row.cardPaymentType,
        cardReferenceNumber: row.cardReferenceNumber,
        orderCategory: row.orderCategory,
        tableMarker: row.tableMarker,
        createdBy: userId,
        createdAt: row.createdAt ?? Date.now(),
        paidAt: row.paidAt,
        paidBy: row.paidBy ? userId : undefined,
        pax: row.pax,
        tabNumber: row.tabNumber,
        tabName: row.tabName,
        requestId: row.requestId,
        tableName: row.tableName,
        itemCount: row.itemCount,
        clientId: row.id,
        updatedAt: Date.now(),
      };
      if (existing) {
        // Conflict rules: paid/voided are frozen
        if (existing.status === "paid" || existing.status === "voided") {
          throw new Error("Order is closed");
        }
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("orders", data);
      }
      break;
    }
    case "orderItems": {
      const orderId = await resolveFk("orders", row.orderId);
      const productId = await resolveFk("products", row.productId);
      if (!orderId || !productId) {
        throw new Error(`Missing FK: orderId=${!!orderId}, productId=${!!productId}`);
      }
      const data = {
        orderId,
        productId,
        productName: row.productName,
        productPrice: row.productPrice,
        quantity: row.quantity,
        notes: row.notes,
        serviceType: row.serviceType,
        isVoided: row.isVoided ?? false,
        isSentToKitchen: row.isSentToKitchen,
        voidedBy: row.voidedBy ? userId : undefined,
        voidedAt: row.voidedAt,
        voidReason: row.voidReason,
        clientId: row.id,
        updatedAt: Date.now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("orderItems", data);
      }
      break;
    }
    case "orderItemModifiers": {
      const orderItemId = await resolveFk("orderItems", row.orderItemId);
      if (!orderItemId) throw new Error("Missing orderItemId FK");
      if (existing) return; // append-only; idempotent skip
      await ctx.db.insert("orderItemModifiers", {
        orderItemId,
        modifierGroupName: row.modifierGroupName,
        modifierOptionName: row.modifierOptionName,
        priceAdjustment: row.priceAdjustment,
        clientId: row.id,
        updatedAt: Date.now(),
      });
      break;
    }
    case "orderDiscounts":
    case "orderVoids":
    case "orderPayments": {
      // All append-only; if existing, idempotent skip
      if (existing) return;
      const orderId = await resolveFk("orders", row.orderId);
      if (!orderId) throw new Error("Missing orderId FK");
      const orderItemId = row.orderItemId
        ? await resolveFk("orderItems", row.orderItemId)
        : undefined;
      const baseData: any = {
        orderId,
        orderItemId,
        clientId: row.id,
        updatedAt: Date.now(),
      };
      if (table === "orderDiscounts") {
        await ctx.db.insert("orderDiscounts", {
          ...baseData,
          discountType: row.discountType,
          customerName: row.customerName,
          customerId: row.customerId,
          quantityApplied: row.quantityApplied,
          discountAmount: row.discountAmount,
          vatExemptAmount: row.vatExemptAmount,
          approvedBy: userId,
          createdAt: row.createdAt ?? Date.now(),
        });
      } else if (table === "orderVoids") {
        await ctx.db.insert("orderVoids", {
          orderId,
          voidType: row.voidType,
          orderItemId,
          reason: row.reason,
          approvedBy: userId,
          requestedBy: userId,
          amount: row.amount,
          createdAt: row.createdAt ?? Date.now(),
          refundMethod: row.refundMethod,
          replacementOrderId: row.replacementOrderId
            ? await resolveFk("orders", row.replacementOrderId)
            : undefined,
          clientId: row.id,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("orderPayments", {
          orderId,
          storeId,
          paymentMethod: row.paymentMethod,
          amount: row.amount,
          cashReceived: row.cashReceived,
          changeGiven: row.changeGiven,
          cardPaymentType: row.cardPaymentType,
          cardReferenceNumber: row.cardReferenceNumber,
          createdAt: row.createdAt ?? Date.now(),
          createdBy: userId,
          clientId: row.id,
          updatedAt: Date.now(),
        });
      }
      break;
    }
  }
}

export const syncPush = httpAction(async (ctx, request) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const user = await ctx.runQuery(internal.users.getUserByTokenIdentifier, {
    tokenIdentifier: identity.tokenIdentifier,
  });
  if (!user?.storeId) {
    return new Response(JSON.stringify({ error: "User has no store" }), { status: 403 });
  }

  const payload = await request.json();
  const deviceId = (request.headers.get("x-device-id") ?? "") as string;
  if (!deviceId) {
    return new Response(JSON.stringify({ error: "Missing x-device-id header" }), {
      status: 400,
    });
  }

  const result = await ctx.runMutation(internal.sync.syncPushCore, {
    storeId: user.storeId,
    userId: user._id,
    deviceId,
    payload,
  });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Add `by_clientId` index to every tablet-writable table**

Modify `schema.ts` to add `.index("by_clientId", ["clientId"])` on:
- `orders`
- `orderItems`
- `orderItemModifiers`
- `orderDiscounts`
- `orderVoids`
- `orderPayments`

- [ ] **Step 3: Wire up route**

```typescript
http.route({ path: "/sync/push", method: "POST", handler: syncPush });
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/sync.ts packages/backend/convex/http.ts packages/backend/convex/schema.ts
git commit -m "feat(backend): /sync/push with idempotency, FK translation, conflict rules"
```

### Task 1.7 — Backfill `clientId` on existing rows

**Files:**
- Create: `packages/backend/convex/migrations/2026_04_clientIdBackfill.ts`

- [ ] **Step 1: Write the migration**

```typescript
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { newClientId, SYNCED_TABLES } from "../lib/sync";

/**
 * One-shot backfill: assigns a clientId UUID to every row in synced tables that lacks one.
 * Also sets updatedAt to _creationTime if not present.
 *
 * Idempotent — safe to re-run; only touches rows missing clientId.
 *
 * Run via: npx convex run migrations/2026_04_clientIdBackfill:backfillClientIds '{}'
 */
export const backfillClientIds = internalMutation({
  args: {},
  returns: v.object({ table: v.string(), updated: v.number() }),
  handler: async (ctx) => {
    let totalUpdated = 0;
    const summary: Record<string, number> = {};

    for (const table of SYNCED_TABLES) {
      const rows = await ctx.db.query(table).collect();
      let count = 0;
      for (const row of rows) {
        const patches: any = {};
        if (!row.clientId) patches.clientId = newClientId();
        if (!row.updatedAt) patches.updatedAt = row._creationTime;
        if (Object.keys(patches).length > 0) {
          await ctx.db.patch(row._id, patches);
          count++;
        }
      }
      summary[table] = count;
      totalUpdated += count;
    }

    return { table: JSON.stringify(summary), updated: totalUpdated };
  },
});
```

- [ ] **Step 2: Run the backfill against staging Convex deployment**

```bash
cd packages/backend
npx convex run migrations/2026_04_clientIdBackfill:backfillClientIds '{}'
```

Verify: every synced row now has `clientId` and `updatedAt`.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/migrations/2026_04_clientIdBackfill.ts
git commit -m "feat(backend): backfill clientId + updatedAt on existing synced rows"
```

### Task 1.8 — Auto-write `updatedAt` and `clientId` on existing mutations

**Files:**
- Modify: every domain mutation file that inserts into a synced table

This is mechanical but necessary. For each `ctx.db.insert("<table>", { ... })` in:
- `packages/backend/convex/orders.ts`
- `packages/backend/convex/checkout.ts`
- `packages/backend/convex/products.ts`
- `packages/backend/convex/categories.ts`
- `packages/backend/convex/modifierGroups.ts`
- `packages/backend/convex/modifierOptions.ts`
- `packages/backend/convex/modifierAssignments.ts`
- `packages/backend/convex/discounts.ts`
- `packages/backend/convex/voids.ts`
- `packages/backend/convex/auditLogs.ts`
- `packages/backend/convex/users.ts`
- `packages/backend/convex/roles.ts`
- `packages/backend/convex/stores.ts`
- `packages/backend/convex/appConfig.ts`

Add to the insert object (if not already present from the push path):
```typescript
clientId: args.clientId ?? newClientId(),
updatedAt: Date.now(),
```

For every `ctx.db.patch(id, { ... })` on a synced table:
```typescript
await ctx.db.patch(id, { ...changes, updatedAt: Date.now() });
```

Import `newClientId` from `./lib/sync` where needed.

- [ ] **Step 1: Update insert paths**

Walk every file above; locate `ctx.db.insert("<syncedTable>"` calls; add `clientId` + `updatedAt`.

- [ ] **Step 2: Update patch paths**

Walk every file above; locate `ctx.db.patch` calls touching synced tables; add `updatedAt: Date.now()`.

- [ ] **Step 3: Run existing test suite**

```bash
cd packages/backend && pnpm vitest run
```

Expected: all existing tests pass (we only added optional fields to writes).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex
git commit -m "feat(backend): write updatedAt + clientId on all synced-table mutations"
```

### Task 1.9 — Extend refresh token TTL to 60 days

**Files:**
- Modify: `packages/backend/convex/auth.ts`

- [ ] **Step 1: Configure session lifetime**

```typescript
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

const CustomPassword = Password<DataModel>({
  profile(params) {
    return {
      name: params.name as string,
      email: params.email as string,
    };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [CustomPassword],
  session: {
    totalDurationMs: SIXTY_DAYS_MS,
    inactiveDurationMs: SIXTY_DAYS_MS,
  },
});
```

(If the `session` config keys differ in your `@convex-dev/auth` version, consult `node_modules/@convex-dev/auth/dist/server/index.d.ts` for the actual API surface.)

- [ ] **Step 2: Verify auth still works**

```bash
cd packages/backend && pnpm vitest run
```

Expected: auth-touching tests still pass.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/auth.ts
git commit -m "feat(backend): extend refresh token TTL to 60 days for offline tablet support"
```

### Task 1.10 — Daily cron to clean up syncedMutations

**Files:**
- Create or modify: `packages/backend/convex/crons.ts`
- Create: `packages/backend/convex/syncMaintenance.ts`

- [ ] **Step 1: Create cleanup mutation**

`packages/backend/convex/syncMaintenance.ts`:
```typescript
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
```

- [ ] **Step 2: Schedule the cron**

`packages/backend/convex/crons.ts` (create if missing):
```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "cleanup synced mutations cache",
  { hourUTC: 17, minuteUTC: 0 }, // 01:00 PHT
  internal.syncMaintenance.cleanupSyncedMutations,
);

export default crons;
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/crons.ts packages/backend/convex/syncMaintenance.ts
git commit -m "feat(backend): daily cron to clean up syncedMutations TTL >7 days"
```

---

## Phase 2 — Native Foundation

WatermelonDB schema, models, SyncManager, status pill, cached session, device registration. **No screen changes** — UI continues using Convex `useQuery`. Foundation operates in parallel; offline writes accumulate in a queue that pushes when online.

### Task 2.1 — WatermelonDB schema

**Files:**
- Create: `apps/native/src/db/schema.ts`
- Create: `apps/native/src/db/migrations.ts`

- [ ] **Step 1: Write the schema**

`apps/native/src/db/schema.ts` — mirrors the synced Convex tables. Each table has columns matching the Convex doc fields, plus `server_id` (for the `_id`) and `updated_at` (for the cursor). All columns are typed.

```typescript
import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const SCHEMA_VERSION = 1;

export const watermelonSchema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    tableSchema({
      name: "products",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "category_id", type: "string", isIndexed: true },
        { name: "price", type: "number" },
        { name: "is_vatable", type: "boolean" },
        { name: "is_active", type: "boolean", isIndexed: true },
        { name: "is_open_price", type: "boolean", isOptional: true },
        { name: "min_price", type: "number", isOptional: true },
        { name: "max_price", type: "number", isOptional: true },
        { name: "sort_order", type: "number" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "categories",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "parent_id", type: "string", isOptional: true, isIndexed: true },
        { name: "sort_order", type: "number" },
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "modifier_groups",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "selection_type", type: "string" },
        { name: "min_selections", type: "number" },
        { name: "max_selections", type: "number", isOptional: true },
        { name: "sort_order", type: "number" },
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "modifier_options",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "modifier_group_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "price_adjustment", type: "number" },
        { name: "is_default", type: "boolean" },
        { name: "is_available", type: "boolean" },
        { name: "sort_order", type: "number" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "modifier_group_assignments",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "modifier_group_id", type: "string", isIndexed: true },
        { name: "product_id", type: "string", isOptional: true, isIndexed: true },
        { name: "category_id", type: "string", isOptional: true, isIndexed: true },
        { name: "sort_order", type: "number" },
        { name: "min_selections_override", type: "number", isOptional: true },
        { name: "max_selections_override", type: "number", isOptional: true },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "tables",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "name", type: "string" },
        { name: "capacity", type: "number", isOptional: true },
        { name: "status", type: "string", isIndexed: true },
        { name: "current_order_id", type: "string", isOptional: true },
        { name: "sort_order", type: "number" },
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "orders",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "order_number", type: "string", isOptional: true },
        { name: "order_type", type: "string" },
        { name: "order_channel", type: "string", isOptional: true },
        { name: "takeout_status", type: "string", isOptional: true },
        { name: "table_id", type: "string", isOptional: true, isIndexed: true },
        { name: "customer_name", type: "string", isOptional: true },
        { name: "draft_label", type: "string", isOptional: true },
        { name: "status", type: "string", isIndexed: true },
        { name: "gross_sales", type: "number" },
        { name: "vatable_sales", type: "number" },
        { name: "vat_amount", type: "number" },
        { name: "vat_exempt_sales", type: "number" },
        { name: "non_vat_sales", type: "number" },
        { name: "discount_amount", type: "number" },
        { name: "net_sales", type: "number" },
        { name: "payment_method", type: "string", isOptional: true },
        { name: "cash_received", type: "number", isOptional: true },
        { name: "change_given", type: "number", isOptional: true },
        { name: "card_payment_type", type: "string", isOptional: true },
        { name: "card_reference_number", type: "string", isOptional: true },
        { name: "order_category", type: "string", isOptional: true },
        { name: "table_marker", type: "string", isOptional: true },
        { name: "created_by", type: "string" },
        { name: "created_at", type: "number" },
        { name: "paid_at", type: "number", isOptional: true },
        { name: "paid_by", type: "string", isOptional: true },
        { name: "pax", type: "number", isOptional: true },
        { name: "tab_number", type: "number", isOptional: true },
        { name: "tab_name", type: "string", isOptional: true },
        { name: "request_id", type: "string", isOptional: true },
        { name: "table_name", type: "string", isOptional: true },
        { name: "item_count", type: "number", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_items",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "product_id", type: "string", isIndexed: true },
        { name: "product_name", type: "string" },
        { name: "product_price", type: "number" },
        { name: "quantity", type: "number" },
        { name: "notes", type: "string", isOptional: true },
        { name: "service_type", type: "string", isOptional: true },
        { name: "is_voided", type: "boolean" },
        { name: "is_sent_to_kitchen", type: "boolean", isOptional: true },
        { name: "voided_by", type: "string", isOptional: true },
        { name: "voided_at", type: "number", isOptional: true },
        { name: "void_reason", type: "string", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_item_modifiers",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_item_id", type: "string", isIndexed: true },
        { name: "modifier_group_name", type: "string" },
        { name: "modifier_option_name", type: "string" },
        { name: "price_adjustment", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_discounts",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "order_item_id", type: "string", isOptional: true },
        { name: "discount_type", type: "string" },
        { name: "customer_name", type: "string" },
        { name: "customer_id", type: "string" },
        { name: "quantity_applied", type: "number" },
        { name: "discount_amount", type: "number" },
        { name: "vat_exempt_amount", type: "number" },
        { name: "approved_by", type: "string" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_voids",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "void_type", type: "string" },
        { name: "order_item_id", type: "string", isOptional: true },
        { name: "reason", type: "string" },
        { name: "approved_by", type: "string" },
        { name: "requested_by", type: "string" },
        { name: "amount", type: "number" },
        { name: "created_at", type: "number" },
        { name: "refund_method", type: "string", isOptional: true },
        { name: "replacement_order_id", type: "string", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "order_payments",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "order_id", type: "string", isIndexed: true },
        { name: "store_id", type: "string", isIndexed: true },
        { name: "payment_method", type: "string" },
        { name: "amount", type: "number" },
        { name: "cash_received", type: "number", isOptional: true },
        { name: "change_given", type: "number", isOptional: true },
        { name: "card_payment_type", type: "string", isOptional: true },
        { name: "card_reference_number", type: "string", isOptional: true },
        { name: "created_at", type: "number" },
        { name: "created_by", type: "string" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "users",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "name", type: "string", isOptional: true },
        { name: "email", type: "string", isOptional: true },
        { name: "role_id", type: "string", isOptional: true },
        { name: "store_id", type: "string", isOptional: true, isIndexed: true },
        { name: "pin", type: "string", isOptional: true },
        { name: "is_active", type: "boolean", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "roles",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "name", type: "string" },
        { name: "permissions", type: "string" }, // JSON-stringified array
        { name: "scope_level", type: "string" },
        { name: "is_system", type: "boolean" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "stores",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "name", type: "string" },
        { name: "parent_id", type: "string", isOptional: true },
        { name: "logo", type: "string", isOptional: true },
        { name: "address1", type: "string" },
        { name: "address2", type: "string", isOptional: true },
        { name: "tin", type: "string" },
        { name: "min", type: "string" },
        { name: "vat_rate", type: "number" },
        { name: "printer_mac", type: "string", isOptional: true },
        { name: "kitchen_printer_mac", type: "string", isOptional: true },
        { name: "contact_number", type: "string", isOptional: true },
        { name: "telephone", type: "string", isOptional: true },
        { name: "email", type: "string", isOptional: true },
        { name: "website", type: "string", isOptional: true },
        { name: "footer", type: "string", isOptional: true },
        { name: "schedule_json", type: "string", isOptional: true }, // JSON-stringified
        { name: "is_active", type: "boolean" },
        { name: "created_at", type: "number" },
        { name: "device_code_counter", type: "number", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "settings",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "store_id", type: "string", isOptional: true, isIndexed: true },
        { name: "key", type: "string", isIndexed: true },
        { name: "value", type: "string" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "app_config",
      columns: [
        { name: "server_id", type: "string", isOptional: true, isIndexed: true },
        { name: "key", type: "string", isIndexed: true },
        { name: "value", type: "string" },
        { name: "store_id", type: "string", isOptional: true },
        { name: "updated_at", type: "number" },
      ],
    }),
    // Local-only meta table for sync state
    tableSchema({
      name: "sync_meta",
      columns: [
        { name: "key", type: "string", isIndexed: true },
        { name: "value", type: "string" },
      ],
    }),
  ],
});
```

- [ ] **Step 2: Set up empty migrations**

`apps/native/src/db/migrations.ts`:
```typescript
import { schemaMigrations } from "@nozbe/watermelondb/Schema/migrations";

export const watermelonMigrations = schemaMigrations({
  migrations: [],
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/native/src/db
git commit -m "feat(native): WatermelonDB schema mirroring Convex synced tables"
```

### Task 2.2 — Database init & models

**Files:**
- Create: `apps/native/src/db/database.ts`
- Create: `apps/native/src/db/models/*.ts` (one per table)
- Create: `apps/native/src/db/index.ts`

- [ ] **Step 1: Author one model per table**

Each model file follows this pattern. Example: `apps/native/src/db/models/Order.ts`

```typescript
import { Model } from "@nozbe/watermelondb";
import { children, field, relation, text } from "@nozbe/watermelondb/decorators";

export class Order extends Model {
  static table = "orders";
  static associations = {
    order_items: { type: "has_many" as const, foreignKey: "order_id" },
    order_payments: { type: "has_many" as const, foreignKey: "order_id" },
    order_discounts: { type: "has_many" as const, foreignKey: "order_id" },
    order_voids: { type: "has_many" as const, foreignKey: "order_id" },
    tables: { type: "belongs_to" as const, key: "table_id" },
  };

  @text("server_id") serverId?: string;
  @field("store_id") storeId!: string;
  @text("order_number") orderNumber?: string;
  @text("order_type") orderType!: string;
  @text("order_channel") orderChannel?: string;
  @text("takeout_status") takeoutStatus?: string;
  @field("table_id") tableId?: string;
  @text("customer_name") customerName?: string;
  @text("draft_label") draftLabel?: string;
  @text("status") status!: string;
  @field("gross_sales") grossSales!: number;
  @field("vatable_sales") vatableSales!: number;
  @field("vat_amount") vatAmount!: number;
  @field("vat_exempt_sales") vatExemptSales!: number;
  @field("non_vat_sales") nonVatSales!: number;
  @field("discount_amount") discountAmount!: number;
  @field("net_sales") netSales!: number;
  @text("payment_method") paymentMethod?: string;
  @field("cash_received") cashReceived?: number;
  @field("change_given") changeGiven?: number;
  @text("card_payment_type") cardPaymentType?: string;
  @text("card_reference_number") cardReferenceNumber?: string;
  @text("order_category") orderCategory?: string;
  @text("table_marker") tableMarker?: string;
  @field("created_by") createdBy!: string;
  @field("created_at") createdAt!: number;
  @field("paid_at") paidAt?: number;
  @field("paid_by") paidBy?: string;
  @field("pax") pax?: number;
  @field("tab_number") tabNumber?: number;
  @text("tab_name") tabName?: string;
  @text("request_id") requestId?: string;
  @text("table_name") tableName?: string;
  @field("item_count") itemCount?: number;
  @field("updated_at") updatedAt!: number;

  @children("order_items") items: any;
  @children("order_payments") payments: any;
  @children("order_discounts") discounts: any;
  @children("order_voids") voids: any;
  @relation("tables", "table_id") table: any;
}
```

Repeat for all other tables. Naming: snake_case in the schema, camelCase in the model. The model files are mostly mechanical from the schema.

Models to create:
- Order, OrderItem, OrderItemModifier, OrderDiscount, OrderVoid, OrderPayment
- Product, Category, ModifierGroup, ModifierOption, ModifierGroupAssignment
- TableModel (renamed to avoid keyword), Store, Setting, AppConfig
- User, Role
- SyncMeta

- [ ] **Step 2: Database init**

`apps/native/src/db/database.ts`:
```typescript
import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { watermelonMigrations } from "./migrations";
import { watermelonSchema } from "./schema";
import * as Models from "./models";

let _db: Database | null = null;

export function getDatabase(): Database {
  if (_db) return _db;
  const adapter = new SQLiteAdapter({
    schema: watermelonSchema,
    migrations: watermelonMigrations,
    jsi: true,
    onSetUpError: (err) => {
      console.error("[WatermelonDB] setup error:", err);
    },
  });
  _db = new Database({
    adapter,
    modelClasses: Object.values(Models),
  });
  return _db;
}
```

- [ ] **Step 3: Models barrel export**

`apps/native/src/db/models/index.ts`:
```typescript
export { Order } from "./Order";
export { OrderItem } from "./OrderItem";
// ... export every model
```

- [ ] **Step 4: Top-level barrel**

`apps/native/src/db/index.ts`:
```typescript
export { getDatabase } from "./database";
export * from "./models";
export { SCHEMA_VERSION } from "./schema";
```

- [ ] **Step 5: Smoke test database boots**

In `apps/native/index.tsx`, behind `__DEV__`:
```ts
if (__DEV__) {
  setTimeout(() => {
    import("./src/db").then(({ getDatabase }) => {
      const db = getDatabase();
      console.log("[WatermelonDB] booted, tables:", Object.keys(db.collections.map));
    });
  }, 1000);
}
```

Run on device. Expected: `[WatermelonDB] booted, tables: [...]` with all tables listed.

- [ ] **Step 6: Remove smoke test, commit**

```bash
git add apps/native/src/db apps/native/index.tsx
git commit -m "feat(native): WatermelonDB models, database init, smoke-tested boot"
```

### Task 2.3 — Device ID & cached session helpers

**Files:**
- Create: `apps/native/src/auth/deviceId.ts`
- Create: `apps/native/src/auth/cachedSession.ts`
- Create: `apps/native/src/auth/cachedSession.test.ts`

- [ ] **Step 1: Device ID helper**

`apps/native/src/auth/deviceId.ts`:
```typescript
import * as SecureStore from "expo-secure-store";

const KEY = "pmgt.deviceId";

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEY);
  if (id) return id;
  id = crypto.randomUUID();
  await SecureStore.setItemAsync(KEY, id);
  return id;
}
```

- [ ] **Step 2: Cached session helper**

`apps/native/src/auth/cachedSession.ts`:
```typescript
import * as SecureStore from "expo-secure-store";

const KEY = "pmgt.cachedSession";

export type CachedSession = {
  userId: string;
  email: string;
  name: string;
  roleId: string;
  permissions: string[];
  storeId: string;
  storeSnapshot: Record<string, unknown>;
  expiresAt: number;
  deviceCode?: string;
};

export async function readCachedSession(): Promise<CachedSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSession;
  } catch {
    return null;
  }
}

export async function writeCachedSession(s: CachedSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

export async function clearCachedSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export function isSessionValid(s: CachedSession | null): s is CachedSession {
  return s !== null && s.expiresAt > Date.now();
}
```

- [ ] **Step 3: Tests for session helpers (mock SecureStore)**

`apps/native/src/auth/cachedSession.test.ts`:
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void store.delete(k)),
}));

import { readCachedSession, writeCachedSession, isSessionValid, clearCachedSession } from "./cachedSession";

beforeEach(() => store.clear());

describe("cachedSession", () => {
  const session = {
    userId: "u1",
    email: "a@b.com",
    name: "Test",
    roleId: "r1",
    permissions: ["x"],
    storeId: "s1",
    storeSnapshot: {},
    expiresAt: Date.now() + 1000,
  };

  it("round-trips a valid session", async () => {
    await writeCachedSession(session);
    expect(await readCachedSession()).toEqual(session);
  });

  it("isSessionValid rejects expired", () => {
    expect(isSessionValid({ ...session, expiresAt: Date.now() - 1 })).toBe(false);
    expect(isSessionValid({ ...session, expiresAt: Date.now() + 1000 })).toBe(true);
    expect(isSessionValid(null)).toBe(false);
  });

  it("clear removes the session", async () => {
    await writeCachedSession(session);
    await clearCachedSession();
    expect(await readCachedSession()).toBeNull();
  });
});
```

Run:
```bash
cd apps/native && pnpm vitest run src/auth/cachedSession.test.ts
```

(If the native app doesn't have vitest configured, run via the workspace root or skip the unit test and rely on integration testing in Phase 3.)

- [ ] **Step 4: Commit**

```bash
git add apps/native/src/auth
git commit -m "feat(native): deviceId + cachedSession helpers using SecureStore"
```

### Task 2.4 — Network status hook

**Files:**
- Create: `apps/native/src/sync/networkStatus.ts`

- [ ] **Step 1: Implement**

```typescript
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export function isOnline(state: NetInfoState | null): boolean {
  return Boolean(state?.isConnected && state?.isInternetReachable !== false);
}

export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then((s) => mounted && setOnline(isOnline(s)));
    const unsub = NetInfo.addEventListener((s) => mounted && setOnline(isOnline(s)));
    return () => {
      mounted = false;
      unsub();
    };
  }, []);
  return online;
}

export function subscribeToNetworkChanges(cb: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((s) => cb(isOnline(s)));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/native/src/sync/networkStatus.ts
git commit -m "feat(native): network status hook + subscriber"
```

### Task 2.5 — SyncManager

**Files:**
- Create: `apps/native/src/sync/SyncManager.ts`
- Create: `apps/native/src/sync/syncEndpoints.ts`
- Create: `apps/native/src/sync/types.ts`

- [ ] **Step 1: Types**

`apps/native/src/sync/types.ts`:
```typescript
export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export type SyncState = {
  status: SyncStatus;
  lastPulledAt: number | null;
  lastPushedAt: number | null;
  pendingMutationCount: number;
  lastError: string | null;
};

export type PullResponse = {
  changes: Record<string, { created: any[]; updated: any[]; deleted: string[] }>;
  timestamp: number;
};

export type PushResponse =
  | { success: true }
  | { rejected: Array<{ table: string; clientId: string; reason: string }> };
```

- [ ] **Step 2: Endpoint client**

`apps/native/src/sync/syncEndpoints.ts`:
```typescript
import type { PullResponse, PushResponse } from "./types";

const CONVEX_HTTP_URL = process.env.EXPO_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site") ?? "";

async function getAuthToken(): Promise<string> {
  // Convex Auth token is fetched via the convex client; expose it through a singleton.
  // This is a placeholder — wire to the actual token source after the auth integration.
  // For now, throw if called without configuration.
  throw new Error("getAuthToken: wire to Convex client token source");
}

export async function callPull(lastPulledAt: number | null): Promise<PullResponse> {
  const token = await getAuthToken();
  const res = await fetch(`${CONVEX_HTTP_URL}/sync/pull`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ lastPulledAt }),
  });
  if (!res.ok) throw new Error(`pull failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PullResponse;
}

export async function callPush(payload: {
  lastPulledAt: number;
  changes: Record<string, { created: any[]; updated: any[] }>;
  clientMutationId: string;
}, deviceId: string): Promise<PushResponse> {
  const token = await getAuthToken();
  const res = await fetch(`${CONVEX_HTTP_URL}/sync/push`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-device-id": deviceId,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`push failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PushResponse;
}

export async function callRegisterDevice(deviceId: string, storeId: string): Promise<{ deviceCode: string }> {
  const token = await getAuthToken();
  const res = await fetch(`${CONVEX_HTTP_URL}/sync/registerDevice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, storeId }),
  });
  if (!res.ok) throw new Error(`registerDevice failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { deviceCode: string };
}
```

- [ ] **Step 3: SyncManager singleton**

`apps/native/src/sync/SyncManager.ts`:
```typescript
import { synchronize } from "@nozbe/watermelondb/sync";
import { getDatabase } from "../db";
import { callPull, callPush } from "./syncEndpoints";
import { subscribeToNetworkChanges } from "./networkStatus";
import { getOrCreateDeviceId } from "../auth/deviceId";
import type { SyncState } from "./types";

const PULL_PERIOD_MS = 60_000;
const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];

type Listener = (s: SyncState) => void;

class SyncManagerImpl {
  private state: SyncState = {
    status: "idle",
    lastPulledAt: null,
    lastPushedAt: null,
    pendingMutationCount: 0,
    lastError: null,
  };
  private listeners = new Set<Listener>();
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private retryAttempt = 0;
  private deviceId = "";
  private unsubNet: (() => void) | null = null;

  async start() {
    this.deviceId = await getOrCreateDeviceId();
    this.unsubNet = subscribeToNetworkChanges((online) => {
      if (online) {
        this.setState({ status: "idle" });
        void this.syncOnce();
      } else {
        this.setState({ status: "offline" });
      }
    });
    this.periodicTimer = setInterval(() => void this.syncOnce(), PULL_PERIOD_MS);
    void this.syncOnce();
  }

  stop() {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.unsubNet) this.unsubNet();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return this.state;
  }

  /** Trigger a sync explicitly (e.g. from a "Sync now" button). */
  async syncNow(): Promise<void> {
    return this.syncOnce();
  }

  private async syncOnce(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.setState({ status: "syncing" });

    try {
      await synchronize({
        database: getDatabase(),
        pullChanges: async ({ lastPulledAt }) => {
          const result = await callPull(lastPulledAt ?? null);
          return { changes: result.changes, timestamp: result.timestamp };
        },
        pushChanges: async ({ changes, lastPulledAt }) => {
          // Drop empty payloads (no point in calling the server)
          if (allEmpty(changes)) return;
          const clientMutationId = crypto.randomUUID();
          const response = await callPush(
            { lastPulledAt, changes, clientMutationId },
            this.deviceId,
          );
          if ("rejected" in response && response.rejected.length > 0) {
            console.warn("[SyncManager] push rejections:", response.rejected);
          }
        },
        sendCreatedAsUpdated: false,
      });
      this.retryAttempt = 0;
      this.setState({
        status: "idle",
        lastPulledAt: Date.now(),
        lastPushedAt: Date.now(),
        lastError: null,
      });
    } catch (err: any) {
      const msg = err?.message ?? "sync failed";
      console.error("[SyncManager]", msg);
      this.setState({ status: "error", lastError: msg });
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
    }
  }

  private scheduleRetry() {
    const delay = RETRY_BACKOFF_MS[Math.min(this.retryAttempt, RETRY_BACKOFF_MS.length - 1)];
    this.retryAttempt++;
    setTimeout(() => void this.syncOnce(), delay);
  }

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}

function allEmpty(changes: Record<string, { created: any[]; updated: any[] }>): boolean {
  for (const t of Object.values(changes)) {
    if (t.created.length > 0 || t.updated.length > 0) return false;
  }
  return true;
}

export const syncManager = new SyncManagerImpl();
```

- [ ] **Step 4: Wire up token source**

Replace the `getAuthToken` placeholder in `syncEndpoints.ts` with the real Convex token source. The Convex React Native client exposes it via `convex.getAuthToken()`. Wire through your existing `ConvexProvider`.

- [ ] **Step 5: Commit**

```bash
git add apps/native/src/sync
git commit -m "feat(native): SyncManager singleton with retry/backoff and NetInfo wiring"
```

### Task 2.6 — Sync status pill

**Files:**
- Create: `apps/native/src/sync/SyncStatusPill.tsx`

- [ ] **Step 1: Component**

```tsx
import { useEffect, useState } from "react";
import { TouchableOpacity, View } from "react-native";
import { syncManager } from "./SyncManager";
import { Text } from "../features/shared/components/ui";
import type { SyncState } from "./types";
import { useNavigation } from "@react-navigation/native";

const COLORS: Record<SyncState["status"], { bg: string; fg: string }> = {
  idle: { bg: "#DCFCE7", fg: "#15803D" },     // green
  syncing: { bg: "#FEF3C7", fg: "#92400E" },  // amber
  offline: { bg: "#FEE2E2", fg: "#991B1B" },  // red
  error: { bg: "#FEE2E2", fg: "#991B1B" },    // red
};

function format(state: SyncState): string {
  if (state.status === "idle") {
    if (!state.lastPulledAt) return "Not synced";
    const ago = Date.now() - state.lastPulledAt;
    if (ago < 60_000) return "Synced";
    return `Synced ${Math.floor(ago / 60_000)}m ago`;
  }
  if (state.status === "syncing") return "Syncing…";
  if (state.status === "offline") return `Offline (${state.pendingMutationCount} pending)`;
  return `Sync failed — tap to retry`;
}

export function SyncStatusPill() {
  const [state, setState] = useState<SyncState>(syncManager.getState());
  const nav = useNavigation();

  useEffect(() => syncManager.subscribe(setState), []);

  const colors = COLORS[state.status];
  const onPress = () => {
    if (state.status === "error" || state.status === "offline") void syncManager.syncNow();
    else (nav as any).navigate?.("Settings");
  };

  return (
    <TouchableOpacity onPress={onPress}>
      <View
        style={{
          backgroundColor: colors.bg,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: colors.fg, fontSize: 12, fontWeight: "600" }}>
          {format(state)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
```

- [ ] **Step 2: Mount in app header**

In your existing app header component (search for where the cashier name is rendered in `apps/native/src/features/`), add the pill next to the user name. Reference the existing layout — you'll likely add it inside the right-side `XStack`.

- [ ] **Step 3: Bootstrapping**

Wherever the Convex client is initialized (likely in `apps/native/index.tsx` or a top-level provider), call:
```ts
import { syncManager } from "./src/sync/SyncManager";
syncManager.start();
```

This kicks off the sync loop on app boot.

- [ ] **Step 4: Smoke test on a real tablet**

Build and run:
```bash
cd apps/native && pnpm android:staging
```

Expected:
- Pill renders in header
- On boot, status briefly shows "Syncing…" then "Synced"
- Toggle airplane mode → pill turns red "Offline"
- Toggle off → pill returns to "Synced"

- [ ] **Step 5: Commit**

```bash
git add apps/native/src
git commit -m "feat(native): sync status pill mounted in app header; SyncManager bootstrapped on boot"
```

---

## Self-Review Checklist

After all tasks complete:

- [ ] **Spike validated** — WatermelonDB boots in dev and release builds on a real Android tablet
- [ ] **Convex schema** — every synced table has `updatedAt` + `clientId` + `by_store_updatedAt` (or `by_updatedAt`) index
- [ ] **Convex schema** — `syncedMutations`, `syncDevices` tables exist with their indexes; `stores.deviceCodeCounter` field exists
- [ ] **`/sync/pull`** — returns Watermelon-shaped payload with FK translation
- [ ] **`/sync/push`** — idempotent via `syncedMutations`; respects "frozen for paid orders" rule; append-only for payments/voids/discounts
- [ ] **`/sync/registerDevice`** — assigns next `deviceCode` via Excel-style auto-extending
- [ ] **Backfill ran** — `clientId` and `updatedAt` populated on all existing rows
- [ ] **All existing mutations write** `clientId` + `updatedAt` going forward
- [ ] **Refresh token TTL** extended to 60 days
- [ ] **Cron scheduled** — daily cleanup of `syncedMutations` older than 7 days
- [ ] **Native DB** — schema, models, `getDatabase()` boots cleanly on tablet
- [ ] **SyncManager** — starts on app boot, runs periodic sync, retries with backoff
- [ ] **Sync status pill** — visible in app header, reflects state changes
- [ ] **No screen UI changes** — all existing `useQuery` flows still work; nothing user-visible has changed beyond the pill

When all items above are checked, this plan is complete and we're ready for **Phase 3: Migrate read paths** (separate plan, written next).

---

## What this plan does NOT cover (next plans)

- **Phase 3:** Migrate read screens from `useQuery` → WatermelonDB observables (products, modifiers, categories, tables list, order history, etc.)
- **Phase 4:** Migrate write paths — every mutation writes WatermelonDB → SyncManager queues push
- **Phase 5:** Order numbering refactor — disable `getNextOrderNumber` for tablets, implement device-prefixed counters
- **Phase 6:** Z-Report online enforcement, "Device Info" settings row, error UX polish
- **Phase 7–8:** Pilot store rollout, fleet rollout
