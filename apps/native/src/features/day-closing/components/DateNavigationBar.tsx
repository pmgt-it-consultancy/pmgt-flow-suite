import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface DateNavigationBarProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  /**
   * Current business day as "YYYY-MM-DD" — schedule-aware from the backend.
   * Used to lock the "next day" button and the date-picker's maximum date so
   * users don't jump past the business day even if the device clock is already
   * showing tomorrow (e.g. 00:30 when the store closes at 03:00).
   */
  todayBusinessDate: string;
}

const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseBusinessDate = (businessDate: string): Date => {
  const [y, m, d] = businessDate.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const formatDateLabel = (date: Date): string =>
  date.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const DateNavigationBar = ({
  selectedDate,
  onDateChange,
  todayBusinessDate,
}: DateNavigationBarProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const today = formatDateKey(selectedDate) === todayBusinessDate;
  const maxPickerDate = parseBusinessDate(todayBusinessDate);

  const goToPreviousDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    onDateChange(prev);
  };

  const goToNextDay = () => {
    if (today) return;
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    onDateChange(next);
  };

  return (
    <>
      <XStack
        backgroundColor="#EFF6FF"
        paddingVertical={12}
        paddingHorizontal={16}
        alignItems="center"
        justifyContent="space-between"
      >
        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          onPress={goToPreviousDay}
          style={({ pressed }) => [
            { width: 48, height: 48, justifyContent: "center", alignItems: "center" },
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color="#0D87E1" />
        </Pressable>

        <Pressable onPress={() => setShowPicker(true)}>
          <XStack alignItems="center" gap={6}>
            <Ionicons name="calendar-outline" size={18} color="#0D87E1" />
            <Text style={{ color: "#0D87E1", fontWeight: "700", fontSize: 16 }}>
              {formatDateLabel(selectedDate)}
            </Text>
          </XStack>
        </Pressable>

        <Pressable
          android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          onPress={goToNextDay}
          disabled={today}
          style={({ pressed }) => [
            {
              width: 48,
              height: 48,
              justifyContent: "center",
              alignItems: "center",
              opacity: today ? 0.3 : 1,
            },
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-forward" size={24} color="#0D87E1" />
        </Pressable>
      </XStack>

      {showPicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={maxPickerDate}
          onChange={(_, date) => {
            setShowPicker(false);
            if (date) onDateChange(date);
          }}
        />
      )}
    </>
  );
};
