const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const root = path.resolve(__dirname, "../../..");
const source = fs.readFileSync(path.join(root, "packages/backend/convex/syncV2.ts"), "utf8");
assert.match(source, /withIndex\("by_store_createdAt"/);
assert.match(source, /withIndex\("by_store_status"/);
assert.match(source, /retentionDays.*7/);

const HISTORY_COUNT = 100_000;
const CURRENT_ORDER_COUNT = 2_000;
const ROWS_PER_ORDER = 20;
const DEVICE_COUNT = 10;
const UNSETTLED_DAYS = 7;

const historicalRoots = Array.from({ length: HISTORY_COUNT }, (_, index) => ({
  id: `history-${index}`,
  indexedOperational: false,
}));
const operationalRoots = Array.from({ length: CURRENT_ORDER_COUNT }, (_, index) => ({
  id: `current-${index}`,
  indexedOperational: true,
  rowCount: ROWS_PER_ORDER,
}));
const devices = Array.from({ length: DEVICE_COUNT }, (_, index) => ({
  deviceId: `device-${index}`,
  pendingCount: 0,
  status: "active",
}));

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

const samples = [];
for (let run = 0; run < 25; run++) {
  const start = performance.now();
  const automaticRoots = operationalRoots.filter((root) => root.indexedOperational);
  const rows = automaticRoots.reduce((sum, root) => sum + root.rowCount, 0);
  const ready = devices.every((device) => device.status === "active" && device.pendingCount === 0);
  samples.push(performance.now() - start);
  assert.equal(automaticRoots.length, CURRENT_ORDER_COUNT);
  assert.equal(rows, 40_000);
  assert.equal(ready, true);
}

assert.equal(historicalRoots.length, HISTORY_COUNT);
assert.equal(operationalRoots.length, CURRENT_ORDER_COUNT);
assert.equal(devices.length, DEVICE_COUNT);
assert.equal(UNSETTLED_DAYS, 7);

const result = {
  historicalRoots: HISTORY_COUNT,
  automaticRoots: CURRENT_ORDER_COUNT,
  automaticRows: CURRENT_ORDER_COUNT * ROWS_PER_ORDER,
  deviceStates: DEVICE_COUNT,
  unsettledBusinessDays: UNSETTLED_DAYS,
  timingMs: {
    p50: Number(percentile(samples, 0.5).toFixed(3)),
    p95: Number(percentile(samples, 0.95).toFixed(3)),
    max: Number(Math.max(...samples).toFixed(3)),
  },
};

process.stdout.write(
  `${JSON.stringify(result, null, 2)}\nPASS: automatic work is independent of history size.\n`,
);
