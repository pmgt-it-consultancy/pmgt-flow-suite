// Runs the unchanged RN correction and recalculation services against a schema-normalized
// selected-row adapter. Synthetic only: no live data, credentials, or native runtime claim.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const sources = {};
function source(relative) { return sources[relative] = fs.readFileSync(path.join(root, relative), 'utf8'); }
function evaluate(code, imports, extra = {}) {
  const context = { exports: {}, require: name => {
    if (!(name in imports)) throw Error(`Unexpected import ${name}`);
    return imports[name];
  }, ...extra };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const schema = evaluate(source('apps/native/src/db/schema.ts'), { '@nozbe/watermelondb': require('@nozbe/watermelondb') }).watermelonSchema;
const tax = evaluate(source('packages/shared/src/taxCalculations.ts'), {});
const totals = evaluate(source('apps/native/src/features/orders/services/orderTotals.ts'), { '@packages/shared': tax });
const recalc = source('apps/native/src/features/orders/services/recalculateOrder.ts');
const correction = source('apps/native/src/features/voids/services/voidMutations.ts');
const modelNames = { orders: 'Order', order_items: 'OrderItem', order_item_modifiers: 'OrderItemModifier', order_discounts: 'OrderDiscount', order_payments: 'OrderPayment', order_voids: 'OrderVoid', audit_logs: 'AuditLog', stores: 'Store', products: 'Product', tables: 'TableModel' };
const properties = Object.fromEntries(Object.entries(modelNames).map(([table, name]) => {
  const text = source(`apps/native/src/db/models/${name}.ts`);
  return [table, Object.fromEntries([...text.matchAll(/@(field|text)\("([^"]+)"\)\s+(\w+)/g)].map(m => [m[3], m[2]]))];
}));
const Q = { where: (column, value) => ({ column, value }), oneOf: values => ({ values }) };
const tableNames = Object.keys(modelNames);
const normalize = (table, row) => Object.assign(Object.fromEntries(Object.values(schema.tables[table].columns).map(c => [c.name, c.isOptional ? null : c.type === 'number' ? 0 : c.type === 'boolean' ? false : ''])), row);
function seed(options) {
  const rows = Object.fromEntries(tableNames.map(t => [t, []]));
  const add = (t, row) => rows[t].push(normalize(t, row));
  if (!options.missingStore) add('stores', { id: 'store', vat_rate: options.rate ?? 12 });
  add('products', { id: 'product', store_id: 'store', is_vatable: !options.nonVat });
  add('tables', { id: 'table', store_id: 'store', status: 'occupied', current_order_id: 'original' });
  add('orders', { id: 'original', store_id: 'store', order_number: 'D01-001', status: options.open ? 'open' : 'paid', order_type: options.takeout ? 'takeout' : 'dine_in', order_channel: 'counter', table_id: 'table', table_name: 'Table 1', customer_name: 'Synthetic', order_category: 'dine_in', table_marker: '4', pax: 3, takeout_status: 'ready', net_sales: 300, gross_sales: 350, vat_amount: 25, discount_amount: 25, paid_at: 900, created_at: 800, created_by: 'cashier', paid_by: 'cashier', payment_method: 'card_ewallet', card_payment_type: 'GCash', card_reference_number: 'SYNTHETIC', item_count: 3, tab_name: 'Tab', tab_number: 2 });
  for (const [id, price, quantity] of [['refund', 70, 2], ['keep', 112, 1]]) add('order_items', { id, order_id: 'original', product_id: options.missingProduct ? 'missing' : 'product', product_name: id === 'refund' ? 'Returned meal' : 'Retained meal', product_price: price, quantity, notes: 'Synthetic note', service_type: 'takeout', is_sent_to_kitchen: true });
  add('order_item_modifiers', { id: 'modifier', order_item_id: 'keep', modifier_group_name: 'Size', modifier_option_name: 'Large', price_adjustment: 28 });
  add('order_payments', { id: 'original-card', order_id: 'original', store_id: 'store', payment_method: 'card_ewallet', card_payment_type: 'GCash', card_reference_number: 'SYNTHETIC', amount: 250, created_at: 900, created_by: 'cashier' });
  add('order_payments', { id: 'original-cash', order_id: 'original', store_id: 'store', payment_method: 'cash', amount: 50, cash_received: 100, change_given: 50, created_at: 901, created_by: 'cashier' });
  if (options.discount) add('order_discounts', { id: 'item-discount', order_id: 'original', order_item_id: 'keep', discount_type: options.discount, customer_name: 'Synthetic', customer_id: 'SYNTHETIC', quantity_applied: 1, discount_amount: 999, vat_exempt_amount: 999, approved_by: 'prior-manager', created_at: 850 });
  if (options.global !== undefined) add('order_discounts', { id: 'global', order_id: 'original', discount_type: 'manual', customer_name: 'Synthetic', customer_id: 'SYNTHETIC', quantity_applied: 0, discount_amount: options.global, vat_exempt_amount: 0, approved_by: 'prior-manager', created_at: 850 });
  if (options.otherTab) add('orders', { id: 'other-tab', store_id: 'store', table_id: 'table', status: 'open' });
  if (options.voidedItem) rows.order_items[0].is_voided = true;
  return rows;
}
async function run(name, options) {
  const rows = seed(options), input = structuredClone(rows);
  let sequence = 0, tick = 1000;
  const reservedNumbers = [];
  function model(table, raw) {
    return new Proxy({}, {
      get: (_, key) => key === '_raw' ? raw : key === 'id' ? raw.id : key === 'update' ? async fn => fn(model(table, raw)) : raw[properties[table][key]],
      set: (_, key, value) => {
        const field = properties[table][key];
        if (!field) throw Error(`Unknown model field ${table}.${String(key)}`);
        const column = schema.tables[table].columns[field];
        raw[field] = value === undefined || value === null ? (column.isOptional ? null : column.type === 'number' ? 0 : column.type === 'boolean' ? false : '') : value;
        return true;
      }
    });
  }
  const collection = table => ({
    find: async id => { const raw = rows[table].find(r => r.id === id); if (!raw) throw Error(`Record ${table}#${id} not found`); return model(table, raw); },
    query: (...clauses) => ({ fetch: async () => rows[table].filter(row => clauses.every(c => c.value?.values ? c.value.values.includes(row[c.column]) : row[c.column] === c.value)).map(row => model(table, row)) }),
    create: async fn => { const raw = normalize(table, {}); const result = model(table, raw); fn(result); rows[table].push(raw); return result; },
  });
  const db = { get: collection, collections: { get: collection }, write: async fn => fn() };
  const imports = { '@nozbe/watermelondb': { Q }, '@packages/shared': tax, '../../../db': { getDatabase: () => db }, './orderTotals': totals };
  const recalculation = evaluate(recalc, imports);
  const services = evaluate(correction, { ...imports, '../../../sync/idBridge': { generateUUID: () => `new-${++sequence}` }, '../../../sync/SyncManager': { syncManager: { triggerPush() {} } }, '../../orders/services/orderNumber': { getNextOrderNumber: async (_, type) => { const number = `${type === 'takeout' ? 'T' : 'D'}01-002`; reservedNumbers.push(number); return number; } }, '../../orders/services/orderTotals': totals, '../../orders/services/recalculateOrder': recalculation }, { Date: { now: () => tick++ } });
  const params = { orderId: 'original', reason: 'Returned by customer', managerId: 'manager', ...(options.fullVoid ? {} : { refundedItemIds: options.foreign ? ['foreign'] : options.empty ? [] : options.all ? ['refund', 'keep'] : options.duplicate ? ['refund', 'refund'] : ['refund'], refundMethod: options.card ? 'card_ewallet' : 'cash' }) };
  let result, error;
  try {
    result = await services[options.fullVoid ? 'voidOrder' : 'voidPaidOrderRefund'](params);
    if (options.chain && result.replacementOrderId) result = await services.voidPaidOrderRefund({ ...params, orderId: result.replacementOrderId, refundedItemIds: rows.order_items.filter(r => r.order_id === result.replacementOrderId).map(r => r.id) });
  } catch (e) { error = e.message; }
  return { name, options, input, params, result, error, reservedNumbers, expected: rows };
}
(async () => {
  const scenarios = [['paid-void', { fullVoid: true }], ['open-void', { fullVoid: true, open: true }], ['takeout-void', { fullVoid: true, takeout: true }], ['other-tab-void', { fullVoid: true, otherTab: true }], ['refund-all', { all: true }], ['takeout-refund-all', { all: true, takeout: true }], ['partial-card', { card: true }], ['duplicate-selection', { duplicate: true }], ['foreign-item', { foreign: true }], ['empty-selection', { empty: true }], ['voided-item', { voidedItem: true }], ['open-refund', { open: true }], ['missing-product', { missingProduct: true }], ['replacement-chain', { chain: true }]];
  scenarios.push(['non-vatable', { nonVat: true, discount: 'pwd' }], ['missing-store', { missingStore: true }]);
  for (const rate of [0, .12, 12]) for (const discount of ['senior_citizen', 'pwd']) for (const global of [0, -.005, 500]) scenarios.push([`${discount}-${rate}-${global}`, { rate, discount, global }]);
  const cases = [];
  for (const [name, options] of scenarios) cases.push(await run(name, options));
  const output = JSON.stringify({ provenance: 'Synthetic unchanged RN correction/recalculation service outputs; schema-normalized adapter, not native-runtime or real-store evidence', sourceHashes: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, crypto.createHash('sha256').update(value).digest('hex')])), cases }, null, 2) + '\n';
  const target = path.join(root, 'apps/android/app/src/test/resources/correction-reference.json');
  if (process.argv.includes('--check')) { if (fs.readFileSync(target, 'utf8') !== output) throw Error('Correction reference differs'); }
  else fs.writeFileSync(target, output);
  console.log(`${cases.length} unchanged RN correction scenarios ${process.argv.includes('--check') ? 'verified' : 'generated'}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
