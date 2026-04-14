import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface IdleWarningBannerProps {
  visible: boolean;
  onDismiss: () => void;
  lockTime: number;
}

export function IdleWarningBanner({ visible, onDismiss, lockTime }: IdleWarningBannerProps) {
  const [seconds, setSeconds] = useState(30);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((lockTime - Date.now()) / 1000));
      setSeconds(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1_000);
    return () => clearInterval(interval);
  }, [lockTime, visible]);

  if (!visible) {
    return null;
  }

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss}>
      <YStack
        backgroundColor="#FEF3C7"
        borderWidth={2}
        borderColor="#F59E0B"
        borderRadius={16}
        padding={24}
        alignItems="center"
        width="85%"
        style={{ elevation: 8 }}
      >
        <YStack
          width={48}
          height={48}
          borderRadius={24}
          backgroundColor="#FDE68A"
          alignItems="center"
          justifyContent="center"
          marginBottom={12}
        >
          <Ionicons name="alert-circle-outline" size={24} color="#D97706" />
        </YStack>

        <Text
          style={{
            fontSize: 18,
            fontWeight: "700",
            color: "#92400E",
            marginBottom: 4,
            textAlign: "center",
          }}
        >
          Screen will lock in {seconds}s
        </Text>

        <Text
          style={{
            fontSize: 13,
            color: "#A16207",
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          Tap anywhere to stay active
        </Text>

        <YStack
          backgroundColor="#F59E0B"
          borderRadius={10}
          paddingVertical={12}
          paddingHorizontal={32}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 15 }}>Stay Active</Text>
        </YStack>
      </YStack>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
});
