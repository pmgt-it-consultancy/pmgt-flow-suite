import { useEffect, useRef, useState } from "react";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { YStack } from "tamagui";
import type { ConnectionStatus } from "../hooks/useSystemStatus";
import { useSystemStatus } from "../hooks/useSystemStatus";
import { StatusDropdown } from "./StatusDropdown";
import { StatusIndicatorButton } from "./StatusIndicatorButton";
import { Text } from "./ui";

const StatusToast = ({ serverStatus }: { serverStatus: ConnectionStatus }) => {
  const prevServerRef = useRef<ConnectionStatus>(serverStatus);
  const [toast, setToast] = useState<{ message: string; color: string } | null>(null);

  useEffect(() => {
    const prev = prevServerRef.current;
    prevServerRef.current = serverStatus;

    if (prev === serverStatus) return;

    if (serverStatus === "disconnected" && prev !== "disconnected") {
      setToast({ message: "Server connection lost", color: "#EF4444" });
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }

    if (serverStatus === "connected" && prev === "disconnected") {
      setToast({ message: "Server reconnected", color: "#22C55E" });
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [serverStatus]);

  if (!toast) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: toast.color,
        paddingVertical: 8,
        paddingHorizontal: 16,
        alignItems: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "700" }} size="sm">
        {toast.message}
      </Text>
    </Animated.View>
  );
};

export const SystemStatusBar = () => {
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const status = useSystemStatus();

  return (
    <>
      <StatusIndicatorButton
        overallStatus={status.overallStatus}
        onPress={() => setDropdownVisible(true)}
      />
      <StatusDropdown
        visible={dropdownVisible}
        onClose={() => setDropdownVisible(false)}
        status={status}
      />
      <StatusToast serverStatus={status.server} />
    </>
  );
};
