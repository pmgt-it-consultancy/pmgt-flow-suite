const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
}));

import { getPrinterSettings, savePrinterSettings } from "./printerStorage";

describe("printerStorage", () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it("defaults minimal receipt mode to false for new settings", async () => {
    await expect(getPrinterSettings()).resolves.toMatchObject({
      minimalReceiptEnabled: false,
    });
  });

  it("defaults minimal receipt mode to false for legacy saved settings", async () => {
    await savePrinterSettings({
      printers: [],
      kitchenPrintingEnabled: true,
      cashDrawerEnabled: true,
      useReceiptPrinterForKitchen: true,
      minimalReceiptEnabled: true,
    });

    mockStore.set(
      "printer_settings",
      JSON.stringify({
        printers: [],
        kitchenPrintingEnabled: true,
        cashDrawerEnabled: true,
        useReceiptPrinterForKitchen: true,
      }),
    );

    await expect(getPrinterSettings()).resolves.toEqual({
      printers: [],
      kitchenPrintingEnabled: true,
      cashDrawerEnabled: true,
      useReceiptPrinterForKitchen: true,
      minimalReceiptEnabled: false,
    });
  });
});
