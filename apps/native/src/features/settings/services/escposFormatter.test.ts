import { BluetoothEscposPrinter } from "@vardrz/react-native-bluetooth-escpos-printer";
import type { ReceiptData } from "../../shared/utils/receipt";
import { formatReceiptDateTime, printReceiptToThermal } from "./escposFormatter";

jest.mock("@vardrz/react-native-bluetooth-escpos-printer", () => ({
  BluetoothEscposPrinter: {
    ALIGN: {
      CENTER: 1,
      LEFT: 0,
    },
    printerAlign: jest.fn(),
    printText: jest.fn(),
  },
}));

describe("formatReceiptDateTime", () => {
  it("formats receipt dates with ASCII spacing before AM/PM", () => {
    const date = new Date(2026, 4, 6, 16, 4, 15);

    expect(formatReceiptDateTime(date)).toBe("05/06/2026, 4:04:15 PM");
    expect(formatReceiptDateTime(date)).toMatch(/^[\x20-\x7E]+$/);
  });
});

describe("printReceiptToThermal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prints only product name, quantity, and price in minimal receipt mode", async () => {
    const receipt: ReceiptData = {
      storeName: "PMGT Carinderia",
      orderNumber: "ORD-1",
      orderType: "dine_in",
      cashierName: "Cashier",
      items: [
        {
          name: "Pork Adobo",
          quantity: 2,
          price: 75,
          total: 150,
          modifiers: [{ optionName: "Extra Rice", priceAdjustment: 15 }],
        },
        { name: "Rice", quantity: 1, price: 15, total: 15 },
      ],
      subtotal: 165,
      discounts: [],
      vatableSales: 147.32,
      vatAmount: 17.68,
      vatExemptSales: 0,
      total: 165,
      paymentMethod: "cash",
      transactionDate: new Date(2026, 4, 6, 16, 4, 15),
    };

    await printReceiptToThermal(receipt, 32, true);

    const printedText = (BluetoothEscposPrinter.printText as jest.Mock).mock.calls
      .map(([text]) => text)
      .join("");

    expect(printedText).toBe(
      "Product Name Quantity Price\nPork Adobo 2 P 150.00\nRice 1 P 15.00\n\n\n\n",
    );
    expect(printedText).not.toContain("PMGT Carinderia");
    expect(printedText).not.toContain("Extra Rice");
    expect(printedText).not.toContain("TOTAL");
    expect(printedText).not.toContain("VAT");
    expect(printedText).not.toContain("Payment");
  });
});
