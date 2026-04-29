type Subscription = { remove: () => void };

class EventEmitterShim {
  private module: Record<string, unknown>;
  private listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  constructor(module: Record<string, unknown>) {
    this.module = module;
  }

  addListener<T extends (...args: unknown[]) => void>(
    eventName: string,
    listener: T,
  ): Subscription {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName)!.push(listener as (...args: unknown[]) => void);
    return {
      remove: () => {
        const arr = this.listeners.get(eventName);
        if (arr) {
          const idx = arr.indexOf(listener as (...args: unknown[]) => void);
          if (idx !== -1) arr.splice(idx, 1);
        }
      },
    };
  }

  removeAllListeners(eventName: string): void {
    this.listeners.delete(eventName);
  }

  emit(eventName: string, ...args: unknown[]): void {
    const arr = this.listeners.get(eventName);
    if (arr) {
      for (const fn of [...arr]) {
        fn(...args);
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireNativeModule(name: string): any {
  return {};
}

interface BluetoothDeviceEvent {
  address: string;
}

const BluetoothConnectionNative = requireNativeModule("BluetoothConnection");
const emitter = new EventEmitterShim(BluetoothConnectionNative);

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
