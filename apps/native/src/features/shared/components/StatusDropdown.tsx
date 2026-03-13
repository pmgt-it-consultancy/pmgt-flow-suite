import { Alert, Modal, Pressable, View } from "react-native";
import { XStack, YStack } from "tamagui";
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
  reconnecting: "#F59E0B",
  failed: "#EF4444",
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Offline",
  checking: "Checking...",
  reconnecting: "Reconnecting...",
  failed: "Connection Failed",
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

const StatusRow = ({ label, connectionStatus, onRetry, retryLabel = "Retry" }: StatusRowProps) => {
  const showRetryButton =
    (connectionStatus === "disconnected" || connectionStatus === "failed") && onRetry;
  const isReconnecting = connectionStatus === "reconnecting";

  return (
    <YStack paddingVertical={8}>
      <XStack alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap={8} flex={1}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: STATUS_DOT_COLORS[connectionStatus],
            }}
          />
          <Text size="sm" style={{ color: "#374151" }}>
            {label}
          </Text>
        </XStack>
        <Text size="xs" style={{ color: STATUS_DOT_COLORS[connectionStatus], fontWeight: "500" }}>
          {STATUS_LABELS[connectionStatus]}
        </Text>
      </XStack>
      {isReconnecting && (
        <YStack marginLeft={16} marginTop={4}>
          <Button size="sm" variant="outline" disabled>
            <Text size="xs" style={{ color: "#9CA3AF" }}>
              Reconnecting...
            </Text>
          </Button>
        </YStack>
      )}
      {showRetryButton && (
        <YStack marginLeft={16} marginTop={4}>
          <Button size="sm" variant="outline" onPress={onRetry}>
            <Text size="xs" style={{ color: "#0B6FBA" }}>
              {retryLabel}
            </Text>
          </Button>
        </YStack>
      )}
    </YStack>
  );
};

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
            <YStack padding={16}>
              <Text variant="heading" size="sm" style={{ marginBottom: 8 }}>
                System Status
              </Text>

              <YStack borderTopWidth={1} borderColor="#F3F4F6">
                <StatusRow
                  label="Server"
                  connectionStatus={status.server}
                  onRetry={status.retryServer}
                  retryLabel="Retry"
                />
                <StatusRow
                  label="Receipt Printer"
                  connectionStatus={status.receiptPrinter}
                  onRetry={async () => {
                    const success = await status.reconnectPrinter("receipt");
                    if (!success) {
                      Alert.alert(
                        "Reconnect Failed",
                        "Could not connect to the receipt printer. Make sure the printer is turned on and in range.",
                        [
                          { text: "Retry", onPress: () => status.reconnectPrinter("receipt") },
                          { text: "Dismiss", style: "cancel" },
                        ],
                      );
                    }
                  }}
                  retryLabel="Reconnect"
                />
                <StatusRow
                  label="Kitchen Printer"
                  connectionStatus={status.kitchenPrinter}
                  onRetry={async () => {
                    const success = await status.reconnectPrinter("kitchen");
                    if (!success) {
                      Alert.alert(
                        "Reconnect Failed",
                        "Could not connect to the kitchen printer. Make sure the printer is turned on and in range.",
                        [
                          { text: "Retry", onPress: () => status.reconnectPrinter("kitchen") },
                          { text: "Dismiss", style: "cancel" },
                        ],
                      );
                    }
                  }}
                  retryLabel="Reconnect"
                />
              </YStack>

              <YStack borderTopWidth={1} borderColor="#F3F4F6" paddingTop={8} marginTop={4}>
                <Text size="xs" style={{ color: lastSync.isWarning ? "#EF4444" : "#9CA3AF" }}>
                  Last sync: {lastSync.text}
                </Text>
              </YStack>
            </YStack>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};
