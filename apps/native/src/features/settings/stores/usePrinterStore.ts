import { create } from "zustand";
import type { ReceiptData } from "../../shared/utils/receipt";
import type { BluetoothDevice } from "../services/bluetoothPrinter";
import {
  BluetoothEscposPrinter,
  connectToDevice,
  disconnectDevice,
  enableBluetooth,
  getPairedDevices,
  openCashDrawer as openCashDrawerCommand,
  scanDevices,
} from "../services/bluetoothPrinter";
import type { KitchenTicketData } from "../services/escposFormatter";
import { printKitchenTicketToThermal, printReceiptToThermal } from "../services/escposFormatter";
import type { PrinterConfig, PrinterSettings } from "../services/printerStorage";
import {
  getPrinterSettings,
  savePrinterSettings,
  addPrinter as storageAddPrinter,
  removePrinter as storageRemovePrinter,
  updatePrinter as storageUpdatePrinter,
} from "../services/printerStorage";

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
// This is needed as sometimes the Bluetooth stack needs a moment to settle
const INITIALIZATION_DELAY_MS = 1000;

interface PrinterStore {
  printers: PrinterConfig[];
  connectionStatus: Record<string, boolean>;
  isScanning: boolean;
  kitchenPrintingEnabled: boolean;
  cashDrawerEnabled: boolean;
  isInitialized: boolean;

  initialize: () => Promise<{ failedPrinters: string[] }>;
  fetchPairedDevices: () => Promise<BluetoothDevice[]>;
  scanForDevices: () => Promise<BluetoothDevice[]>;
  connectPrinter: (address: string) => Promise<boolean>;
  disconnectPrinter: (address: string) => Promise<void>;
  addPrinter: (
    device: BluetoothDevice,
    role: "receipt" | "kitchen",
    paperWidth: 58 | 80,
  ) => Promise<void>;
  removePrinter: (id: string) => Promise<void>;
  updatePrinter: (id: string, updates: Partial<PrinterConfig>) => Promise<void>;
  setKitchenPrintingEnabled: (enabled: boolean) => Promise<void>;
  setCashDrawerEnabled: (enabled: boolean) => Promise<void>;

  printReceipt: (data: ReceiptData) => Promise<void>;
  printKitchenTicket: (data: KitchenTicketData) => Promise<void>;
  openCashDrawer: () => Promise<void>;
  testPrint: (address: string) => Promise<void>;
}

