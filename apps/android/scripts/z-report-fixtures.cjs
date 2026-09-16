// Generate synthetic Z-report expectations from the unchanged RN formatter and installed native
// command encoder. This script performs no Bluetooth I/O and reads no application data.
process.env.TZ = "Asia/Manila";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const formatterPath = path.join(root, "apps/native/src/features/day-closing/utils/zReportFormatter.ts");
// Resolve the installed package rather than assuming a node_modules layout: pnpm hoists it to the
// workspace root (.npmrc sets node-linker=hoisted), so apps/native/node_modules may not hold it.
const nativeRoot = path.join(path.dirname(require.resolve("@vardrz/react-native-bluetooth-escpos-printer/package.json")), "android/src/main/java");
const commandPath = path.join(nativeRoot, "cn/jystudio/bluetooth/escpos/command/sdk/Command.java");
const printerCommandPath = path.join(nativeRoot, "cn/jystudio/bluetooth/escpos/command/sdk/PrinterCommand.java");
const formatterSource = fs.readFileSync(formatterPath, "utf8");
const commandSource = fs.readFileSync(commandPath, "utf8");
const printerCommandSource = fs.readFileSync(printerCommandPath, "utf8");

const calls = [];
const printer = {
  ALIGN: { LEFT: 0, CENTER: 1, RIGHT: 2 },
  printerAlign: async (align) => calls.push({ operation: "align", align }),
  printText: async (text, options) => calls.push({ operation: "printText", text, options }),
};
const fixedNow = new Date("2026-09-16T08:04:05.000Z");
class FixedDate extends Date {
  constructor(...args) { super(...(args.length === 0 ? [fixedNow.getTime()] : args)); }
  static now() { return fixedNow.getTime(); }
}
const context = {
  exports: {}, Date: FixedDate, Intl,
  require: (name) => {
    if (name === "@vardrz/react-native-bluetooth-escpos-printer") return { BluetoothEscposPrinter: printer };
    throw new Error(`Unexpected formatter import: ${name}`);
  },
};
vm.runInNewContext(
  ts.transpileModule(formatterSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  context,
  { filename: formatterPath },
);

const baseReport = (overrides = {}) => ({
  reportDate: "2026-09-16",
  grossSales: 1234.5, netSales: 1200.825,
  vatableSales: 1071.45, vatAmount: 128.575, vatExemptSales: 0, nonVatSales: 0,
  seniorDiscounts: 1.005, pwdDiscounts: 2.675, promoDiscounts: 30, manualDiscounts: 0,
  totalDiscounts: 33.675, voidCount: 2, voidAmount: 40.5,
  cashTotal: 700.5, cardEwalletTotal: 500.325,
  transactionCount: 12, averageTicket: 100.06875, generatedByName: "Manager One",
  ...overrides,
});

const cases = [
  {
    name: "z-report-full-day-32-empty-breakdowns-rounding",
    width: 32,
    input: {
      storeName: "Synthetic Eatery", storeAddress: "123 Fixture Road", storeTin: "000-000-000-000",
      report: baseReport(), productSales: [], paymentTransactions: [],
      printedAt: "2026-09-16T16:04:05",
    },
  },
  {
    name: "z-report-cross-midnight-48-rich-utf16",
    width: 48,
    input: {
      storeName: "Synthetic Café 🍜", report: baseReport({
        reportDate: "2026-09-15", startTime: "18:00", endTime: "03:00",
        grossSales: 999999999999.99, netSales: 1466.325,
      }),
      productSales: [
        { productName: "Very long 🍜 product name for UTF16 truncation", quantitySold: 2, grossAmount: 2.675, categoryName: "Meals" },
        { productName: "Soup", quantitySold: 4, grossAmount: 1.005, categoryName: "Meals" },
        { productName: "Tea", quantitySold: 1, grossAmount: 1234.5, categoryName: "Drinks" },
      ],
      paymentTransactions: [
        { paymentType: "GCash", transactions: [
          { orderNumber: "D-101", referenceNumber: "REFERENCE-THAT-IS-LONGER-THAN-THE-ROW", amount: 2.675 },
          { orderNumber: "D-102", referenceNumber: "REF-2", amount: 1.005 },
        ], subtotal: 3.68 },
      ],
      printedAt: "2026-09-16T16:04:05",
    },
  },
];

const helperSource = `
import cn.jystudio.bluetooth.escpos.command.sdk.PrinterCommand;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
public final class ZReportNativeOracle {
  private static String hex(byte[] bytes) {
    StringBuilder value = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) value.append(String.format("%02x", b & 0xff));
    return value.toString();
  }
  private static byte[] concat(byte[]... parts) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (byte[] part : parts) out.write(part);
    return out.toByteArray();
  }
  public static void main(String[] args) throws Exception {
    BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    for (String line; (line = input.readLine()) != null;) {
      String[] f = line.split("\\t", -1);
      if (f[0].equals("A")) System.out.println(hex(PrinterCommand.POS_S_Align(Integer.parseInt(f[1]))));
      else {
        String text = new String(Base64.getDecoder().decode(f[1]), StandardCharsets.UTF_8);
        byte[] encoded = PrinterCommand.POS_Print_Text(text, f[2], Integer.parseInt(f[3]), Integer.parseInt(f[4]), Integer.parseInt(f[5]), Integer.parseInt(f[6]));
        if (Boolean.parseBoolean(f[7])) encoded = concat(encoded, PrinterCommand.POS_Set_PrtAndFeedPaper(30), PrinterCommand.POS_Set_Cut(1));
        System.out.println(hex(encoded));
      }
    }
  }
}`;

function nativeEncode(allCalls) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pmgt-z-report-oracle-"));
  try {
    const helperPath = path.join(temp, "ZReportNativeOracle.java");
    fs.writeFileSync(helperPath, helperSource);
    const compile = spawnSync("javac", ["-d", temp, commandPath, printerCommandPath, helperPath], { encoding: "utf8" });
    if (compile.status !== 0) throw new Error(`Native oracle compile failed:\n${compile.stderr}`);
    const input = allCalls.map((call) => {
      if (call.operation === "align") return `A\t${call.align}`;
      const o = call.options || {};
      return ["T", Buffer.from(call.text, "utf8").toString("base64"), o.encoding || "GBK", o.codepage || 0, o.widthtimes || 0, o.heigthtimes || 0, o.fonttype || 0, o.cut === true].join("\t");
    }).join("\n");
    const run = spawnSync("java", ["-cp", temp, "ZReportNativeOracle"], { encoding: "utf8", input: `${input}\n`, maxBuffer: 20 * 1024 * 1024 });
    if (run.status !== 0) throw new Error(`Native oracle failed:\n${run.stderr}`);
    const rows = run.stdout.trim().split("\n");
    if (rows.length !== allCalls.length) throw new Error(`Native oracle returned ${rows.length}/${allCalls.length} rows`);
    return rows;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

async function generate() {
  const generated = [];
  for (const fixtureCase of cases) {
    calls.length = 0;
    const input = fixtureCase.input;
    await context.exports.printZReportToThermal({
      storeName: input.storeName, storeAddress: input.storeAddress, storeTin: input.storeTin,
      ...input.report,
    }, fixtureCase.width, input.productSales, input.paymentTransactions);
    const encoded = nativeEncode(calls);
    generated.push({ ...fixtureCase, calls: calls.map((call, i) => ({ ...call, hex: encoded[i] })), concatenatedHex: encoded.join("") });
  }
  const sha = (source) => crypto.createHash("sha256").update(source).digest("hex");
  const output = `${JSON.stringify({
    provenance: "Synthetic calls emitted by unchanged RN zReportFormatter.ts and bytes encoded by installed PrinterCommand.java; no Kotlin-generated expectations.",
    timezone: process.env.TZ, locale: "en-PH", fixedPrintedAt: fixedNow.toISOString(), nativePackageVersion: "0.1.2",
    formatterSha256: sha(formatterSource), commandSha256: sha(commandSource), printerCommandSha256: sha(printerCommandSource),
    cases: generated,
  }, null, 2)}\n`;
  const target = path.join(root, "apps/android/app/src/test/resources/z-report-reference.json");
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8") !== output) throw new Error("Z-report fixture differs from RN/native oracle");
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
  }
}

generate().catch((error) => { console.error(error); process.exitCode = 1; });
