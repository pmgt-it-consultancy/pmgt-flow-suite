import "@vardrz/react-native-bluetooth-escpos-printer";

declare module "@vardrz/react-native-bluetooth-escpos-printer" {
  interface BluetoothEscposPrinterType {
    printerAlign(align: number): Promise<void>;
    printColumnLeftRight(left: string, right: string, options?: Record<string, unknown>): Promise<void>;
    printColumn(values: number[], options?: Record<string, unknown>): Promise<void>;
    openDrawer(pin?: number, onTime?: number, offTime?: number): Promise<void>;
  }

  interface BluetoothManagerType {
    isDeviceConnected(): Promise<boolean>;
    getConnectedDeviceAddress(): Promise<string | null>;
    unpaire(address: string): Promise<void>;
    unpair(address: string): Promise<void>;
  }
}