export const usePrinterStore = create<PrinterStore>((set, get) => ({
  printers: [],
  connectionStatus: {},
  isScanning: false,
  kitchenPrintingEnabled: false,
  cashDrawerEnabled: false,
  isInitialized: false,

  initialize: async () => {
    const settings = await getPrinterSettings();
    set({
      printers: settings.printers,
      kitchenPrintingEnabled: settings.kitchenPrintingEnabled,
      cashDrawerEnabled: settings.cashDrawerEnabled,
    });

    await enableBluetooth();

    await new Promise((resolve) => setTimeout(resolve, INITIALIZATION_DELAY_MS));

    const failedPrinters: string[] = [];
    const connectionStatus: Record<string, boolean> = {};

    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      // No need for exponential backoff here since connection attempts are spaced out by user interaction time
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }

      for (const printer of settings.printers) {
        const connected = await connectToDevice(printer.id);
        connectionStatus[printer.id] = connected;
        if (!connected) {
          failedPrinters.push(printer.name);
        }
      }
    }

    set({ connectionStatus, isInitialized: true });
    return { failedPrinters };
  },

  fetchPairedDevices: async () => {
    return getPairedDevices();
  },

  scanForDevices: async () => {
    set({ isScanning: true });
    const devices = await scanDevices();
    set({ isScanning: false });
    return devices;
  },

  connectPrinter: async (address: string) => {
    const connected = await connectToDevice(address);
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [address]: connected },
    }));
    return connected;
  },

  disconnectPrinter: async (address: string) => {
    await disconnectDevice();
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [address]: false },
    }));
  },

  addPrinter: async (device, role, paperWidth) => {
    const { printers } = get();
    const hasDefaultForRole = printers.some((p) => p.role === role && p.isDefault);

    const config: PrinterConfig = {
      id: device.address,
      name: device.name,
      deviceName: device.name,
      role,
      paperWidth,
      isDefault: !hasDefaultForRole,
    };

    await storageAddPrinter(config);

    const connected = await connectToDevice(device.address);

    set((state) => ({
      printers: [...state.printers, config],
      connectionStatus: {
        ...state.connectionStatus,
        [device.address]: connected,
      },
    }));
  },

  removePrinter: async (id: string) => {
    const { connectionStatus } = get();
    if (connectionStatus[id]) {
      await disconnectDevice();
    }

    await storageRemovePrinter(id);

    set((state) => {
      const { [id]: _, ...remainingStatus } = state.connectionStatus;
      return {
        printers: state.printers.filter((p) => p.id !== id),
        connectionStatus: remainingStatus,
      };
    });
  },

  updatePrinter: async (id, updates) => {
    await storageUpdatePrinter(id, updates);

    set((state) => ({
      printers: state.printers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },

  setKitchenPrintingEnabled: async (enabled: boolean) => {
    const { printers, cashDrawerEnabled } = get();
    const settings: PrinterSettings = {
      printers,
      kitchenPrintingEnabled: enabled,
      cashDrawerEnabled,
    };
    await savePrinterSettings(settings);
    set({ kitchenPrintingEnabled: enabled });
  },

  setCashDrawerEnabled: async (enabled: boolean) => {
    const { printers, kitchenPrintingEnabled } = get();
    const settings: PrinterSettings = {
      printers,
      kitchenPrintingEnabled,
      cashDrawerEnabled: enabled,
    };
    await savePrinterSettings(settings);
    set({ cashDrawerEnabled: enabled });
  },

  printReceipt: async (data: ReceiptData) => {
    const { printers, connectPrinter } = get();
    const printer = printers.find((p) => p.role === "receipt" && p.isDefault);
    if (!printer) throw new Error("No receipt printer configured");

    // Always connect before printing — Bluetooth Classic supports only one active connection
    const connected = await connectPrinter(printer.id);
    if (!connected) throw new Error("Failed to connect to receipt printer");

    const charsPerLine = printer.paperWidth === 58 ? 32 : 48;
    await printReceiptToThermal(data, charsPerLine);
  },

  printKitchenTicket: async (data: KitchenTicketData) => {
    const { kitchenPrintingEnabled, printers, connectPrinter } = get();
    if (!kitchenPrintingEnabled) return;

    const printer = printers.find((p) => p.role === "kitchen" && p.isDefault);
    if (!printer) return;

    // Always connect before printing — Bluetooth Classic supports only one active connection
    const connected = await connectPrinter(printer.id);
    if (!connected) return;

    const charsPerLine = printer.paperWidth === 58 ? 32 : 48;
    await printKitchenTicketToThermal(data, charsPerLine);
  },

  openCashDrawer: async () => {
    const { printers, connectPrinter } = get();
    const printer = printers.find((p) => p.role === "receipt" && p.isDefault);
    if (!printer) throw new Error("No receipt printer configured");

    const connected = await connectPrinter(printer.id);
    if (!connected) throw new Error("Failed to connect to receipt printer");

    await openCashDrawerCommand();
  },

  testPrint: async (address: string) => {
    const { connectionStatus, connectPrinter, printers } = get();

    if (!connectionStatus[address]) {
      const connected = await connectPrinter(address);
      if (!connected) throw new Error("Failed to connect to printer");
    }

    const printer = printers.find((p) => p.id === address);
    const name = printer?.name ?? "Unknown Printer";
    const now = new Date().toLocaleString();
    const p = BluetoothEscposPrinter;

    await p.printerAlign(p.ALIGN.CENTER);
    await p.printText("=== TEST PRINT ===\n", { encoding: "UTF-8", widthtimes: 0, heigthtimes: 1 });
    await p.printText(`${name}\n`, { encoding: "UTF-8", widthtimes: 0, heigthtimes: 0 });
    await p.printText(`${now}\n`, { encoding: "UTF-8", widthtimes: 0, heigthtimes: 0 });
    await p.printText("Printer is working correctly\n\n\n\n", {
      encoding: "UTF-8",
      widthtimes: 0,
      heigthtimes: 0,
    });
    await p.cutPaper();
  },
}));
