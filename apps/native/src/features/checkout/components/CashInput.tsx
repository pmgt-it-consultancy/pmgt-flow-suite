import React from "react";
import { View, TextInput, TouchableOpacity } from "uniwind/components";
import { Text } from "../../shared/components/ui";

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000];

interface CashInputProps {
  value: string;
  onChange: (value: string) => void;
}

export const CashInput = ({ value, onChange }: CashInputProps) => {
  return (
    <View className="px-4 py-3">
      <Text variant="heading" className="mb-3">
        Cash Received
      </Text>

      <View className="flex-row items-center bg-white rounded-xl px-4 border border-gray-200">
        <Text className="text-gray-500 font-semibold text-2xl">₱</Text>
        <TextInput
          className="flex-1 p-4 font-semibold text-2xl text-gray-900"
          placeholder="0.00"
          placeholderTextColor="#9CA3AF"
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
        />
      </View>

      <View className="flex-row flex-wrap gap-2 mt-3">
        {QUICK_AMOUNTS.map((amount) => (
          <TouchableOpacity
            key={amount}
            className="bg-white py-2 px-4 rounded-lg border border-gray-200"
            onPress={() => onChange(amount.toString())}
            activeOpacity={0.7}
          >
            <Text className="text-gray-700 font-medium">{amount}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};
