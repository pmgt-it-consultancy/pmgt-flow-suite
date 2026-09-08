import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cwd = fileURLToPath(new URL("../packages/backend/", import.meta.url));
const deployment = "aromatic-dalmatian-30";
const storeId = "kh7e16sprps4cfxdt1x0sfc2097z06m0";
const actorId = "ks7er904eeqzznzaqxdaekqmp57yzmtc";
// Stable across reruns: never move existing fixture dates forward.
const epoch = Date.parse("2026-09-08T03:30:00Z");
const mode = process.argv[2];

async function convex(args) {
  const { stdout } = await exec(
    "pnpm",
    ["exec", "convex", ...args, "--deployment-name", deployment],
    { cwd, maxBuffer: 128 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
const run = (name, args) => convex(["run", name, JSON.stringify(args), "--codegen", "disable"]);

if (mode === "seed") {
  console.log(
    "STAGING ONLY: append simulation data to Test Store A; no existing records are deleted.",
  );
  console.log("Catalog:", await run("restaurantSimulation:seedCatalog", { storeId }));
  const batches = Array.from({ length: 200 }, (_, i) => i * 50);
  let complete = 0;
  let inserted = 0;
  let skipped = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (batches.length) {
        const start = batches.shift();
        if (start === undefined) break;
        const result = await run("restaurantSimulation:seedOrders", {
          storeId,
          actorId,
          kind: "history",
          start,
          count: 50,
          epoch,
        });
        inserted += result.inserted;
        skipped += result.skipped;
        complete++;
        if (complete % 10 === 0)
          console.log(
            `History: ${complete * 50}/10000 accounted for (${inserted} inserted, ${skipped} existing)`,
          );
      }
    }),
  );
  console.log(
    "Active orders:",
    await run("restaurantSimulation:seedOrders", {
      storeId,
      actorId,
      kind: "active",
      start: 0,
      count: 50,
      epoch,
    }),
  );
  console.log("Seed complete. Incoming traffic is OFF. Allow the tablet to finish sync.");
} else if (mode === "traffic") {
  const count = Number(process.argv[3] ?? 120);
  const intervalMs = Number(process.argv[4] ?? 1000);
  const runId = process.argv[5] ?? `manual-${Date.now()}`;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 120 ||
    !Number.isInteger(intervalMs) ||
    intervalMs < 1000 ||
    intervalMs > 60_000 ||
    !/^[a-zA-Z0-9-]{1,40}$/.test(runId)
  ) {
    throw new Error("Usage: traffic [count 1..120] [intervalMs 1000..60000] [alphanumeric-run-id]");
  }
  console.log(
    `STAGING traffic ${runId}: at most ${count} takeout orders, interval >=${intervalMs}ms. Ctrl+C stops future requests; the current request may finish.`,
  );
  for (let i = 0; i < count; i++) {
    const start = Date.now();
    const result = await run("restaurantSimulation:seedOrders", {
      storeId,
      actorId,
      kind: "traffic",
      start: i,
      count: 1,
      epoch: start,
      runId,
    });
    console.log(`${i + 1}/${count}`, result);
    if (i + 1 < count) await delay(Math.max(0, intervalMs - (Date.now() - start)));
  }
  console.log("Traffic finished; no background job remains.");
} else if (mode === "status") {
  for (const table of [
    "categories",
    "products",
    "modifierGroups",
    "modifierOptions",
    "tables",
    "orders",
    "orderItems",
    "orderItemModifiers",
    "orderPayments",
  ]) {
    const rows = await convex(["data", table, "--limit", "100000", "--format", "json"]);
    const matched = rows.filter(
      (row) => row.storeId === storeId && row.clientId?.startsWith(`sim-restaurant-v1:${storeId}:`),
    );
    console.log(
      `${table}: ${matched.length} SIM records${rows.length === 100000 ? " (scan limit reached; count may be incomplete)" : ""}`,
    );
  }
} else {
  console.log(
    "Usage: node scripts/staging-restaurant-lab.mjs seed|status|traffic [count] [intervalMs] [runId]",
  );
  process.exitCode = 1;
}
