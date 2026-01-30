import { Modal, Pressable } from "react-native";
import { View } from "uniwind/components";
import type { ConnectionStatus, SystemStatus } from "../hooks/useSystemStatus";
import { Button, Text } from "./ui";

interface StatusDropdownProps {
  visible: boolean;
  onClose: () => void;
  status: SystemStatus;
}

const STATUS_DOT_COLORS: Record<ConnectionStatus, string> = {
  connected: "#22C55E",
  disconnected: "#EF4444",
  checking: "#F59E0B",
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Offline",
  checking: "Checking...",
};

function formatLastSync(timestamp: number | null): { text: string; isWarning: boolean } {
  if (timestamp === null) return { text: "Never", isWarning: true };
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return { text: "just now", isWarning: false };
  if (seconds < 60) return { text: `${seconds}s ago`, isWarning: false };
  if (seconds < 300) return { text: `${Math.floor(seconds / 60)}m ago`, isWarning: false };
  return { text: "5+ min ago", isWarning: true };
}

interface StatusRowProps {
  label: string;
  connectionStatus: ConnectionStatus;
  onRetry?: () => void;
  retryLabel?: string;
}

const StatusRow = ({ label, connectionStatus, onRetry, retryLabel = "Retry" }: StatusRowProps) => (
  <View className="py-2">
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-2 flex-1">
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: STATUS_DOT_COLORS[connectionStatus],
          }}
        />
        <Text size="sm" className="text-gray-700">
          {label}
        </Text>
      </View>
      <Text
        size="xs"
        style={{ color: STATUS_DOT_COLORS[connectionStatus] }}
        className="font-medium"
      >
        {STATUS_LABELS[connectionStatus]}
      </Text>
    </View>
    {connectionStatus === "disconnected" && onRetry && (
      <View className="ml-4 mt-1">
        <Button size="sm" variant="outline" onPress={onRetry}>
          <Text size="xs" className="text-blue-600">
            {retryLabel}
          </Text>
        </Button>
      </View>
    )}
  </View>
);

export const StatusDropdown = ({ visible, onClose, status }: StatusDropdownProps) => {
  const lastSync = formatLastSync(status.lastSyncTimestamp);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <View
          style={{
            position: "absolute",
            top: 8,
            right: 16,
            minWidth: 260,
            backgroundColor: "white",
            borderRadius: 12,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 12,
            elevation: 8,
          }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View className="p-4">
              <Text variant="heading" size="sm" className="mb-2">
                System Status
              </Text>

              <View className="border-t border-gray-100">
                <StatusRow
                  label="Server"
                  connectionStatus={status.server}
                  onRetry={status.retryServer}
                  retryLabel="Retry"
                />
                <StatusRow
                  label="Receipt Printer"
                  connectionStatus={status.receiptPrinter}
                  onRetry={() => status.reconnectPrinter("receipt")}
                  retryLabel="Reconnect"
                />
                <StatusRow
                  label="Kitchen Printer"
                  connectionStatus={status.kitchenPrinter}
                  onRetry={() => status.reconnectPrinter("kitchen")}
                  retryLabel="Reconnect"
                />
              </View>

              <View className="border-t border-gray-100 pt-2 mt-1">
                <Text size="xs" className={lastSync.isWarning ? "text-red-500" : "text-gray-400"}>
                  Last sync: {lastSync.text}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};
