import {
  BluetoothEscposPrinter,
  BluetoothManager,
} from "@vardrz/react-native-bluetooth-escpos-printer";
import {
  DeviceEventEmitter,
  type EmitterSubscription,
  PermissionsAndroid,
  Platform,
} from "react-native";

const UNPAIR_POLL_INTERVAL_MS = 300;
const UNPAIR_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 3500;
const CONNECT_RETRY_DELAY_MS = 800;

export interface BluetoothDevice {
  name: string;
  address: string;
}

async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const apiLevel = Platform.Version;
    if (apiLevel >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
    } else {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch {
    return false;
  }
}

async function listEnabledBluetoothDevices(): Promise<BluetoothDevice[]> {
  const result = await BluetoothManager.enableBluetooth();
  const list: unknown[] = Array.isArray(result) ? result : [];

  return list
    .map((d) => {
      const device = d as { name?: string; address?: string };
      return device.address ? { name: device.name || "Unknown", address: device.address } : null;
    })
    .filter((d): d is BluetoothDevice => d !== null);
}

function parseBluetoothDevice(raw: unknown): BluetoothDevice | null {
  if (!raw) return null;

  const parsed =
    typeof raw === "string" ? (JSON.parse(raw) as { name?: string; address?: string }) : raw;
  const device = parsed as { name?: string; address?: string };
  if (!device.address) return null;

  return {
    name: device.name || "Unknown",
    address: device.address,
  };
}

function parseBluetoothDeviceList(raw: unknown): BluetoothDevice[] {
  if (!raw) return [];

  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown[]) : raw;
  const list = Array.isArray(parsed) ? parsed : [];
  return list
    .map(parseBluetoothDevice)
    .filter((device): device is BluetoothDevice => device !== null);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isTargetDeviceConnected(address: string): Promise<boolean> {
  try {
    const bluetoothManager = BluetoothManager as typeof BluetoothManager & {
      getConnectedDeviceAddress?: () => Promise<string | null>;
      isDeviceConnected?: () => Promise<boolean>;
    };

    const [isConnected, connectedAddress] = await Promise.all([
      typeof bluetoothManager.isDeviceConnected === "function"
        ? bluetoothManager.isDeviceConnected()
        : Promise.resolve(false),
      typeof bluetoothManager.getConnectedDeviceAddress === "function"
        ? bluetoothManager.getConnectedDeviceAddress()
        : Promise.resolve(null),
    ]);

    return isConnected === true && connectedAddress === address;
  } catch {
    return false;
  }
}

async function attemptConnect(address: string): Promise<boolean> {
  try {
    await Promise.race([
      BluetoothManager.connect(address),
      (async () => {
        await delay(CONNECT_TIMEOUT_MS);
        if (await isTargetDeviceConnected(address)) {
          return;
        }
        throw new Error("Connection timed out");
      })(),
    ]);
    return true;
  } catch {
    return isTargetDeviceConnected(address);
  }
}

export async function isBluetoothEnabled(): Promise<boolean> {
  try {
    const enabled = await BluetoothManager.isBluetoothEnabled();
    return enabled === true;
  } catch {
    return false;
  }
}

export async function enableBluetooth(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await BluetoothManager.enableBluetooth();
  } catch {
    // silently fail
  }
}

export async function getPairedDevices(): Promise<BluetoothDevice[]> {
  if (Platform.OS === "ios") return [];
  const granted = await requestBluetoothPermissions();
  if (!granted) return [];
  try {
    return await listEnabledBluetoothDevices();
  } catch {
    return [];
  }
}

