import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
  modifiers?: { optionName: string; priceAdjustment: number }[];
}

export interface ReceiptDiscount {
  type: "sc" | "pwd" | "custom";
  customerName: string;
  customerId: string;
  itemName: string;
  amount: number;
}

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  storeTin?: string;
  storeContactNumber?: string;
  storeTelephone?: string;
  storeEmail?: string;
  storeWebsite?: string;
  storeSocials?: { platform: string; url: string }[];
  storeFooter?: string;
  orderNumber: string;
  tableName?: string;
  tableMarker?: string;
  orderCategory?: "dine_in" | "takeout";
  pax?: number;
  orderType: "dine_in" | "take_out" | "delivery";
  cashierName: string;
  items: ReceiptItem[];
  subtotal: number;
  discounts: ReceiptDiscount[];
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  total: number;
  paymentMethod: "cash" | "card" | "card_ewallet";
  amountTendered?: number;
  change?: number;
  cardLastFour?: string;
  cardPaymentType?: string;
  cardReferenceNumber?: string;
  transactionDate: Date;
  receiptNumber?: string;
  customerName?: string;
  customerId?: string;
  customerAddress?: string;
  customerTin?: string;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
};

export const generateReceiptHtml = (data: ReceiptData): string => {
  const orderTypeLabel = data.orderCategory
    ? data.orderCategory === "dine_in"
      ? "Dine-In"
      : "Takeout"
    : data.orderType === "dine_in"
      ? "Dine-In"
      : data.orderType === "take_out"
        ? "Take-Out"
        : "Delivery";

  const receiptDisplayNumber = data.tableMarker
    ? `${data.receiptNumber ?? data.orderNumber} | ${data.tableMarker}`
    : (data.receiptNumber ?? data.orderNumber);

  const itemsHtml = data.items
    .map((item) => {
      const modifiersHtml = item.modifiers?.length
        ? item.modifiers
            .map(
              (mod) =>
                `<tr><td colspan="3" style="padding-left:15px;font-size:10px;color:#666;">+ ${mod.optionName}${mod.priceAdjustment > 0 ? ` (${formatCurrency(mod.priceAdjustment)})` : ""}</td><td></td></tr>`,
            )
            .join("")
        : "";
      return `
      <tr>
        <td>${item.name}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${formatCurrency(item.price)}</td>
        <td class="right">${formatCurrency(item.total)}</td>
      </tr>
      ${modifiersHtml}
    `;
    })
    .join("");

  const discountsHtml =
    data.discounts.length > 0
      ? `<tr><td colspan="4" style="padding-top:8px;border-top:1px dashed #ccc;"></td></tr>
         <tr><td colspan="4" style="font-weight:bold;padding-bottom:4px;">DISCOUNTS</td></tr>` +
        data.discounts
          .map(
            (d) => `
      <tr class="discount">
        <td colspan="4" style="padding-top:6px;">
          ${d.type === "sc" ? "SC" : d.type === "pwd" ? "PWD" : "Discount"}: ${d.customerName}
        </td>
      </tr>
      <tr class="discount">
        <td colspan="4" style="font-size:10px;padding-top:2px;">ID: ${d.customerId}</td>
      </tr>
      <tr class="discount">
        <td colspan="3" style="font-size:10px;padding-top:2px;">${d.itemName}</td>
        <td class="right">-${formatCurrency(d.amount)}</td>
      </tr>
    `,
          )
          .join("")
      : "";

  const paymentMethodLabel =
    data.paymentMethod === "cash" ? "Cash" : data.cardPaymentType || "Card/E-Wallet";

  const paymentDetailsHtml =
    data.paymentMethod === "cash"
      ? `
        <div class="payment-row">
          <span>Amount Tendered:</span>
          <span>${formatCurrency(data.amountTendered || 0)}</span>
        </div>
        <div class="payment-row">
          <span>Change:</span>
          <span>${formatCurrency(data.change || 0)}</span>
        </div>
      `
      : `
        ${
          data.cardReferenceNumber
            ? `<div class="payment-row">
          <span>Ref #:</span>
          <span>${data.cardReferenceNumber}</span>
        </div>`
            : ""
        }
      `;

  const customerInfoHtml =
    data.customerName || data.customerId || data.customerAddress || data.customerTin
      ? `
        <div class="customer-info">
          <div class="section-title">CUSTOMER INFORMATION</div>
          ${data.customerName ? `<div>Name: ${data.customerName}</div>` : ""}
          ${data.customerId ? `<div>ID No.: ${data.customerId}</div>` : ""}
          ${data.customerAddress ? `<div>Address: ${data.customerAddress}</div>` : ""}
          ${data.customerTin ? `<div>TIN: ${data.customerTin}</div>` : ""}
        </div>
        <div class="divider"></div>
      `
      : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.4;
          padding: 10px;
          max-width: 300px;
          margin: 0 auto;
        }
        .header {
          text-align: center;
          margin-bottom: 15px;
        }
        .store-name {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 5px;
        }
        .store-info {
          font-size: 10px;
          color: #333;
        }
        .divider {
          border-top: 1px dashed #333;
          margin: 10px 0;
        }
        .order-info {
          margin-bottom: 10px;
        }
        .order-info div {
          display: flex;
          justify-content: space-between;
          margin-bottom: 2px;
        }
        .section-title {
          font-weight: bold;
          text-align: center;
          margin: 10px 0 5px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          padding: 3px;
          text-align: left;
          font-size: 11px;
        }
        th {
          border-bottom: 1px solid #333;
        }
        .center {
          text-align: center;
        }
        .right {
          text-align: right;
        }
        .totals {
          margin-top: 10px;
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 3px;
        }
        .total-row.grand-total {
          font-weight: bold;
          font-size: 14px;
          border-top: 1px solid #333;
          border-bottom: 2px solid #333;
          padding: 5px 0;
          margin: 5px 0;
        }
        .discount {
          color: #c00;
        }
        .payment-method {
          margin-top: 10px;
        }
        .payment-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 3px;
        }
        .vat-info {
          font-size: 10px;
          margin-top: 10px;
        }
        .vat-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 2px;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          font-size: 10px;
        }
        .footer .thank-you {
          font-size: 12px;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .customer-info {
          margin-bottom: 10px;
          font-size: 10px;
        }
        @media print {
          body {
            padding: 0;
            max-width: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="store-name">${data.storeName}</div>
        ${data.storeAddress ? `<div class="store-info">${data.storeAddress}</div>` : ""}
        ${data.storeTin ? `<div class="store-info">TIN: ${data.storeTin}</div>` : ""}
        ${data.storeContactNumber ? `<div class="store-info">Tel: ${data.storeContactNumber}</div>` : ""}
        ${data.storeTelephone ? `<div class="store-info">Phone: ${data.storeTelephone}</div>` : ""}
        ${data.storeEmail ? `<div class="store-info">${data.storeEmail}</div>` : ""}
        ${data.storeWebsite ? `<div class="store-info">${data.storeWebsite}</div>` : ""}
        ${data.storeSocials?.length ? data.storeSocials.map((s) => `<div class="store-info">${s.platform}: ${s.url}</div>`).join("") : ""}
      </div>

      <div class="divider"></div>

      <div class="order-info">
        <div><span>Receipt #:</span><span>${receiptDisplayNumber}</span></div>
        <div><span>Date:</span><span>${formatDate(data.transactionDate)}</span></div>
        <div><span>Order Type:</span><span>${orderTypeLabel}</span></div>
        ${data.tableName ? `<div><span>Table:</span><span>${data.tableName}</span></div>` : ""}
        ${data.pax ? `<div><span>PAX:</span><span>${data.pax}</span></div>` : ""}
        <div><span>Cashier:</span><span>${data.cashierName}</span></div>
      </div>

      ${customerInfoHtml}

      <div class="divider"></div>

      <div class="section-title">ORDER ITEMS</div>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="center">Qty</th>
            <th class="right">Price</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
          ${discountsHtml}
        </tbody>
      </table>

      <div class="divider"></div>

      <div class="totals">
        <div class="total-row">
          <span>Subtotal:</span>
          <span>${formatCurrency(data.subtotal)}</span>
        </div>
        ${
          data.discounts.length > 0
            ? `
        <div class="total-row discount">
          <span>Less: Discount</span>
          <span>-${formatCurrency(data.discounts.reduce((sum, d) => sum + d.amount, 0))}</span>
        </div>
        `
            : ""
        }
        <div class="total-row grand-total">
          <span>TOTAL:</span>
          <span>${formatCurrency(data.total)}</span>
        </div>
      </div>

      <div class="payment-method">
        <div class="section-title">PAYMENT</div>
        <div class="payment-row">
          <span>Method:</span>
          <span>${paymentMethodLabel}</span>
        </div>
        ${paymentDetailsHtml}
      </div>

      <div class="divider"></div>

      <div class="vat-info">
        <div class="section-title">VAT BREAKDOWN</div>
        <div class="vat-row">
          <span>VATable Sales:</span>
          <span>${formatCurrency(data.vatableSales)}</span>
        </div>
        <div class="vat-row">
          <span>VAT Amount (12%):</span>
          <span>${formatCurrency(data.vatAmount)}</span>
        </div>
        <div class="vat-row">
          <span>VAT-Exempt Sales:</span>
          <span>${formatCurrency(data.vatExemptSales)}</span>
        </div>
      </div>

      <div class="footer">
        <div class="thank-you">${data.storeFooter || "Thank you for your patronage!"}</div>
        <div>This does not serve as an official receipt</div>
        <div>Please keep this receipt for your records</div>
        <div class="divider"></div>
        <div style="margin-top: 10px;">Powered by PMGT Flow Suite</div>
      </div>
    </body>
    </html>
  `;
};

export const printReceipt = async (data: ReceiptData): Promise<void> => {
  const html = generateReceiptHtml(data);
  await Print.printAsync({ html });
};

export const generateReceiptPdf = async (data: ReceiptData): Promise<string> => {
  const html = generateReceiptHtml(data);
  const { uri } = await Print.printToFileAsync({ html });
  return uri;
};

export const shareReceipt = async (data: ReceiptData): Promise<void> => {
  const uri = await generateReceiptPdf(data);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: `Receipt ${data.orderNumber}`,
    });
  } else {
    throw new Error("Sharing is not available on this device");
  }
};
