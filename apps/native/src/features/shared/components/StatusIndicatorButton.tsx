import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { OverallStatus } from "../hooks/useSystemStatus";

const STATUS_COLORS: Record<OverallStatus, string> = {
  ok: "#22C55E",
  degraded: "#F59E0B",
  critical: "#EF4444",
};

interface StatusIndicatorButtonProps {
  overallStatus: OverallStatus;
  onPress: () => void;
}

export const StatusIndicatorButton = ({ overallStatus, onPress }: StatusIndicatorButtonProps) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (overallStatus === "critical") {
      scale.value = withRepeat(
        withSequence(withTiming(1.3, { duration: 500 }), withTiming(1.0, { duration: 500 })),
        -1,
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [overallStatus, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Animated.View
        style={[
          {
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: STATUS_COLORS[overallStatus],
          },
          animatedStyle,
        ]}
      />
    </Pressable>
  );
};
