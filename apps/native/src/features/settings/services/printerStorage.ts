import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "printer_settings";

export interface PrinterConfig {
  id: string;
  name: string;
  deviceName: string;
  role: "receipt" | "kitchen";
  paperWidth: 58 | 80;
  isDefault: boolean;
}

export interface PrinterSettings {
  printers: PrinterConfig[];
  kitchenPrintingEnabled: boolean;
  cashDrawerEnabled: boolean;
  useReceiptPrinterForKitchen: boolean;
}

const DEFAULT_SETTINGS: PrinterSettings = {
  printers: [],
  kitchenPrintingEnabled: false,
  cashDrawerEnabled: false,
  useReceiptPrinterForKitchen: false,
};

export async function getPrinterSettings(): Promise<PrinterSettings> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS, printers: [] };
  return JSON.parse(raw) as PrinterSettings;
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(settings));
}

export async function getDefaultPrinter(
  role: "receipt" | "kitchen",
): Promise<PrinterConfig | null> {
  const settings = await getPrinterSettings();
  return settings.printers.find((p) => p.role === role && p.isDefault) ?? null;
}

export async function addPrinter(config: PrinterConfig): Promise<void> {
  const settings = await getPrinterSettings();
  settings.printers.push(config);
  await savePrinterSettings(settings);
}

export async function updatePrinter(id: string, updates: Partial<PrinterConfig>): Promise<void> {
  const settings = await getPrinterSettings();
  settings.printers = settings.printers.map((p) => (p.id === id ? { ...p, ...updates } : p));
  await savePrinterSettings(settings);
}

export async function removePrinter(id: string): Promise<void> {
  const settings = await getPrinterSettings();
  settings.printers = settings.printers.filter((p) => p.id !== id);
  await savePrinterSettings(settings);
}
