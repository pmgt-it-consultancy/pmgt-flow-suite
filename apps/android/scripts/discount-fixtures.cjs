// Synthetic append-only first-insert evidence from the unchanged invoked RN service.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const service = fs.readFileSync(path.join(root, 'apps/native/src/features/discounts/services/discountMutations.ts'), 'utf8');
const tax = fs.readFileSync(path.join(root, 'packages/shared/src/taxCalculations.ts'), 'utf8');
const tree = ts.createSourceFile('discountMutations.ts', service, ts.ScriptTarget.Latest, true);
const functionSource = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'applyBulkScPwdDiscount').getText(tree);
const taxContext = {exports:{}};
vm.runInNewContext(ts.transpileModule(tax, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, taxContext);
const encode = value => typeof value === 'number' ? (() => { const b=Buffer.alloc(8);b.writeDoubleBE(value);return b.toString('hex'); })() : value;
(async () => {
  const cases=[];
  for(const price of [112, .05, 1.005, 2.675, 99.95]) for(const vatRate of [0, .12, 12]) for(const isVatable of [true,false]) {
    const modifiers=[.1,.2,28];
    const rows=[];
    const collection = name => ({find: async () => name==='orders'?{storeId:'store'}:name==='stores'?{vatRate}:name==='products'?{isVatable}:{productId:'product',productPrice:price}, query: () => ({fetch: async () => modifiers.map(priceAdjustment=>({priceAdjustment}))}),create: async fn => {const row={_raw:{}};fn(row);rows.push(row);}});
    const db={get:collection,collections:{get:collection},write:async fn=>fn()};
    const context={exports:{},getDatabase:()=>db,Q:{where:()=>null},uid:()=> 'synthetic-discount',calculateScPwdDiscount:taxContext.exports.calculateScPwdDiscount,recalculateOrderTotals:async()=>{},syncManager:{triggerPush:()=>{}}};
    vm.runInNewContext(ts.transpileModule(functionSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, context);
    await context.exports.applyBulkScPwdDiscount({orderId:'order',items:[{orderItemId:'item',quantityApplied:1}],discountType:'pwd',customerName:'Customer',customerId:'ID',managerId:'manager'});
    cases.push({price,vatRate,isVatable,modifiers,discountAmount:encode(rows[0].discountAmount),vatExemptAmount:encode(rows[0].vatExemptAmount)});
  }
  const fixture=JSON.stringify({provenance:'Synthetic actual RN service first insert, recalc deliberately excluded; no real data',serviceSha256:crypto.createHash('sha256').update(service).digest('hex'),taxSha256:crypto.createHash('sha256').update(tax).digest('hex'),cases},null,2)+'\n';
  const target=path.join(root,'apps/android/app/src/test/resources/discount-reference.json');
  if(process.argv.includes('--check')) {if(fs.readFileSync(target,'utf8')!==fixture)throw Error('Discount reference differs');} else fs.writeFileSync(target,fixture);
  console.log(`${cases.length} unchanged RN first-insert discount vectors ${process.argv.includes('--check')?'verified':'generated'}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
