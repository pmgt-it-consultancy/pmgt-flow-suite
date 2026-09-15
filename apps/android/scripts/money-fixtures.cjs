// Generate language-neutral expectations from the existing TypeScript implementation.
// No production data or credentials are read. Real-order amounts can be added separately.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
const source = fs.readFileSync(path.join(root, "packages/shared/src/taxCalculations.ts"), "utf8");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const reference = context.exports;
const totalsSource = fs.readFileSync(path.join(root, "apps/native/src/features/orders/services/orderTotals.ts"), "utf8");
const totalsContext = { exports: {}, require: name => { if (name === "@packages/shared") return reference; throw Error(name); } };
vm.runInNewContext(ts.transpileModule(totalsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, totalsContext);
const orderReference = totalsContext.exports;
const bits = value => { const b = Buffer.alloc(8); b.writeDoubleBE(value); return b.toString("hex"); };
const expectedBits = value => typeof value === "number" ? bits(value) : Object.fromEntries(Object.entries(value).map(([key, n]) => [key, bits(n)]));
const cases = [];
const add = (operation, args) => cases.push({ operation, args, expected: expectedBits(reference[operation](...args)) });
const prices = [0, 0.005, -0.005, 0.015, 1.005, 2.675, 19.99, 25, 99.95, 112, 123.456, 99999.99];
for (const price of prices) for (const rate of [0, 0.12, 12, 1]) {
  add("calculateVatBreakdown", [price, true, rate]);
  add("calculateVatBreakdown", [price, false, rate]);
  add("calculateScPwdDiscount", [price, rate]);
  for (const quantity of [1, 2, 7]) for (const scPwd of [0, 1, quantity]) for (const vatable of [false, true])
    add("calculateItemTotals", [price, quantity, vatable, scPwd, rate]);
  add("calculateChange", [price, 200]);
  add("calculateChange", [0, -price]);
}
for (let offset = 0; offset < prices.length; offset++) {
  const items = prices.slice(offset).map((p, i) => reference.calculateItemTotals(p, i + 1, i % 2 === 0, i % 3, 12));
  add("aggregateOrderTotals", [items]);
}
async function generateOrderCases() {
const recalcSource = fs.readFileSync(path.join(root, "apps/native/src/features/orders/services/recalculateOrder.ts"), "utf8");
// In-memory adapter only supplies the unchanged service's selected query rows and captures writes.
// Arithmetic and global-discount branches execute from the actual TypeScript service.
async function persisted(input) {
  const writable = row => Object.assign(row, { update: async fn => fn(row) });
  const order = writable({ id: "order", storeId: "store" });
  const tables = {
    orders: [order], stores: [{ id: "store", vatRate: input.vatRate }],
    products: input.items.map(i => ({ id: i.productId, isVatable: i.isVatable })),
    order_items: input.items.map(i => ({ ...i, orderId: "order", isVoided: false })),
    order_item_modifiers: input.items.flatMap(i => i.modifiers.map(m => ({ ...m, orderItemId: i.id }))),
    order_discounts: input.discounts.map(d => writable({ ...d, orderId: "order", discountType: "manual" })),
  };
  const collection = name => ({ find: async id => tables[name].find(row => row.id === id), query: () => ({ fetch: async () => tables[name] }) });
  const db = { collections: { get: collection }, get: collection, write: async fn => fn() };
  const recalcContext = { exports: {}, require: name => {
    if (name === "@packages/shared") return reference;
    if (name === "./orderTotals") return orderReference;
    if (name === "../../../db") return { getDatabase: () => db };
    if (name === "@nozbe/watermelondb") return { Q: { where: () => null, oneOf: () => null } };
    throw Error(name);
  } };
  vm.runInNewContext(ts.transpileModule(recalcSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, recalcContext);
  await recalcContext.exports.recalculateOrderTotals("order");
  return Object.fromEntries(["grossSales", "vatableSales", "vatAmount", "vatExemptSales", "nonVatSales", "discountAmount", "netSales"].map(key => [key, order[key]]));
}
// Exercise unchanged public orderTotals outputs with ordered modifier-inclusive lines.
for (const globalAmounts of [[0], [0.1, 0.2], [-10], [10000], [10, -10], [0.005]]) {
  for (const vatRate of [0, 0.12, 12]) {
    const items = [
      { id: "a", productId: "p", productPrice: 99.95, quantity: 3, isVatable: true, modifiers: [{ priceAdjustment: 12.345 }, { priceAdjustment: -0.1 }] },
      { id: "b", productId: "q", productPrice: 19.99, quantity: 2, isVatable: false, modifiers: [{ priceAdjustment: 0.005 }] },
    ];
    const discounts = [{ orderItemId: "a", quantityApplied: 1, discountAmount: 123 }, ...globalAmounts.map(discountAmount => ({ quantityApplied: 0, discountAmount }))];
    const input = { items, discounts, vatRate };
    cases.push({ operation: "buildCheckoutTotals", args: [input], expected: expectedBits(orderReference.buildCheckoutTotals(input)) });
    cases.push({ operation: "recalculateOrderTotals", args: [input], expected: expectedBits(await persisted(input)) });
    const calculations = orderReference.buildItemCalculations({ items, modifiersByItemId: new Map(items.map(i => [i.id, i.modifiers])), productById: new Map(items.map(i => [i.productId, { isVatable: i.isVatable }])), discountRecords: discounts, vatRate });
    calculations.forEach((calculation, index) => cases.push({ operation: "buildItemCalculations", args: [input, index], expected: expectedBits(calculation) }));
  }
}
const fixture = JSON.stringify({ provenance: "Synthetic boundary vectors generated by the unchanged TypeScript reference; not production-order evidence", sourceSha256: crypto.createHash("sha256").update(source).digest("hex"), orderTotalsSha256: crypto.createHash("sha256").update(totalsSource).digest("hex"), recalculateOrderSha256: crypto.createHash("sha256").update(recalcSource).digest("hex"), cases }, null, 2) + "\n";
const target = path.join(root, "apps/android/app/src/test/resources/money-reference.json");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== fixture) throw new Error("Money fixtures differ from the TypeScript reference; regenerate and review");
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, fixture);
}
console.log(`${cases.length} TypeScript money vectors ${process.argv.includes("--check") ? "verified" : "generated"}`);
}
generateOrderCases().catch(error => { console.error(error); process.exitCode = 1; });
