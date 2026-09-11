import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cwd = fileURLToPath(new URL("../packages/backend/", import.meta.url));
const deployment = "aromatic-dalmatian-30";
const epoch = Date.parse("2026-09-11T05:45:00Z");
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

function credentials() {
  const values = {
    managerEmail: process.env.E2E_MANAGER_EMAIL,
    managerPassword: process.env.E2E_MANAGER_PASSWORD,
    cashierEmail: process.env.E2E_CASHIER_EMAIL,
    cashierPassword: process.env.E2E_CASHIER_PASSWORD,
  };
  if (
    !values.managerEmail ||
    !values.cashierEmail ||
    !values.managerPassword ||
    !values.cashierPassword
  ) {
    throw new Error("Provisioning requires all four E2E_MANAGER_* and E2E_CASHIER_* variables");
  }
  if (values.managerPassword.length < 12 || values.cashierPassword.length < 12) {
    throw new Error("Lab passwords must be at least 12 characters");
  }
  return values;
}

async function provision() {
  const values = credentials();
  const result = await run("stagingE2ELab:provisionLab", values);
  console.log("Store:", result.storeId, result.storeCreated ? "created" : "reused");
  console.log("Manager:", values.managerEmail, result.managerUserId);
  console.log("Cashier:", values.cashierEmail, result.cashierUserId);
  return result;
}

async function getLab() {
  const lab = await run("stagingE2ELabData:getLab", {});
  if (!lab) throw new Error("Lab is not provisioned; run provision or seed first");
  return lab;
}

async function status() {
  const { storeId } = await getLab();
  const counts = {};
  await Promise.all(
    [
      "categories",
      "products",
      "modifierGroups",
      "modifierOptions",
      "modifierGroupAssignments",
      "tables",
      "orders",
      "orderItems",
      "orderItemModifiers",
      "orderPayments",
    ].map(async (table) => {
      let cursor = null;
      let count = 0;
      for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
        const page = await run("restaurantSimulation:countPage", { storeId, table, cursor });
        count += page.count;
        if (page.isDone) {
          counts[table] = count;
          return;
        }
        cursor = page.cursor;
      }
      throw new Error(`Verification page limit reached for ${table}`);
    }),
  );
  console.log(JSON.stringify({ storeId, counts }, null, 2));
}

if (mode === "provision") {
  await provision();
} else if (mode === "seed") {
  const lab = await provision();
  console.log("Catalog:", await run("restaurantSimulation:seedCatalog", { storeId: lab.storeId }));
  const batches = Array.from({ length: 200 }, (_, index) => index * 50);
  let complete = 0;
  let inserted = 0;
  let skipped = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (batches.length > 0) {
        const start = batches.shift();
        if (start === undefined) break;
        const result = await run("restaurantSimulation:seedOrders", {
          storeId: lab.storeId,
          actorId: lab.cashierUserId,
          kind: "history",
          start,
          count: 50,
          epoch,
        });
        inserted += result.inserted;
        skipped += result.skipped;
        complete += 1;
        if (complete % 10 === 0) {
          console.log(
            `History: ${complete * 50}/10000 accounted for (${inserted} inserted, ${skipped} existing)`,
          );
        }
      }
    }),
  );
  console.log(
    "Active orders:",
    await run("restaurantSimulation:seedOrders", {
      storeId: lab.storeId,
      actorId: lab.cashierUserId,
      kind: "active",
      start: 0,
      count: 50,
      epoch,
    }),
  );
  await status();
} else if (mode === "status") {
  await status();
} else if (mode === "traffic") {
  const lab = await provision();
  const count = Number(process.argv[3] ?? 60);
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
    throw new Error("Usage: traffic [count 1..120] [intervalMs 1000..60000] [runId]");
  }
  for (let index = 0; index < count; index += 1) {
    const startedAt = Date.now();
    console.log(
      `${index + 1}/${count}`,
      await run("restaurantSimulation:seedOrders", {
        storeId: lab.storeId,
        actorId: lab.cashierUserId,
        kind: "traffic",
        start: index,
        count: 1,
        epoch: startedAt,
        runId,
      }),
    );
    if (index + 1 < count) await delay(Math.max(0, intervalMs - (Date.now() - startedAt)));
  }
} else {
  console.log("Usage: node scripts/bounded-sync-e2e-lab.mjs provision|seed|status|traffic");
  process.exitCode = 1;
}
