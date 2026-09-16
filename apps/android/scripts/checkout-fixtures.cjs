// Synthetic expected outputs execute unmodified source nodes from the invoked RN screen.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'apps/native/src/features/checkout/screens/CheckoutScreen.tsx'), 'utf8');
const tree = ts.createSourceFile('CheckoutScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = new Map();
function visit(n) {
  if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name)) nodes.set(n.name.text, n);
  ts.forEachChild(n, visit);
}
visit(tree);
const callback = name => nodes.get(name).initializer.arguments[0].getText(tree);
const declarations = ['PaymentLine', 'BuiltPayment'].map(name => tree.statements.find(n => ts.isInterfaceDeclaration(n) && n.name.text === name).getText(tree)).join('\n');
const code = declarations + '\n' + nodes.get('buildPaymentsFromLines').getText(tree) + `
function reference(paymentLines, netSales) {
 const getLineAmount = (${callback('getLineAmount')});
 const totalPayments = (${callback('totalPayments')})();
 const remaining = (${callback('remaining')})();
 const totalChange = (${callback('totalChange')})();
 return {payments: buildPaymentsFromLines(paymentLines, netSales), totalPayments, remaining, totalChange,
   enabled: !(remaining > 0.005), fullyCovered: remaining <= 0,
   exact: paymentLines.map(line => { let result; const remainingBalance = remaining; const onUpdate = value => result = value.cashReceived;
      (${nodes.get('handleExactAmount').initializer.getText(tree)})(); return result; })};
}`;
const context = {};
vm.runInNewContext(ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, context);
const cash = (id, value) => ({id, paymentMethod:'cash', cashReceived:value, amount:'', cardPaymentType:'', cardReferenceNumber:'', customPaymentType:''});
const card = (id, amount, type='GCash', reference=' ref ', custom='') => ({...cash(id,''), paymentMethod:'card_ewallet', amount, cardPaymentType:type, cardReferenceNumber:reference, customPaymentType:custom});
const inputs = [
 [100,[cash('a','20'),card('b','150')]], [100,[card('a','150'),cash('b','20')]],
 [100,[cash('a','80'),cash('b','80'),card('c','30'),cash('d','1')]],
 [100,[card('a','80'),card('b','80'),cash('c','1')]], [100,[card('a','150')]],
 [100,[cash('a','99.996')]], [100,[cash('a','99.994')]],
 [0,[cash('a','1')]], [100,[cash('a','200')]],
 [100,[card('a','100','Other',' RAW ','Voucher')]],
];
for(const value of ['', 'NaN', ' 12.5suffix', '1e', '.5x', '+1e2suffix', '0x10', '-0', 'Infinity', '-3', '1,000']) inputs.push([100,[cash('a',value)]]);
for(const due of [.1,.3,1.005,2.675,99.95,100]) for(const value of ['0.1','0.2','0.3','1.005','150']) inputs.push([due,[cash('a',value),card('b','0.1'),cash('c','0.2')]]);
const encode = value => typeof value === 'number' ? {bits: (() => {const b=Buffer.alloc(8);b.writeDoubleBE(value);return b.toString('hex')})()} : Array.isArray(value) ? value.map(encode) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)])) : value;
const fixture=JSON.stringify({provenance:'Synthetic unchanged RN AST output; no real-store/customer/payment data',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),cases:inputs.map(([netSales,lines])=>({netSales,lines,expected:encode(context.reference(lines,netSales))}))},null,2)+'\n';
const target=path.join(root,'apps/android/app/src/test/resources/checkout-reference.json');
if(process.argv.includes('--check')) {if(fs.readFileSync(target,'utf8')!==fixture)throw Error('Checkout reference differs');} else fs.writeFileSync(target,fixture);
console.log(`${inputs.length} unchanged RN checkout vectors ${process.argv.includes('--check')?'verified':'generated'}`);
