import { EventEmitter, requireNativeModule, type Subscription } from "expo-modules-core";

interface BluetoothDeviceEvent {
  address: string;
}

const BluetoothConnectionNative = requireNativeModule("BluetoothConnection");
const emitter = new EventEmitter(BluetoothConnectionNative);

export function addDeviceConnectedListener(
  listener: (event: BluetoothDeviceEvent) => void,
): Subscription {
  return emitter.addListener("onDeviceConnected", listener);
}

export function addDeviceDisconnectedListener(
  listener: (event: BluetoothDeviceEvent) => void,
): Subscription {
  return emitter.addListener("onDeviceDisconnected", listener);
}
