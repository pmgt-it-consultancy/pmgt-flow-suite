import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface NumericPinPadProps {
  pin: string;
  maxLength?: number;
  onPinChange: (pin: string) => void;
  disabled?: boolean;
  scale?: number;
}

type PinKey = string | "backspace" | "empty";

const KEYS: PinKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["empty", "0", "backspace"],
];

const KEY_WIDTH = 88;
const KEY_HEIGHT = 76;
const KEY_RADIUS = 18;

export function NumericPinPad({
  pin,
  maxLength = 6,
  onPinChange,
  disabled = false,
  scale = 1,
}: NumericPinPadProps) {
  const keyWidth = Math.round(KEY_WIDTH * scale);
  const keyHeight = Math.round(KEY_HEIGHT * scale);
  const keyRadius = Math.round(KEY_RADIUS * scale);
  const dotSize = Math.max(14, Math.round(20 * scale));
  const dotRadius = Math.round(dotSize / 2);
  const dotGap = Math.max(10, Math.round(16 * scale));
  const rowGap = Math.max(10, Math.round(14 * scale));
  const pinFontSize = Math.max(24, Math.round(30 * scale));
  const backspaceSize = Math.max(24, Math.round(28 * scale));

  const handlePress = (digit: string) => {
    if (disabled || pin.length >= maxLength) {
      return;
    }

    onPinChange(`${pin}${digit}`);
  };

  const handleBackspace = () => {
    if (disabled || pin.length === 0) {
      return;
    }

    onPinChange(pin.slice(0, -1));
  };

  const renderKey = (value: PinKey, key: string) => {
    if (value === "empty") {
      return <View key={key} style={{ width: keyWidth, height: keyHeight }} />;
    }

    if (value === "backspace") {
      return (
        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          key={key}
          onPress={handleBackspace}
          disabled={disabled}
          style={({ pressed }) => [
            {
              width: keyWidth,
              height: keyHeight,
              borderRadius: keyRadius,
              backgroundColor: "#FEE2E2",
              alignItems: "center",
              justifyContent: "center",
              opacity: disabled ? 0.5 : 1,
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="backspace-outline" size={backspaceSize} color="#EF4444" />
        </Pressable>
      );
    }

    return (
      <Pressable
        android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
        key={key}
        onPress={() => handlePress(value)}
        disabled={disabled}
        style={({ pressed }) => [
          {
            width: keyWidth,
            height: keyHeight,
            borderRadius: keyRadius,
            backgroundColor: "#FFFFFF",
            borderWidth: 1,
            borderColor: "#E5E7EB",
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.5 : 1,
          },
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={{ fontSize: pinFontSize, fontWeight: "500", color: "#111827" }}>{value}</Text>
      </Pressable>
    );
  };

  return (
    <YStack alignItems="center" gap={rowGap}>
      <XStack gap={dotGap} marginBottom={Math.max(18, Math.round(28 * scale))}>
        {Array.from({ length: maxLength }).map((_, index) => (
          <View
            key={`dot-${index}`}
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: dotRadius,
              backgroundColor: index < pin.length ? "#0D87E1" : "transparent",
              borderWidth: index < pin.length ? 0 : 2,
              borderColor: "#D1D5DB",
            }}
          />
        ))}
      </XStack>

      {KEYS.map((row, rowIndex) => (
        <XStack key={`row-${rowIndex}`} gap={rowGap}>
          {row.map((value, colIndex) => renderKey(value, `key-${rowIndex}-${colIndex}`))}
        </XStack>
      ))}
    </YStack>
  );
}
