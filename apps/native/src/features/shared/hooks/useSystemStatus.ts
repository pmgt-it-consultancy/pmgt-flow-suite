import { api } from "@packages/backend/convex/_generated/api";
import NetInfo from "@react-native-community/netinfo";
import { useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "checking"
  | "reconnecting"
  | "failed"
  | "not_configured";
export type OverallStatus = "ok" | "degraded" | "critical";

export interface SystemStatus {
  server: ConnectionStatus;
  receiptPrinter: ConnectionStatus;
  kitchenPrinter: ConnectionStatus;
  kitchenPrinterLabel: string;
  lastSyncTimestamp: number | null;
  overallStatus: OverallStatus;
  retryServer: () => void;
  reconnectPrinter: (role: "receipt" | "kitchen") => Promise<boolean>;
}

export function useSystemStatus(): SystemStatus {
  const [isNetworkConnected, setIsNetworkConnected] = useState<boolean | null>(true);
  const [retryCounter, setRetryCounter] = useState(0);
  const lastSyncRef = useRef<number | null>(null);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  const prevOverallRef = useRef<OverallStatus | null>(null);

  // Device network monitoring
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsNetworkConnected(state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // Convex heartbeat — useQuery auto-subscribes and reconnects
  // retryCounter in the key forces re-mount when retry is pressed
  const pingResult = useQuery(api.ping.ping);

  // Track last successful sync
  useEffect(() => {
    if (pingResult?.status === "ok") {
      const now = Date.now();
      lastSyncRef.current = now;
      setLastSyncTimestamp(now);
    }
  }, [pingResult]);

  // Server status derivation
  const server: ConnectionStatus = useMemo(() => {
    if (isNetworkConnected === false) return "disconnected";
    if (pingResult?.status === "ok") return "connected";
    // undefined means loading or disconnected from Convex
    if (pingResult === undefined) return isNetworkConnected ? "checking" : "disconnected";
    return "checking";
  }, [isNetworkConnected, pingResult]);

  // Printer status from Zustand store
  const printers = usePrinterStore((s) => s.printers);
  const connectionStatus = usePrinterStore((s) => s.connectionStatus);
  const kitchenPrintingEnabled = usePrinterStore((s) => s.kitchenPrintingEnabled);
  const useReceiptPrinterForKitchen = usePrinterStore((s) => s.useReceiptPrinterForKitchen);

  const receiptPrinter: ConnectionStatus = useMemo(() => {
    const printer = printers.find((p) => p.role === "receipt" && p.isDefault);
    if (!printer) return "not_configured";
    const status = connectionStatus[printer.id];
    if (!status || status === "disconnected") return "disconnected";
    if (status === "reconnecting") return "reconnecting";
    if (status === "failed") return "failed";
    return "connected";
  }, [printers, connectionStatus]);

  const hasDedicatedKitchenPrinter = useMemo(
    () => printers.some((p) => p.role === "kitchen" && p.isDefault),
    [printers],
  );

  const kitchenPrinter: ConnectionStatus = useMemo(() => {
    if (!kitchenPrintingEnabled) return "not_configured";

    // Dedicated kitchen printer
    const printer = printers.find((p) => p.role === "kitchen" && p.isDefault);
    if (printer) {
      const status = connectionStatus[printer.id];
      if (!status || status === "disconnected") return "disconnected";
      if (status === "reconnecting") return "reconnecting";
      if (status === "failed") return "failed";
      return "connected";
    }

    // Fall back to receipt printer status if toggle is on
    if (useReceiptPrinterForKitchen) {
      return receiptPrinter === "not_configured" ? "not_configured" : receiptPrinter;
    }

    return "not_configured";
  }, [
    printers,
    connectionStatus,
    kitchenPrintingEnabled,
    useReceiptPrinterForKitchen,
    receiptPrinter,
  ]);

  const kitchenPrinterLabel = useMemo(() => {
    if (!kitchenPrintingEnabled) return "Kitchen Printer";
    if (hasDedicatedKitchenPrinter) return "Kitchen Printer";
    if (useReceiptPrinterForKitchen) return "Kitchen (via Receipt)";
    return "Kitchen Printer";
  }, [kitchenPrintingEnabled, hasDedicatedKitchenPrinter, useReceiptPrinterForKitchen]);

  // Overall status (not_configured is neutral, not degraded/critical)
  const overallStatus: OverallStatus = useMemo(() => {
    if (server === "disconnected") return "critical";
    const printerStatuses = [receiptPrinter, kitchenPrinter].filter((s) => s !== "not_configured");
    if (printerStatuses.includes("failed")) return "critical";
    if (printerStatuses.includes("disconnected") || printerStatuses.includes("reconnecting"))
      return "degraded";
    if (server === "checking") return "degraded";
    return "ok";
  }, [server, receiptPrinter, kitchenPrinter]);

  // Haptic alerts on status change
  useEffect(() => {
    if (prevOverallRef.current === null) {
      prevOverallRef.current = overallStatus;
      return;
    }
    if (overallStatus !== prevOverallRef.current) {
      if (overallStatus === "critical") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (overallStatus === "degraded") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      prevOverallRef.current = overallStatus;
    }
  }, [overallStatus]);

  // Recovery actions
  const retryServer = useCallback(() => {
    setRetryCounter((c) => c + 1);
  }, []);

  const reconnectPrinter = useCallback(async (role: "receipt" | "kitchen"): Promise<boolean> => {
    const store = usePrinterStore.getState();
    const printer = store.printers.find((p) => p.role === role && p.isDefault);
    if (!printer) return false;

    store.setConnectionStatus(printer.id, "reconnecting");
    store.resetReconnectAttempts(printer.id);

    const connected = await store.connectPrinter(printer.id);
    if (!connected) {
      store.setConnectionStatus(printer.id, "failed");
    }
    return connected;
  }, []);

  return {
    server,
    receiptPrinter,
    kitchenPrinter,
    kitchenPrinterLabel,
    lastSyncTimestamp,
    overallStatus,
    retryServer,
    reconnectPrinter,
  };
}
