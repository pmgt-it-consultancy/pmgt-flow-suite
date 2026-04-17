import { BluetoothEscposPrinter } from "@vardrz/react-native-bluetooth-escpos-printer";

export interface ZReportData {
  storeName: string;
  storeAddress?: string;
  storeTin?: string;
  reportDate: string;
  startTime?: string; // "HH:mm" or undefined for full day
  endTime?: string;
  grossSales: number;
  netSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  seniorDiscounts: number;
  pwdDiscounts: number;
  promoDiscounts: number;
  manualDiscounts: number;
  totalDiscounts: number;
  voidCount: number;
  voidAmount: number;
  cashTotal: number;
  cardEwalletTotal: number;
  transactionCount: number;
  averageTicket: number;
  generatedByName: string;
}

export interface ProductSaleItem {
  productName: string;
  quantitySold: number;
  grossAmount: number;
  categoryName: string;
}

export interface PaymentTransaction {
  orderNumber: string;
  referenceNumber: string;
  amount: number;
}

export interface PaymentTransactionGroup {
  paymentType: string;
  transactions: PaymentTransaction[];
  subtotal: number;
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

const ALIGN = BluetoothEscposPrinter.ALIGN;

// widthtimes/heigthtimes: 0 = 1x (normal), 1 = 2x (double), 2 = 3x
const normal = () => ({ encoding: "UTF-8", widthtimes: 0, heigthtimes: 0, fonttype: 0 });
const bold = () => ({ encoding: "UTF-8", widthtimes: 0, heigthtimes: 1, fonttype: 0 });
const large = () => ({ encoding: "UTF-8", widthtimes: 1, heigthtimes: 1, fonttype: 0 });

export async function printZReportToThermal(
  data: ZReportData,
  charsPerLine: number,
  productSales: ProductSaleItem[] = [],
  paymentTransactions: PaymentTransactionGroup[] = [],
): Promise<void> {
  const w = charsPerLine;
  const p = BluetoothEscposPrinter;
  const feed = charsPerLine >= 48 ? "\n\n\n\n\n\n" : "\n\n\n";

  // Store header
  await p.printerAlign(ALIGN.CENTER);
  await p.printText(`${data.storeName}\n`, bold());
  if (data.storeAddress) await p.printText(`${data.storeAddress}\n`, normal());
  if (data.storeTin) await p.printText(`TIN: ${data.storeTin}\n`, normal());

  await p.printText("\n", normal());

  // Z-Report title
  await p.printText("Z-REPORT / END OF DAY\n", large());
  await p.printText("\n", normal());

  // Report date
  await p.printText(`${data.reportDate}\n`, bold());

  if (data.startTime && data.endTime) {
    const crossesMidnight = data.endTime <= data.startTime;
    const formatTime = (t: string): string => {
      const [h, m] = t.split(":").map(Number);
      const suffix = h >= 12 ? "PM" : "AM";
      const hour = h % 12 || 12;
      return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
    };
    const suffix = crossesMidnight ? " (next day)" : "";
    await p.printText(
      `${formatTime(data.startTime)} - ${formatTime(data.endTime)}${suffix}\n`,
      normal(),
    );
  }

  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${line("=", w)}\n`, normal());

  // Sales summary
  await p.printText(`${formatRow("Gross Sales", formatCurrency(data.grossSales), w)}\n`, bold());
  await p.printText(
    `${formatRow("Less Discounts", `-${formatCurrency(data.totalDiscounts)}`, w)}\n`,
    normal(),
  );
  await p.printText(
    `${formatRow("Less Voids", `-${formatCurrency(data.voidAmount)}`, w)}\n`,
    normal(),
  );
  await p.printText(`${line("-", w)}\n`, normal());
  await p.printText(`${formatRow("NET SALES", formatCurrency(data.netSales), w)}\n`, bold());

  await p.printText("\n", normal());

  // Transaction stats
  await p.printText(`${formatRow("Transactions", String(data.transactionCount), w)}\n`, normal());
  await p.printText(
    `${formatRow("Average Ticket", formatCurrency(data.averageTicket), w)}\n`,
    normal(),
  );

  await p.printText("\n", normal());

  // Payment breakdown
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("PAYMENT BREAKDOWN\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${line("-", w)}\n`, normal());
  await p.printText(`${formatRow("Cash", formatCurrency(data.cashTotal), w)}\n`, normal());
  await p.printText(
    `${formatRow("Card/E-Wallet", formatCurrency(data.cardEwalletTotal), w)}\n`,
    normal(),
  );

