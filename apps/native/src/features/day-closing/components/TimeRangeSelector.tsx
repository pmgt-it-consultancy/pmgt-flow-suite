import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface TimeRangeSelectorProps {
  startTime: string | undefined; // "HH:mm" or undefined for full day
  endTime: string | undefined;
  onTimeRangeChange: (startTime: string | undefined, endTime: string | undefined) => void;
  scheduleSlot?: { open: string; close: string };
}

type Mode = "full" | "custom";

const formatTimeLabel = (time: string): string => {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
};

const timeToDate = (time: string): Date => {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

const dateToTime = (date: Date): string => {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
};

export const TimeRangeSelector = ({
  startTime,
  endTime,
  onTimeRangeChange,
  scheduleSlot,
}: TimeRangeSelectorProps) => {
  const mode: Mode = startTime || endTime ? "custom" : "full";
  const crossesMidnight = !!startTime && !!endTime && endTime <= startTime;
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const handleModeChange = (newMode: Mode) => {
    if (newMode === "full") {
      onTimeRangeChange(undefined, undefined);
    } else {
      const defaultStart = scheduleSlot?.open ?? "06:00";
      const defaultEnd = scheduleSlot?.close ?? "22:00";
      onTimeRangeChange(defaultStart, defaultEnd);
    }
  };

  return (
    <YStack gap={10} paddingHorizontal={16} paddingVertical={12}>
      {/* Preset buttons */}
      <XStack gap={8}>
        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          onPress={() => handleModeChange("full")}
          style={({ pressed }) => [
            {
              flex: 1,
              height: 48,
              borderRadius: 10,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: mode === "full" ? "#DBEAFE" : "#F3F4F6",
              borderWidth: 1,
              borderColor: mode === "full" ? "#0D87E1" : "#E5E7EB",
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text
            style={{
              fontWeight: "600",
              fontSize: 14,
              color: mode === "full" ? "#0D87E1" : "#374151",
            }}
          >
            Full Day
          </Text>
        </Pressable>

        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          onPress={() => handleModeChange("custom")}
          style={({ pressed }) => [
            {
              flex: 1,
              height: 48,
              borderRadius: 10,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: mode === "custom" ? "#DBEAFE" : "#F3F4F6",
              borderWidth: 1,
              borderColor: mode === "custom" ? "#0D87E1" : "#E5E7EB",
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text
            style={{
              fontWeight: "600",
              fontSize: 14,
              color: mode === "custom" ? "#0D87E1" : "#374151",
            }}
          >
            Custom Range
          </Text>
        </Pressable>
      </XStack>

      {/* Time pickers (only when custom) */}
      {mode === "custom" && (
        <XStack gap={10}>
          <Pressable
            android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
            onPress={() => setShowStartPicker(true)}
            style={({ pressed }) => [
              {
                flex: 1,
                height: 48,
                borderRadius: 10,
                backgroundColor: "#F9FAFB",
                borderWidth: 1,
                borderColor: "#E5E7EB",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              },
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="time-outline" size={16} color="#6B7280" />
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#374151" }}>
              {startTime ? formatTimeLabel(startTime) : "Start"}
            </Text>
          </Pressable>

          <YStack justifyContent="center">
            <Text variant="muted" size="sm">
              to
            </Text>
          </YStack>

          <YStack flex={1} gap={2}>
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={() => setShowEndPicker(true)}
              style={({ pressed }) => [
                {
                  height: 48,
                  borderRadius: 10,
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                },
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="time-outline" size={16} color="#6B7280" />
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#374151" }}>
                {endTime ? formatTimeLabel(endTime) : "End"}
              </Text>
            </Pressable>
            {crossesMidnight && (
              <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                (next day)
              </Text>
            )}
          </YStack>
        </XStack>
      )}

      {showStartPicker && (
        <DateTimePicker
          value={startTime ? timeToDate(startTime) : timeToDate("06:00")}
          mode="time"
          is24Hour={false}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_, date) => {
            setShowStartPicker(false);
            if (date) onTimeRangeChange(dateToTime(date), endTime);
          }}
        />
      )}

      {showEndPicker && (
        <DateTimePicker
          value={endTime ? timeToDate(endTime) : timeToDate("22:00")}
          mode="time"
          is24Hour={false}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_, date) => {
            setShowEndPicker(false);
            if (date) onTimeRangeChange(startTime, dateToTime(date));
          }}
        />
      )}
    </YStack>
  );
};
