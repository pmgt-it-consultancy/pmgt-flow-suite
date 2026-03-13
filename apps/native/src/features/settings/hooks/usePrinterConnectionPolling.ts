import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { connectToDevice } from "../services/bluetoothPrinter";
import { usePrinterStore } from "../stores/usePrinterStore";
import { autoReconnect } from "../utils/autoReconnect";

const POLL_INTERVAL_MS = 60_000;

export function usePrinterConnectionPolling() {
  const isInitialized = usePrinterStore((s) => s.isInitialized);
  const printers = usePrinterStore((s) => s.printers);
  const isPollingRef = useRef(false);

  useEffect(() => {
    if (!isInitialized || printers.length === 0) return;

    const poll = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        const store = usePrinterStore.getState();

        for (const printer of store.printers) {
          const currentStatus = store.connectionStatus[printer.id];

          // Don't poll printers that are actively reconnecting
          if (currentStatus === "reconnecting") continue;

          const connected = await connectToDevice(printer.id);

          if (connected) {
            store.setConnectionStatus(printer.id, "connected");
            store.resetReconnectAttempts(printer.id);
          } else if (currentStatus === "connected") {
            // Was connected, now isn't — start auto-reconnect
            autoReconnect(printer.id);
          }
          // If already "disconnected" or "failed", don't re-trigger auto-reconnect
        }
      } finally {
        isPollingRef.current = false;
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);

    // Run an immediate poll when app comes to foreground
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        poll();
      }
    });

    return () => {
      clearInterval(intervalId);
      appStateSub.remove();
    };
  }, [isInitialized, printers.length]);
}