  await p.printText("\n", normal());

  // Discount breakdown
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("DISCOUNT BREAKDOWN\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${line("-", w)}\n`, normal());
  await p.printText(`${formatRow("Senior", formatCurrency(data.seniorDiscounts), w)}\n`, normal());
  await p.printText(`${formatRow("PWD", formatCurrency(data.pwdDiscounts), w)}\n`, normal());
  await p.printText(`${formatRow("Promo", formatCurrency(data.promoDiscounts), w)}\n`, normal());
  await p.printText(`${formatRow("Manual", formatCurrency(data.manualDiscounts), w)}\n`, normal());
  await p.printText(`${line("-", w)}\n`, normal());
  await p.printText(
    `${formatRow("Total Discounts", formatCurrency(data.totalDiscounts), w)}\n`,
    bold(),
  );

  await p.printText("\n", normal());

  // Voids
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("VOIDS\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${line("-", w)}\n`, normal());
  await p.printText(`${formatRow("Void Count", String(data.voidCount), w)}\n`, normal());
  await p.printText(`${formatRow("Void Amount", formatCurrency(data.voidAmount), w)}\n`, normal());

  await p.printText("\n", normal());

  // VAT summary
  await p.printerAlign(ALIGN.CENTER);
  await p.printText("VAT SUMMARY\n", bold());
  await p.printerAlign(ALIGN.LEFT);
  await p.printText(`${line("-", w)}\n`, normal());
  await p.printText(
    `${formatRow("VATable Sales", formatCurrency(data.vatableSales), w)}\n`,
    normal(),
  );
  await p.printText(
    `${formatRow("VAT Amount 12%", formatCurrency(data.vatAmount), w)}\n`,
    normal(),
  );
  await p.printText(
    `${formatRow("VAT-Exempt", formatCurrency(data.vatExemptSales), w)}\n`,
    normal(),
  );
  await p.printText(`${formatRow("Non-VAT", formatCurrency(data.nonVatSales), w)}\n`, normal());

  await p.printText(`${line("=", w)}\n`, normal());

  // Items sold breakdown (category-grouped)
  if (productSales.length > 0) {
    await p.printText("\n", normal());
    await p.printerAlign(ALIGN.CENTER);
    await p.printText("ITEMS SOLD\n", bold());
    await p.printerAlign(ALIGN.LEFT);
    await p.printText(`${line("-", w)}\n`, normal());

    // Column widths: product name gets remaining space, qty = 5 chars, amount = 10 chars
    const qtyCol = 5;
    const amtCol = 10;
    const nameCol = w - qtyCol - amtCol - 2; // 2 for spacing

    // Header
    const hdrName = "Item".padEnd(nameCol);
    const hdrQty = "Qty".padStart(qtyCol);
    const hdrAmt = "Amt".padStart(amtCol);
    await p.printText(`${hdrName} ${hdrQty} ${hdrAmt}\n`, normal());

    // Group products by categoryName
    const categoryMap = new Map<string, ProductSaleItem[]>();
    for (const item of productSales) {
      const cat = item.categoryName || "Uncategorized";
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.push(item);
      } else {
        categoryMap.set(cat, [item]);
      }
    }

    // Sort categories alphabetically
    const sortedCategories = [...categoryMap.keys()].sort((a, b) => a.localeCompare(b));

    let grandTotalQty = 0;
    let grandTotalAmt = 0;

    for (const categoryName of sortedCategories) {
      const items = categoryMap.get(categoryName)!;

      // Category header: "-- CategoryName --------" bold, padded with dashes to fill line width
      const catPrefix = "-- ";
      const catSuffix = " ";
      const catLabel = `${catPrefix}${categoryName}${catSuffix}`;
      const remainingDashes = Math.max(0, w - catLabel.length);
      const catHeader = `${catLabel}${line("-", remainingDashes)}`;
      await p.printText(`${catHeader}\n`, bold());

      // Sort products within category by qty desc
      const sortedItems = [...items].sort((a, b) => b.quantitySold - a.quantitySold);

      let catQty = 0;
      let catAmt = 0;

      for (const item of sortedItems) {
        catQty += item.quantitySold;
        catAmt += item.grossAmount;

        const name =
          item.productName.length > nameCol
            ? item.productName.slice(0, nameCol)
            : item.productName.padEnd(nameCol);
        const qty = String(item.quantitySold).padStart(qtyCol);
        const amt = formatCurrency(item.grossAmount).padStart(amtCol);
        await p.printText(`${name} ${qty} ${amt}\n`, normal());
      }

      // Category subtotal
      await p.printText(`${line("-", w)}\n`, normal());
      const catSubLabel = "Subtotal".padEnd(nameCol);
      const catSubQty = String(catQty).padStart(qtyCol);
      const catSubAmt = formatCurrency(catAmt).padStart(amtCol);
      await p.printText(`${catSubLabel} ${catSubQty} ${catSubAmt}\n`, bold());
      await p.printText("\n", normal());

      grandTotalQty += catQty;
      grandTotalAmt += catAmt;
    }

    // Grand total
    await p.printText(`${line("-", w)}\n`, normal());
    const totalLabel = "Total".padEnd(nameCol);
    const totalQtyStr = String(grandTotalQty).padStart(qtyCol);
    const totalAmtStr = formatCurrency(grandTotalAmt).padStart(amtCol);
    await p.printText(`${totalLabel} ${totalQtyStr} ${totalAmtStr}\n`, bold());
    await p.printText(`${line("=", w)}\n`, normal());
  }

  // Payment transactions breakdown
  if (paymentTransactions.length > 0) {
    await p.printText("\n", normal());
    await p.printerAlign(ALIGN.CENTER);
    await p.printText("PAYMENT TRANSACTIONS\n", bold());
    await p.printerAlign(ALIGN.LEFT);

    for (const group of paymentTransactions) {
      // Group header: "-- PaymentType --------" bold
      const grpPrefix = "-- ";
      const grpSuffix = " ";
      const grpLabel = `${grpPrefix}${group.paymentType}${grpSuffix}`;
      const grpRemainingDashes = Math.max(0, w - grpLabel.length);
      const grpHeader = `${grpLabel}${line("-", grpRemainingDashes)}`;
      await p.printText(`${grpHeader}\n`, bold());

      for (const txn of group.transactions) {
        const left = `#${txn.orderNumber}  ${txn.referenceNumber}`;
        const right = formatCurrency(txn.amount);
        await p.printText(`${formatRow(left, right, w)}\n`, normal());
      }

      // Subtotal per group
      await p.printText(`${line("-", w)}\n`, normal());
      await p.printText(`${formatRow("Subtotal", formatCurrency(group.subtotal), w)}\n`, bold());
      await p.printText("\n", normal());
    }

    await p.printText(`${line("=", w)}\n`, normal());
  }

  // Footer
  await p.printerAlign(ALIGN.CENTER);
  await p.printText(`Generated by: ${data.generatedByName}\n`, normal());
  await p.printText(`Printed: ${formatDate(new Date())}\n`, normal());
  await p.printText("** system-generated **\n", normal());
  await p.printText(`Powered by PMGT Flow Suite${feed}`, { ...normal(), cut: true });
}
