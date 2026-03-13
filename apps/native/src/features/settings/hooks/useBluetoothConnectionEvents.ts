import { useEffect } from "react";
import {
  addDeviceConnectedListener,
  addDeviceDisconnectedListener,
} from "../../../../modules/bluetooth-connection";
import { usePrinterStore } from "../stores/usePrinterStore";
import { autoReconnect } from "../utils/autoReconnect";

export function useBluetoothConnectionEvents() {
  const isInitialized = usePrinterStore((s) => s.isInitialized);

  useEffect(() => {
    if (!isInitialized) return;

    const connectedSub = addDeviceConnectedListener(({ address }) => {
      const store = usePrinterStore.getState();
      const isPrinterTracked = store.printers.some((p) => p.id === address);
      if (!isPrinterTracked) return;

      store.setConnectionStatus(address, "connected");
      store.resetReconnectAttempts(address);
    });

    const disconnectedSub = addDeviceDisconnectedListener(({ address }) => {
      const store = usePrinterStore.getState();
      const isPrinterTracked = store.printers.some((p) => p.id === address);
      if (!isPrinterTracked) return;

      // Only trigger reconnect if the printer was previously connected
      const currentStatus = store.connectionStatus[address];
      if (currentStatus === "connected") {
        autoReconnect(address);
      }
    });

    return () => {
      connectedSub.remove();
      disconnectedSub.remove();
    };
  }, [isInitialized]);
}
