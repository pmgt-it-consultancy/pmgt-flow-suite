import { BluetoothEscposPrinter } from "@vardrz/react-native-bluetooth-escpos-printer";
import type { ReceiptData } from "../../shared/utils/receipt";

export interface KitchenTicketItem {
  name: string;
  quantity: number;
  notes?: string;
  modifiers?: { optionName: string; priceAdjustment: number }[];
}

export interface KitchenTicketData {
  orderNumber: string;
  tableName?: string;
  orderType: "dine_in" | "take_out" | "delivery";
  items: KitchenTicketItem[];
  timestamp: Date;
}

const line = (char: string, width: number): string => char.repeat(width);

const formatRow = (left: string, right: string, width: number): string => {
  const gap = width - left.length - right.length;
  if (gap < 1) return left.slice(0, width - right.length - 1) + " " + right;
  return left + " ".repeat(gap) + right;
};

const formatCurrency = (amount: number): string => {
  const formatted = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `P ${formatted}`;
};

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);

const orderTypeLabel = (type: "dine_in" | "take_out" | "delivery"): string =>
  type === "dine_in" ? "Dine-In" : type === "take_out" ? "Take-Out" : "Delivery";

const ALIGN = BluetoothEscposPrinter.ALIGN;

// widthtimes/heigthtimes: 0 = 1x (normal), 1 = 2x (double), 2 = 3x
const normal = () => ({ encoding: "UTF-8", widthtimes: 0, heigthtimes: 0, fonttype: 0 });
const bold = () => ({ encoding: "UTF-8", widthtimes: 0, heigthtimes: 1, fonttype: 0 });
const large = () => ({ encoding: "UTF-8", widthtimes: 1, heigthtimes: 1, fonttype: 0 });

