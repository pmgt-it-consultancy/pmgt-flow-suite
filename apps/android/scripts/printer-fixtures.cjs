// Generate language-neutral printer expectations from the unchanged RN formatter and the
// installed Android native command encoder. Synthetic data only; no devices or stored values.
process.env.TZ = "Asia/Manila";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const formatterPath = path.join(
  root,
  "apps/native/src/features/settings/services/escposFormatter.ts",
);
const storePath = path.join(
  root,
  "apps/native/src/features/settings/stores/usePrinterStore.ts",
);
// Resolve the installed package rather than assuming a node_modules layout: pnpm hoists it to the
// workspace root (.npmrc sets node-linker=hoisted), so apps/native/node_modules may not hold it.
const nativeRoot = path.join(
  path.dirname(require.resolve("@vardrz/react-native-bluetooth-escpos-printer/package.json")),
  "android/src/main/java",
);
const commandPath = path.join(nativeRoot, "cn/jystudio/bluetooth/escpos/command/sdk/Command.java");
const printerCommandPath = path.join(
  nativeRoot,
  "cn/jystudio/bluetooth/escpos/command/sdk/PrinterCommand.java",
);
const nativeModulePath = path.join(
  nativeRoot,
  "cn/jystudio/bluetooth/escpos/RNBluetoothEscposPrinterModule.java",
);
const formatterSource = fs.readFileSync(formatterPath, "utf8");
const storeSource = fs.readFileSync(storePath, "utf8");
const commandSource = fs.readFileSync(commandPath, "utf8");
const printerCommandSource = fs.readFileSync(printerCommandPath, "utf8");
const nativeModuleSource = fs.readFileSync(nativeModulePath, "utf8");
const bluetoothServicePath = path.join(
  root,
  "apps/native/src/features/settings/services/bluetoothPrinter.ts",
);
const bluetoothServiceSource = fs.readFileSync(bluetoothServicePath, "utf8");

// The drawer pulse arguments are the unchanged RN service defaults; every call site invokes
// openCashDrawer() with no arguments. Read them from the source so drift fails the check.
const drawerDefaults = (() => {
  const signature = bluetoothServiceSource.match(
    /export async function openCashDrawer\(\s*pin = (\d+),\s*onTime = (\d+),\s*offTime = (\d+),?\s*\)/,
  );
  if (!signature) throw new Error("Could not read openCashDrawer defaults from the RN service");
  return {
    pin: Number(signature[1]),
    onTime: Number(signature[2]),
    offTime: Number(signature[3]),
  };
})();

