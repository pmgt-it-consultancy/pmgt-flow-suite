import { connectToDevice } from "../services/bluetoothPrinter";
import { usePrinterStore } from "../stores/usePrinterStore";

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

export async function autoReconnect(address: string): Promise<void> {
  const store = usePrinterStore.getState();

  // Don't start if already reconnecting
  if (store.connectionStatus[address] === "reconnecting") return;

  store.setConnectionStatus(address, "reconnecting");

  for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
    // Race condition guard: check if status changed (e.g., native connect event fired)
    const currentStore = usePrinterStore.getState();
    if (currentStore.connectionStatus[address] === "connected") return;

    // Check if printer was removed during reconnect
    if (!currentStore.printers.find((p) => p.id === address)) return;

    currentStore.incrementReconnectAttempts(address);
    const connected = await connectToDevice(address);

    if (connected) {
      usePrinterStore.getState().setConnectionStatus(address, "connected");
      usePrinterStore.getState().resetReconnectAttempts(address);
      return;
    }

    // Wait before next attempt (exponential: 1s, 2s, 4s, 8s, 16s)
    if (i < MAX_RECONNECT_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_DELAYS_MS[i]));
    }
  }

  // All retries exhausted — total backoff wait: ~31s
  usePrinterStore.getState().setConnectionStatus(address, "failed");
}