export async function printReceiptToThermal(
  data: ReceiptData,
  charsPerLine: number,
): Promise<void> {
  const w = charsPerLine;
  const p = BluetoothEscposPrinter;

  // Header
  await p.printerAlign(ALIGN.CENTER);
  await p.printText(`${data.storeName}\n`, bold());
  if (data.storeAddress) await p.printText(`${data.storeAddress}\n`, normal());
  if (data.storeTin) await p.printText(`TIN: ${data.storeTin}\n`, normal());

  await p.printText(`${line("-", w)}\n`, normal());

  // Order info
  await p.printerAlign(ALIGN.LEFT);
  if (data.receiptNumber) await p.printText(`Receipt #: ${data.receiptNumber}\n`, normal());
  await p.printText(`Date: ${formatDate(data.transactionDate)}\n`, normal());
  await p.printText(`Order Type: ${orderTypeLabel(data.orderType)}\n`, normal());
  if (data.tableName) await p.printText(`Table: ${data.tableName}\n`, normal());
  await p.printText(`Cashier: ${data.cashierName}\n`, normal());

  // Customer info (from root-level fields or discount details)
  if (data.customerName || data.customerId || data.customerTin) {
    await p.printText("\n", normal());
    if (data.customerName) await p.printText(`Customer: ${data.customerName}\n`, normal());
    if (data.customerId) await p.printText(`ID No.: ${data.customerId}\n`, normal());
    if (data.customerAddress) await p.printText(`Address: ${data.customerAddress}\n`, normal());
    if (data.customerTin) await p.printText(`TIN: ${data.customerTin}\n`, normal());
  }

  await p.printText(`${line("-", w)}\n`, normal());

  // Items
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("ORDER ITEMS\n", bold());
  await p.printerAlign(ALIGN.LEFT);

  for (const item of data.items) {
    await p.printText(`${item.name}\n`, normal());
    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        const modText =
          mod.priceAdjustment > 0
            ? `  + ${mod.optionName} (${formatCurrency(mod.priceAdjustment)})`
            : `  + ${mod.optionName}`;
        await p.printText(`${modText}\n`, normal());
      }
    }
    const detail = `  ${item.quantity}x ${formatCurrency(item.price)}`;
    const total = formatCurrency(item.total);
    await p.printText(`${formatRow(detail, total, w)}\n`, normal());
  }

  await p.printText(`${line("-", w)}\n`, normal());

  // Totals & VAT
  await p.printText(`${formatRow("Subtotal", formatCurrency(data.subtotal), w)}\n`, normal());
  await p.printText(
    `${formatRow("Vatable Sales", formatCurrency(data.vatableSales), w)}\n`,
    normal(),
  );
  await p.printText(`${formatRow("VAT 12%", formatCurrency(data.vatAmount), w)}\n`, normal());
  await p.printText(
    `${formatRow("VAT-Exempt", formatCurrency(data.vatExemptSales), w)}\n`,
    normal(),
  );

  if (data.discounts.length > 0) {
    await p.printText("\n", normal());
    await p.printText(`${line("-", w)}\n`, normal());
    await p.printerAlign(ALIGN.CENTER);
    await p.printText("DISCOUNTS\n", bold());
    await p.printerAlign(ALIGN.LEFT);
    for (const d of data.discounts) {
      const label = `${d.type === "sc" ? "SC" : d.type === "pwd" ? "PWD" : "Discount"}: ${d.customerName}`;
      await p.printText(`${label}\n`, normal());
      await p.printText(`ID: ${d.customerId}\n`, normal());
      await p.printText(`${formatRow(d.itemName, `-${formatCurrency(d.amount)}`, w)}\n`, normal());
      await p.printText("\n", normal());
    }
    const totalDiscount = data.discounts.reduce((s, d) => s + d.amount, 0);
    await p.printText(
      `${formatRow("Total Discount", `-${formatCurrency(totalDiscount)}`, w)}\n`,
      normal(),
    );
  }

  await p.printText(`${formatRow("TOTAL", formatCurrency(data.total), w)}\n`, bold());

  await p.printText(`${line("-", w)}\n`, normal());

  // Payment
  const paymentLabel =
    data.paymentMethod === "cash" ? "Cash" : data.cardPaymentType || "Card/E-Wallet";
  await p.printText(`${formatRow("Payment Method", paymentLabel, w)}\n`, normal());

  if (data.paymentMethod === "cash") {
    await p.printText(
      `${formatRow("Amount Tendered", formatCurrency(data.amountTendered ?? 0), w)}\n`,
      normal(),
    );
    await p.printText(`${formatRow("Change", formatCurrency(data.change ?? 0), w)}\n`, normal());
  } else {
    if (data.cardReferenceNumber) {
      await p.printText(`${formatRow("Ref #", data.cardReferenceNumber, w)}\n`, normal());
    }
  }

  await p.printText(`${line("-", w)}\n`, normal());

  // Footer
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("Thank you for your patronage!\n", normal());
  await p.printText("This does not serve as an official receipt\n", normal());
  const feed = charsPerLine >= 48 ? "\n\n\n\n\n\n" : "\n\n\n";
  await p.printText(`Powered by PMGT Flow Suite${feed}`, {
    ...normal(),
    cut: true,
  });
}

export async function printKitchenTicketToThermal(
  data: KitchenTicketData,
  charsPerLine: number,
): Promise<void> {
  const w = charsPerLine;
  const p = BluetoothEscposPrinter;

  // Order number
  await p.printerAlign(ALIGN.CENTER);
  await p.printText(`#${data.orderNumber}\n`, large());
  await p.printText("\n", normal());

  // Table or order type
  if (data.tableName) {
    await p.printText(`${data.tableName.toUpperCase()}\n`, bold());
  } else {
    await p.printText(`${orderTypeLabel(data.orderType).toUpperCase()}\n`, bold());
  }
  await p.printText("\n", normal());

  // Timestamp
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${formatDate(data.timestamp)}\n`, normal());
  await p.printText(`${line("-", w)}\n`, normal());

  // Items
  for (const item of data.items) {
    await p.printText(`  ${item.quantity}x ${item.name}\n`, bold());
    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        await p.printText(`     > ${mod.optionName}\n`, normal());
      }
    }
    if (item.notes) {
      await p.printText(`     * ${item.notes}\n`, normal());
    }
  }

  const feed = charsPerLine >= 48 ? "\n\n\n\n\n" : "\n\n";
  await p.printText(`${line("-", w)}${feed}`, { ...normal(), cut: true });
}
