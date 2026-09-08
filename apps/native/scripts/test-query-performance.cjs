// Source-level regression harness: actual hooks and Watermelon query matcher,
// deterministic observable snapshots. Not a native latency benchmark.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const Q = require("@nozbe/watermelondb/QueryDescription");
const encodeMatcher = require("@nozbe/watermelondb/observation/encodeMatcher").default;
const root = path.resolve(__dirname, "..");
let fixtures = {};
let reads = {};
const database = {
  collections: { get: (name) => ({ query: (...clauses) => ({ name, clauses }) }) },
};
function load(relative) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      exports: module.exports,
      require: (name) => {
        if (name === "react") return { useMemo: (fn) => fn() };
        if (name === "@nozbe/watermelondb") return { Q };
        if (name === "../../db") return { getDatabase: () => database };
        if (name === "@packages/shared") return {}; // Tax functions are not exercised here.
        if (name.endsWith("/orderTotals"))
          return load("src/features/orders/services/orderTotals.ts");
        if (name.endsWith("/useObservable"))
          return {
            useObservable: (factory) => {
              const { name: table, clauses } = factory();
              const matcher = encodeMatcher(Q.buildQueryDescription(clauses));
              const rows = (fixtures[table] ?? []).filter((row) => matcher(row._raw));
              reads[table] = (reads[table] ?? 0) + rows.length;
              return rows;
            },
          };
        throw new Error(`Unexpected import: ${name}`);
      },
    },
    { filename },
  );
  return module.exports;
}
function row(values) {
  return {
    ...values,
    _raw: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    ),
  };
}
const tables = load("src/sync/dataSources/useTables.ts");
const orders = load("src/sync/dataSources/useOrders.ts");
const takeout = load("src/sync/dataSources/useOrderHistory.ts");
for (const historySize of [0, 10000]) {
  fixtures = {
    tables: [row({ id: "table", storeId: "store", isActive: true, name: "Table 1", sortOrder: 1 })],
    orders: [
      row({
        id: "active",
        storeId: "store",
        status: "open",
        orderType: "takeout",
        tableId: "table",
        createdAt: 100,
        netSales: 20,
      }),
      ...Array.from({ length: historySize }, (_, i) =>
        row({
          id: `old-${i}`,
          storeId: "store",
          status: "paid",
          orderType: "takeout",
          createdAt: 1,
          netSales: 10,
        }),
      ),
    ],
    order_items: [
      row({
        id: "item",
        orderId: "active",
        quantity: 2,
        productPrice: 10,
        productName: "Tea",
        isVoided: false,
      }),
      row({
        id: "voided",
        orderId: "active",
        quantity: 5,
        productPrice: 10,
        productName: "Void",
        isVoided: true,
      }),
      ...Array.from({ length: historySize }, (_, i) =>
        row({
          id: `old-item-${i}`,
          orderId: `old-${i}`,
          quantity: 1,
          productPrice: 10,
          isVoided: false,
        }),
      ),
    ],
    order_item_modifiers: [
      row({ id: "mod", orderItemId: "item", priceAdjustment: 3 }),
      ...Array.from({ length: historySize }, (_, i) =>
        row({ id: `old-mod-${i}`, orderItemId: `old-item-${i}`, priceAdjustment: 1 }),
      ),
    ],
    order_discounts: [
      row({ id: "discount", orderId: "active", orderItemId: "item", discountAmount: 1 }),
    ],
  };
  const checks = [
    [
      "tables",
      () => {
        const result = tables.useTablesListWithOrders("store");
        assert.equal(result[0].totalItemCount, 2);
      },
    ],
    [
      "history",
      () => {
        const result = orders.useOrderHistoryQuery({
          storeId: "store",
          startDate: 50,
          endDate: 150,
        });
        assert.equal(result.length, 1);
        assert.equal(result[0].itemCount, 2);
      },
    ],
    ["discounts", () => assert.equal(orders.useOrderDiscountsQuery("active")[0].itemName, "Tea")],
    [
      "takeout",
      () => {
        const result = takeout.useTakeoutOrders("store", 50, 150);
        assert.equal(result.length, 1);
        assert.equal(result[0].netSales, 26);
        assert.equal(result[0].itemCount, 2);
      },
    ],
  ];
  for (const [name, check] of checks) {
    reads = {};
    check();
    assert.ok(
      reads.order_items <= 2,
      `${name}: hydrated ${reads.order_items} items for 2 relevant items`,
    );
    if (name === "takeout") assert.equal(reads.order_item_modifiers, 1);
    console.log(`${name}: history=${historySize}, hydrated items=${reads.order_items}`);
  }
  reads = {};
  tables.useTablesListWithOrders(undefined);
  orders.useOrderHistoryQuery({ storeId: undefined, startDate: 50, endDate: 150 });
  orders.useOrderDiscountsQuery(undefined);
  takeout.useTakeoutOrders(undefined, 50, 150);
  assert.equal(reads.order_items, 0, "Missing scope must not load item history");
}
console.log(
  "PASS: relevant results preserved; hydrated item counts independent of unrelated history.",
);
