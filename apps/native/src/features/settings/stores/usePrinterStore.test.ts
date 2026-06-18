jest.mock("../services/bluetoothPrinter", () => ({
  BluetoothEscposPrinter: {
    ALIGN: { CENTER: 1 },
    printerAlign: jest.fn(),
    printText: jest.fn(),
    cutPaper: jest.fn(),
  },
  connectToDevice: jest.fn(),
  disconnectDevice: jest.fn(),
  enableBluetooth: jest.fn(),
  getPairedDevices: jest.fn(),
  openCashDrawer: jest.fn(),
  scanDevices: jest.fn(),
  unpairDevice: jest.fn(),
}));

jest.mock("../services/escposFormatter", () => ({
  printKitchenTicketToThermal: jest.fn(),
  printReceiptToThermal: jest.fn(),
}));

jest.mock("../services/printerStorage", () => ({
  getPrinterSettings: jest.fn(),
  savePrinterSettings: jest.fn(),
  addPrinter: jest.fn(),
  removePrinter: jest.fn(),
  updatePrinter: jest.fn(),
}));

import type { ReceiptData } from "../../shared/utils/receipt";
import { connectToDevice, disconnectDevice, unpairDevice } from "../services/bluetoothPrinter";
import { printReceiptToThermal } from "../services/escposFormatter";
import {
  getPrinterSettings,
  savePrinterSettings,
  addPrinter as storageAddPrinter,
  removePrinter as storageRemovePrinter,
  updatePrinter as storageUpdatePrinter,
} from "../services/printerStorage";
import { usePrinterStore } from "./usePrinterStore";

describe("usePrinterStore.addPrinter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrinterStore.setState({
      printers: [],
      connectionStatus: {},
      reconnectAttempts: {},
      isScanning: false,
      kitchenPrintingEnabled: false,
      cashDrawerEnabled: false,
      useReceiptPrinterForKitchen: false,
      minimalReceiptEnabled: false,
      isInitialized: false,
    });
  });

  it("does not create a duplicate printer when retrying the same device", async () => {
    (connectToDevice as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const device = { name: "Printer001", address: "AA:BB:CC" };

    const firstResult = await usePrinterStore.getState().addPrinter(device, "receipt", 80);
    const secondResult = await usePrinterStore.getState().addPrinter(device, "receipt", 80);

    expect(firstResult).toBe(false);
    expect(secondResult).toBe(true);
    expect(storageAddPrinter).toHaveBeenCalledTimes(1);
    expect(storageUpdatePrinter).toHaveBeenCalledTimes(1);
    expect(usePrinterStore.getState().printers).toEqual([
      {
        id: "AA:BB:CC",
        name: "Printer001",
        deviceName: "Printer001",
        role: "receipt",
        paperWidth: 80,
        isDefault: true,
      },
    ]);
  });
});

describe("usePrinterStore.removePrinter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrinterStore.setState({
      printers: [
        {
          id: "AA:BB:CC",
          name: "Kitchen Printer",
          deviceName: "Kitchen Printer",
          role: "kitchen",
          paperWidth: 80,
          isDefault: true,
        },
      ],
      connectionStatus: {
        "AA:BB:CC": "connected",
      },
      reconnectAttempts: {},
      isScanning: false,
      kitchenPrintingEnabled: false,
      cashDrawerEnabled: false,
      useReceiptPrinterForKitchen: false,
      minimalReceiptEnabled: false,
      isInitialized: false,
    });
  });

  it("disconnects, unpairs, and removes the printer from local state", async () => {
    await usePrinterStore.getState().removePrinter("AA:BB:CC");

    expect(disconnectDevice).toHaveBeenCalledTimes(1);
    expect(unpairDevice).toHaveBeenCalledWith("AA:BB:CC");
    expect(storageRemovePrinter).toHaveBeenCalledWith("AA:BB:CC");
    expect(usePrinterStore.getState().printers).toEqual([]);
    expect(usePrinterStore.getState().connectionStatus).toEqual({});
  });

  it("still removes the printer if unpairing fails", async () => {
    (unpairDevice as jest.Mock).mockRejectedValueOnce(new Error("unpair failed"));

    await usePrinterStore.getState().removePrinter("AA:BB:CC");

    expect(disconnectDevice).toHaveBeenCalledTimes(1);
    expect(unpairDevice).toHaveBeenCalledWith("AA:BB:CC");
    expect(storageRemovePrinter).toHaveBeenCalledWith("AA:BB:CC");
    expect(usePrinterStore.getState().printers).toEqual([]);
    expect(usePrinterStore.getState().connectionStatus).toEqual({});
  });

  it("stops tracking the printer before disconnecting so reconnect logic cannot target it", async () => {
    let resolveDisconnect: (() => void) | null = null;
    (disconnectDevice as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDisconnect = resolve;
        }),
    );

    const removalPromise = usePrinterStore.getState().removePrinter("AA:BB:CC");

    expect(usePrinterStore.getState().printers).toEqual([]);
    expect(usePrinterStore.getState().connectionStatus).toEqual({});

    resolveDisconnect?.();
    await removalPromise;
  });
});

describe("usePrinterStore minimal receipt setting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrinterStore.setState({
      printers: [],
      connectionStatus: {},
      reconnectAttempts: {},
      isScanning: false,
      kitchenPrintingEnabled: false,
      cashDrawerEnabled: false,
      useReceiptPrinterForKitchen: false,
      minimalReceiptEnabled: false,
      isInitialized: false,
    });
  });

  it("loads minimal receipt mode from stored printer settings", async () => {
    (getPrinterSettings as jest.Mock).mockResolvedValueOnce({
      printers: [],
      kitchenPrintingEnabled: false,
      cashDrawerEnabled: false,
      useReceiptPrinterForKitchen: false,
      minimalReceiptEnabled: true,
    });

    await usePrinterStore.getState().initialize();

    expect(usePrinterStore.getState().minimalReceiptEnabled).toBe(true);
  });

  it("persists minimal receipt mode with the other printer settings", async () => {
    await usePrinterStore.getState().setMinimalReceiptEnabled(true);

    expect(savePrinterSettings).toHaveBeenCalledWith({
      printers: [],
      kitchenPrintingEnabled: false,
      cashDrawerEnabled: false,
      useReceiptPrinterForKitchen: false,
      minimalReceiptEnabled: true,
    });
    expect(usePrinterStore.getState().minimalReceiptEnabled).toBe(true);
  });

  it("passes minimal receipt mode to thermal receipt printing", async () => {
    const receipt: ReceiptData = {
      storeName: "PMGT Carinderia",
      orderNumber: "ORD-1",
      orderType: "dine_in",
      cashierName: "Cashier",
      items: [{ name: "Rice", quantity: 1, price: 15, total: 15 }],
      subtotal: 15,
      discounts: [],
      vatableSales: 13.39,
      vatAmount: 1.61,
      vatExemptSales: 0,
      total: 15,
      paymentMethod: "cash",
      transactionDate: new Date(2026, 4, 6, 16, 4, 15),
    };

    (connectToDevice as jest.Mock).mockResolvedValueOnce(true);
    usePrinterStore.setState({
      printers: [
        {
          id: "AA:BB:CC",
          name: "Receipt Printer",
          deviceName: "Receipt Printer",
          role: "receipt",
          paperWidth: 58,
          isDefault: true,
        },
      ],
      minimalReceiptEnabled: true,
    });

    await usePrinterStore.getState().printReceipt(receipt);

    expect(printReceiptToThermal).toHaveBeenCalledWith(receipt, 32, true);
  });
});