const calls = [];
const printer = {
  ALIGN: { LEFT: 0, CENTER: 1, RIGHT: 2 },
  printerAlign: async (align) => calls.push({ operation: "align", align }),
  printText: async (text, options) => calls.push({ operation: "printText", text, options }),
};
const context = {
  exports: {},
  require: (name) => {
    if (name === "@vardrz/react-native-bluetooth-escpos-printer") {
      return { BluetoothEscposPrinter: printer };
    }
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
const formatter = context.exports;

function createZustandStore(initializer) {
  let state;
  const set = (update) => {
    const next = typeof update === "function" ? update(state) : update;
    state = { ...state, ...next };
  };
  const get = () => state;
  state = initializer(set, get);
  const hook = (selector = (value) => value) => selector(state);
  hook.getState = get;
  hook.setState = set;
  return hook;
}

async function captureTestPrintCalls() {
  const storeCalls = [];
  const storePrinter = {
    ALIGN: { LEFT: 0, CENTER: 1, RIGHT: 2 },
    printerAlign: async (align) => storeCalls.push({ operation: "align", align }),
    printText: async (text, options) =>
      storeCalls.push({ operation: "printText", text, options }),
    // The installed bridge does not provide this method. Capture the unchanged RN invocation so
    // the approved Kotlin repair can replace only this final missing operation.
    cutPaper: async () => storeCalls.push({ operation: "sourceCutPaper" }),
  };
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ["2026-09-16T16:04:15+08:00"]));
    }
    toLocaleString() {
      return "9/16/2026, 4:04:15 PM";
    }
  }
  const storeContext = {
    exports: {},
    Date: FixedDate,
    setTimeout,
    clearTimeout,
    require: (name) => {
      if (name === "zustand") return { create: createZustandStore };
      if (name === "../services/bluetoothPrinter") {
        return {
          BluetoothEscposPrinter: storePrinter,
          connectToDevice: async () => true,
          disconnectDevice: async () => {},
          enableBluetooth: async () => {},
          getPairedDevices: async () => [],
          openCashDrawer: async () => {},
          scanDevices: async () => [],
          unpairDevice: async () => {},
        };
      }
      if (name === "../services/escposFormatter") {
        return {
          printKitchenTicketToThermal: async () => {},
          printReceiptToThermal: async () => {},
        };
      }
      if (name === "../services/printerStorage") {
        return {
          getPrinterSettings: async () => ({
            printers: [],
            kitchenPrintingEnabled: false,
            cashDrawerEnabled: false,
            useReceiptPrinterForKitchen: false,
            minimalReceiptEnabled: false,
          }),
          savePrinterSettings: async () => {},
          addPrinter: async () => {},
          removePrinter: async () => {},
          updatePrinter: async () => {},
        };
      }
      throw new Error(`Unexpected printer store import: ${name}`);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(storeSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    storeContext,
    { filename: storePath },
  );
  const printerStore = storeContext.exports.usePrinterStore;
  printerStore.setState({
    printers: [
      {
        id: "AA:BB:CC:DD:EE:FF",
        name: "Synthetic Test Printer",
        deviceName: "Synthetic Test Printer",
        role: "receipt",
        paperWidth: 80,
        isDefault: true,
      },
    ],
    connectionStatus: { "AA:BB:CC:DD:EE:FF": "connected" },
  });
  await printerStore.getState().testPrint("AA:BB:CC:DD:EE:FF");
  return storeCalls;
}

const baseReceipt = (overrides = {}) => ({
  storeName: "Synthetic Eatery",
  orderNumber: "D-101",
  orderType: "dine_in",
  cashierName: "Cashier One",
  items: [{ name: "Meal", quantity: 1, price: 100, total: 100 }],
  subtotal: 100,
  discounts: [],
  vatableSales: 89.29,
  vatAmount: 10.71,
  vatExemptSales: 0,
  total: 100,
  paymentMethod: "cash",
  transactionDate: new Date("2026-09-16T16:04:15+08:00"),
  ...overrides,
});

const cases = [
  {
    name: "receipt-minimal-32-utf8-rounding",
    kind: "receipt",
    width: 32,
    minimal: true,
    input: baseReceipt({
      items: [
        { name: "Crème 🍜", quantity: 2, price: 0.5025, total: 1.005 },
        { name: "Rice", quantity: 1, price: 1234.5, total: 1234.5 },
      ],
    }),
  },
  {
    name: "receipt-minimal-48-feed",
    kind: "receipt",
    width: 48,
    minimal: true,
    input: baseReceipt({ items: [{ name: "Tea", quantity: 1, price: 2.675, total: 2.675 }] }),
  },
  {
    name: "receipt-full-32-all-optionals-split-payments",
    kind: "receipt",
    width: 32,
    minimal: false,
    input: baseReceipt({
      storeName: "Synthetic Café 🍽️",
      storeAddress: "123 Fixture Road",
      storeTin: "000-000-000-000",
      storeContactNumber: "+63 900 000 0000",
      storeTelephone: "02 0000 0000",
      storeEmail: "fixture@example.invalid",
      storeWebsite: "example.invalid",
      storeSocials: [
        { platform: "Social", url: "@synthetic" },
        { platform: "Web", url: "/fixtures" },
      ],
      storeFooter: "Synthetic footer",
      orderNumber: "T-777",
      tableMarker: "RED",
      orderCategory: "takeout",
      orderType: "delivery",
      tableName: "Table 7",
      pax: 3,
      customerName: "Fixture Customer",
      customerId: "SYNTH-ID",
      customerAddress: "456 Test Avenue",
      customerTin: "111-111-111-111",
      orderDefaultServiceType: "dine_in",
      items: [
        {
          name: "Very long 🍜 product name for UTF16 truncation",
          quantity: 2,
          price: 1234.5,
          total: 2469,
          serviceType: "takeout",
          modifiers: [
            { optionName: "Extra", priceAdjustment: 2.675 },
            { optionName: "No charge", priceAdjustment: 0 },
            { optionName: "Credit", priceAdjustment: -1.005 },
          ],
        },
        { name: "Soup", quantity: 1, price: 1.005, total: 1.005 },
      ],
      subtotal: 2470.005,
      discounts: [
        { type: "sc", customerName: "Senior Fixture", customerId: "SC-1", itemName: "Long discount item 🍰", amount: 1.005 },
        { type: "pwd", customerName: "PWD Fixture", customerId: "PWD-1", itemName: "Soup", amount: 2.675 },
        { type: "custom", customerName: "Promo", customerId: "PROMO", itemName: "Everything", amount: 1000 },
      ],
      vatableSales: 2205.36,
      vatAmount: 264.64,
      vatExemptSales: 1.005,
      total: 1466.325,
      paymentMethod: "cash",
      payments: [
        { paymentMethod: "cash", amount: 1000, cashReceived: 1500, changeGiven: 33.675 },
        { paymentMethod: "card_ewallet", amount: 466.325, cardPaymentType: "GCash", cardReferenceNumber: "REF-SYNTH-1" },
      ],
    }),
  },
  {
    name: "receipt-full-48-sparse-legacy-cash-address-gate",
    kind: "receipt",
    width: 48,
    minimal: false,
    input: baseReceipt({
      orderNumber: "D-202",
      customerAddress: "Address alone must stay hidden",
      orderType: "take_out",
      items: [{ name: "Wide receipt meal", quantity: 1, price: 1.005, total: 1.005 }],
      subtotal: 1.005,
      vatableSales: 0.895,
      vatAmount: 0.11,
      total: 1.005,
      amountTendered: undefined,
      change: undefined,
    }),
  },
  {
    name: "receipt-full-32-legacy-noncash-number-and-negative-slice",
    kind: "receipt",
    width: 32,
    minimal: false,
    input: baseReceipt({
      receiptNumber: "R-303",
      orderType: "delivery",
      items: [{ name: "Tiny", quantity: 123456789, price: 999999999999.99, total: 999999999999.99 }],
      subtotal: 999999999999.99,
      vatableSales: 892857142857.13,
      vatAmount: 107142857142.86,
      total: 999999999999.99,
      paymentMethod: "card_ewallet",
      cardPaymentType: "Synthetic Card",
      cardReferenceNumber: "REFERENCE-THAT-IS-LONGER-THAN-THE-ROW",
    }),
  },
  {
    name: "kitchen-mixed-32-category-default-mismatch",
    kind: "kitchen",
    width: 32,
    input: {
      orderNumber: "K-404",
      orderType: "delivery",
      orderCategory: "dine_in",
      tableMarker: "BLUE",
      customerName: "Kitchen Fixture",
      timestamp: new Date("2026-09-16T04:05:06+08:00"),
      items: [
        { name: "Explicit dine-in", quantity: 1, serviceType: "dine_in", notes: "No salt", modifiers: [{ optionName: "Large", priceAdjustment: 25 }] },
        { name: "Fallback delivery is takeout 🍜", quantity: 2, notes: "Pack well" },
        { name: "Explicit takeout", quantity: 3, serviceType: "takeout" },
      ],
    },
  },
  {
    name: "kitchen-uniform-48-order-default",
    kind: "kitchen",
    width: 48,
    input: {
      orderNumber: "K-505",
      orderType: "dine_in",
      orderCategory: "takeout",
      orderDefaultServiceType: "takeout",
      timestamp: new Date("2026-09-16T00:00:00+08:00"),
      items: [
        { name: "First", quantity: 2, modifiers: [{ optionName: "Hot", priceAdjustment: 0 }] },
        { name: "Second", quantity: 1, notes: "Uniform order keeps input order" },
      ],
    },
  },
];

const helperSource = `
import cn.jystudio.bluetooth.escpos.command.sdk.PrinterCommand;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class PrinterNativeOracle {
  private static String hex(byte[] bytes) {
    StringBuilder result = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
    return result.toString();
  }
  private static byte[] concat(byte[]... parts) throws IOException {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    for (byte[] part : parts) output.write(part);
    return output.toByteArray();
  }
  public static void main(String[] args) throws Exception {
    BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    for (String line; (line = input.readLine()) != null;) {
      String[] fields = line.split("\\t", -1);
      if (fields[0].equals("A")) {
        System.out.println(hex(PrinterCommand.POS_S_Align(Integer.parseInt(fields[1]))));
      } else if (fields[0].equals("D")) {
        System.out.println(hex(PrinterCommand.POS_Set_Cashbox(
          Integer.parseInt(fields[1]), Integer.parseInt(fields[2]), Integer.parseInt(fields[3]))));
      } else if (fields[0].equals("F")) {
        System.out.println(hex(concat(
          PrinterCommand.POS_Set_PrtAndFeedPaper(30), PrinterCommand.POS_Set_Cut(1))));
      } else {
        String text = new String(Base64.getDecoder().decode(fields[1]), StandardCharsets.UTF_8);
        byte[] encoded = PrinterCommand.POS_Print_Text(
          text, fields[2], Integer.parseInt(fields[3]), Integer.parseInt(fields[4]),
          Integer.parseInt(fields[5]), Integer.parseInt(fields[6]));
        if (Boolean.parseBoolean(fields[7])) encoded = concat(
          encoded, PrinterCommand.POS_Set_PrtAndFeedPaper(30), PrinterCommand.POS_Set_Cut(1));
        System.out.println(hex(encoded));
      }
    }
  }
}
`;

function nativeEncode(allCalls) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pmgt-printer-oracle-"));
  try {
    const helperPath = path.join(temp, "PrinterNativeOracle.java");
    fs.writeFileSync(helperPath, helperSource);
    const compile = spawnSync(
      "javac",
      ["-d", temp, commandPath, printerCommandPath, helperPath],
      { encoding: "utf8" },
    );
    if (compile.status !== 0) throw new Error(`Native oracle javac failed:\n${compile.stderr}`);
    const input = allCalls
      .map((call) => {
        if (call.operation === "align") return `A\t${call.align}`;
        if (call.operation === "feedAndCut") return "F";
        if (call.operation === "openDrawer")
          return `D\t${call.pin}\t${call.onTime}\t${call.offTime}`;
        const options = call.options || {};
        return [
          "T",
          Buffer.from(call.text, "utf8").toString("base64"),
          options.encoding || "GBK",
          options.codepage || 0,
          options.widthtimes || 0,
          options.heigthtimes || 0,
          options.fonttype || 0,
          options.cut === true,
        ].join("\t");
      })
      .join("\n");
    const run = spawnSync("java", ["-cp", temp, "PrinterNativeOracle"], {
      encoding: "utf8",
      input: `${input}\n`,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (run.status !== 0) throw new Error(`Native oracle failed:\n${run.stderr}`);
    const rows = run.stdout.trim().split("\n");
    if (rows.length !== allCalls.length) {
      throw new Error(`Native oracle returned ${rows.length} rows for ${allCalls.length} calls`);
    }
    return rows;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function generate() {
  const generated = [];
  for (const fixtureCase of cases) {
    calls.length = 0;
    if (fixtureCase.kind === "receipt") {
      await formatter.printReceiptToThermal(
        fixtureCase.input,
        fixtureCase.width,
        fixtureCase.minimal,
      );
    } else {
      await formatter.printKitchenTicketToThermal(fixtureCase.input, fixtureCase.width);
    }
    const encoded = nativeEncode(calls);
    const serializedInput = JSON.parse(
      JSON.stringify(fixtureCase.input, (_key, value) =>
        value instanceof Date ? value.toISOString() : value,
      ),
    );
    generated.push({
      ...fixtureCase,
      input: serializedInput,
      calls: calls.map((call, index) => ({ ...call, hex: encoded[index] })),
      concatenatedHex: encoded.join(""),
    });
  }
  const sourceTestPrintCalls = await captureTestPrintCalls();
  const repairedTestPrintCalls = sourceTestPrintCalls.map((call) =>
    call.operation === "sourceCutPaper" ? { operation: "feedAndCut" } : call,
  );
  const testPrintEncoded = nativeEncode(repairedTestPrintCalls);
  generated.push({
    name: "test-print-approved-feed-and-cut-repair",
    kind: "test_print_repair",
    input: {
      printerName: "Synthetic Test Printer",
      displayDateTime: "9/16/2026, 4:04:15 PM",
    },
    sourceMissingOperation: "cutPaper",
    approvedRepair: "PrinterCommand.POS_Set_PrtAndFeedPaper(30) then POS_Set_Cut(1)",
    calls: repairedTestPrintCalls.map((call, index) => ({
      ...call,
      hex: testPrintEncoded[index],
    })),
    concatenatedHex: testPrintEncoded.join(""),
  });
  const drawerCalls = [{ operation: "openDrawer", ...drawerDefaults }];
  const drawerEncoded = nativeEncode(drawerCalls);
  generated.push({
    name: "cash-drawer-source-default-pulse",
    kind: "cash_drawer",
    input: drawerDefaults,
    nativeOperation: "PrinterCommand.POS_Set_Cashbox",
    calls: drawerCalls.map((call, index) => ({ ...call, hex: drawerEncoded[index] })),
    concatenatedHex: drawerEncoded.join(""),
  });
  const sha256 = (source) => crypto.createHash("sha256").update(source).digest("hex");
  const fixture = `${JSON.stringify(
    {
      provenance:
        "Synthetic calls emitted by unchanged RN escposFormatter.ts/usePrinterStore.ts; bytes encoded by installed PrinterCommand.java using RNBluetoothEscposPrinterModule printText ordering. Test Print replaces only the captured missing cutPaper invocation with the approved native feed30 plus cut1 repair. The cash drawer pulse uses the unchanged bluetoothPrinter.ts openCashDrawer defaults encoded by PrinterCommand.POS_Set_Cashbox. No Kotlin-generated expectations.",
      timezone: process.env.TZ,
      nativePackageVersion: "0.1.2",
      formatterSha256: sha256(formatterSource),
      printerStoreSha256: sha256(storeSource),
      commandSha256: sha256(commandSource),
      printerCommandSha256: sha256(printerCommandSource),
      bluetoothServiceSha256: sha256(bluetoothServiceSource),
      nativeModuleSha256: sha256(nativeModuleSource),
      cases: generated,
    },
    null,
    2,
  )}\n`;
  const target = path.join(root, "apps/android/app/src/test/resources/printer-reference.json");
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8") !== fixture) {
      throw new Error("Printer fixture differs from RN/native oracle; regenerate and review");
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fixture);
  }
  console.log(
    `${generated.length} RN/native printer fixtures ${process.argv.includes("--check") ? "verified" : "generated"}`,
  );
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
