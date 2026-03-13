import {
  BluetoothEscposPrinter,
  BluetoothManager,
} from "@vardrz/react-native-bluetooth-escpos-printer";
import { PermissionsAndroid, Platform } from "react-native";

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
    const result = await BluetoothManager.enableBluetooth();
    const list: unknown[] = Array.isArray(result) ? result : [];

    return list
      .map((d) => {
        const device = d as { name?: string; address?: string };
        return device.address ? { name: device.name || "Unknown", address: device.address } : null;
      })
      .filter((d): d is BluetoothDevice => d !== null);
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
    console.log("Scan result:", parsed);

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
  try {
    await BluetoothManager.connect(address);
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDevice(): Promise<void> {
  try {
    await BluetoothManager.disconnect();
  } catch {
    // silently fail
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

export { BluetoothEscposPrinter } from "@vardrz/react-native-bluetooth-escpos-printer";
