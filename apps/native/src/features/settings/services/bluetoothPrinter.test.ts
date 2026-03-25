jest.mock("react-native", () => ({
  DeviceEventEmitter: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN: "BLUETOOTH_SCAN",
      BLUETOOTH_CONNECT: "BLUETOOTH_CONNECT",
      ACCESS_FINE_LOCATION: "ACCESS_FINE_LOCATION",
    },
    RESULTS: {
      GRANTED: "granted",
    },
    requestMultiple: jest.fn().mockResolvedValue({
      BLUETOOTH_SCAN: "granted",
      BLUETOOTH_CONNECT: "granted",
      ACCESS_FINE_LOCATION: "granted",
    }),
    request: jest.fn().mockResolvedValue("granted"),
  },
  Platform: {
    OS: "android",
    Version: 34,
  },
}));

jest.mock("@vardrz/react-native-bluetooth-escpos-printer", () => ({
  BluetoothEscposPrinter: {},
  BluetoothManager: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    enableBluetooth: jest.fn(),
    getConnectedDeviceAddress: jest.fn(),
    isBluetoothEnabled: jest.fn(),
    isDeviceConnected: jest.fn(),
    scanDevices: jest.fn(),
    unpaire: jest.fn(),
  },
}));

import { BluetoothManager } from "@vardrz/react-native-bluetooth-escpos-printer";
import { connectToDevice, unpairDevice } from "./bluetoothPrinter";

describe("connectToDevice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns true when the native connect promise hangs but the device is already connected", async () => {
    (BluetoothManager.connect as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    (BluetoothManager.isDeviceConnected as jest.Mock).mockResolvedValue(true);
    (BluetoothManager.getConnectedDeviceAddress as jest.Mock).mockResolvedValue("AA:BB:CC");

    const promise = connectToDevice("AA:BB:CC");

    await jest.advanceTimersByTimeAsync(3500);

    await expect(promise).resolves.toBe(true);
    expect(BluetoothManager.isDeviceConnected).toHaveBeenCalled();
    expect(BluetoothManager.getConnectedDeviceAddress).toHaveBeenCalled();
  });

  it("retries once after a transient connection failure and succeeds", async () => {
    (BluetoothManager.connect as jest.Mock)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    (BluetoothManager.isDeviceConnected as jest.Mock).mockResolvedValue(false);
    (BluetoothManager.getConnectedDeviceAddress as jest.Mock).mockResolvedValue(null);
    (BluetoothManager.enableBluetooth as jest.Mock).mockResolvedValue([
      { name: "Printer", address: "AA:BB:CC" },
    ]);

    const promise = connectToDevice("AA:BB:CC");

    await jest.advanceTimersByTimeAsync(800);

    await expect(promise).resolves.toBe(true);
    expect(BluetoothManager.connect).toHaveBeenCalledTimes(2);
  });
});

describe("unpairDevice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("waits until the device is no longer reported as paired", async () => {
    const enableBluetooth = BluetoothManager.enableBluetooth as jest.Mock;
    enableBluetooth
      .mockResolvedValueOnce([
        { name: "Printer", address: "AA:BB:CC" },
        { name: "Other", address: "11:22:33" },
      ])
      .mockResolvedValueOnce([
        { name: "Printer", address: "AA:BB:CC" },
        { name: "Other", address: "11:22:33" },
      ])
      .mockResolvedValueOnce([{ name: "Other", address: "11:22:33" }]);

    const promise = unpairDevice("AA:BB:CC");

    await Promise.resolve();
    await Promise.resolve();
    expect(BluetoothManager.unpaire).toHaveBeenCalledWith("AA:BB:CC");

    await jest.advanceTimersByTimeAsync(300);

    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(300);
    await promise;

    expect(enableBluetooth).toHaveBeenCalledTimes(3);
  });
});
