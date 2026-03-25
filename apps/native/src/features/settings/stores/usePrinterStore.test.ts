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

import { connectToDevice, disconnectDevice, unpairDevice } from "../services/bluetoothPrinter";
import {
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