export async function scanDevices(): Promise<BluetoothDevice[]> {
  if (Platform.OS === "ios") {
    console.warn("Bluetooth Classic scanning is not supported on iOS");
    return [];
  }
  const granted = await requestBluetoothPermissions();
  if (!granted) {
    console.warn("Bluetooth permissions not granted");
    return [];
  }
  try {
    const result = await BluetoothManager.scanDevices();
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const found: unknown[] = parsed?.found ?? parsed?.paired ?? [];
    const paired: unknown[] = parsed?.paired ?? [];

    const deviceMap = new Map<string, BluetoothDevice>();
    if (__DEV__) console.log("Scan result:", parsed);

    const addDevices = (list: unknown[]) => {
      for (const d of list) {
        const device = d as { name?: string; address?: string };
        if (device.address && !deviceMap.has(device.address)) {
          deviceMap.set(device.address, {
            name: device.name || "Unknown",
            address: device.address,
          });
        }
      }
    };

    addDevices(paired);
    addDevices(found);

    return Array.from(deviceMap.values());
  } catch {
    return [];
  }
}

export async function connectToDevice(address: string): Promise<boolean> {
  if (Platform.OS === "ios") {
    console.warn("Bluetooth Classic connection is not supported on iOS");
    return false;
  }
  const granted = await requestBluetoothPermissions();
  if (!granted) return false;
  const connected = await attemptConnect(address);
  if (connected) return true;

  try {
    const pairedDevices = await listEnabledBluetoothDevices();
    const isPaired = pairedDevices.some((device) => device.address === address);
    if (!isPaired) {
      return false;
    }
  } catch {
    return false;
  }

  await delay(CONNECT_RETRY_DELAY_MS);
  return attemptConnect(address);
}

export async function disconnectDevice(address?: string): Promise<void> {
  try {
    const bluetoothManager = BluetoothManager as typeof BluetoothManager & {
      disconnect: (deviceAddress?: string) => Promise<void>;
    };
    await bluetoothManager.disconnect(address);
  } catch {
    // silently fail
  }
}

export async function unpairDevice(address: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const granted = await requestBluetoothPermissions();
  if (!granted) return;

  try {
    const bluetoothManager = BluetoothManager as typeof BluetoothManager & {
      unpair?: (deviceAddress: string) => Promise<void>;
      unpaire?: (deviceAddress: string) => Promise<void>;
    };

    if (typeof bluetoothManager.unpair === "function") {
      await bluetoothManager.unpair(address);
      return;
    }

    if (typeof bluetoothManager.unpaire === "function") {
      await bluetoothManager.unpaire(address);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < UNPAIR_TIMEOUT_MS) {
      const pairedDevices = await listEnabledBluetoothDevices();
      if (!pairedDevices.some((device) => device.address === address)) {
        return;
      }

      await delay(UNPAIR_POLL_INTERVAL_MS);
    }
  } catch (error) {
    console.warn("Failed to unpair device:", error);
    throw error;
  }
}

export async function openCashDrawer(pin = 0, onTime = 25, offTime = 250): Promise<void> {
  try {
    // ESC p command: pin (0=pin2, 1=pin5), onTime (n×2ms), offTime (n×2ms)
    await (BluetoothEscposPrinter as any).openDrawer(pin, onTime, offTime);
  } catch (error) {
    console.warn("Failed to open cash drawer:", error);
    throw error;
  }
}

export function addScanDeviceFoundListener(
  listener: (device: BluetoothDevice) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener("EVENT_DEVICE_FOUND", (event?: { device?: string }) => {
    const device = parseBluetoothDevice(event?.device);
    if (device) {
      listener(device);
    }
  });
}

export function addScanPairedDevicesListener(
  listener: (devices: BluetoothDevice[]) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener(
    "EVENT_DEVICE_ALREADY_PAIRED",
    (event?: { devices?: string }) => {
      listener(parseBluetoothDeviceList(event?.devices));
    },
  );
}

export function addScanCompletedListener(listener: () => void): EmitterSubscription {
  return DeviceEventEmitter.addListener("EVENT_DEVICE_DISCOVER_DONE", listener);
}

export { BluetoothEscposPrinter } from "@vardrz/react-native-bluetooth-escpos-printer";
