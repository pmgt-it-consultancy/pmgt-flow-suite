import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, TouchableOpacity } from "react-native";
import { XStack } from "tamagui";
import { Text } from "../../shared/components/ui";

interface DateNavigationBarProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

const isToday = (date: Date): boolean => {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
};

const formatDateLabel = (date: Date): string =>
  date.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const DateNavigationBar = ({ selectedDate, onDateChange }: DateNavigationBarProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const today = isToday(selectedDate);

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
        <TouchableOpacity
          onPress={goToPreviousDay}
          style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center" }}
          activeOpacity={0.6}
        >
          <Ionicons name="chevron-back" size={24} color="#0D87E1" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowPicker(true)} activeOpacity={0.6}>
          <XStack alignItems="center" gap={6}>
            <Ionicons name="calendar-outline" size={18} color="#0D87E1" />
            <Text style={{ color: "#0D87E1", fontWeight: "700", fontSize: 16 }}>
              {formatDateLabel(selectedDate)}
            </Text>
          </XStack>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={goToNextDay}
          disabled={today}
          style={{
            width: 48,
            height: 48,
            justifyContent: "center",
            alignItems: "center",
            opacity: today ? 0.3 : 1,
          }}
          activeOpacity={0.6}
        >
          <Ionicons name="chevron-forward" size={24} color="#0D87E1" />
        </TouchableOpacity>
      </XStack>

      {showPicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={new Date()}
          onChange={(_, date) => {
            setShowPicker(false);
            if (date) onDateChange(date);
          }}
        />
      )}
    </>
  );
};
