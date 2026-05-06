import { formatReceiptDateTime } from "./escposFormatter";

jest.mock("@vardrz/react-native-bluetooth-escpos-printer", () => ({
  BluetoothEscposPrinter: {
    ALIGN: {
      CENTER: 1,
      LEFT: 0,
    },
  },
}));

describe("formatReceiptDateTime", () => {
  it("formats receipt dates with ASCII spacing before AM/PM", () => {
    const date = new Date(2026, 4, 6, 16, 4, 15);

    expect(formatReceiptDateTime(date)).toBe("05/06/2026, 4:04:15 PM");
    expect(formatReceiptDateTime(date)).toMatch(/^[\x20-\x7E]+$/);
  });
});
