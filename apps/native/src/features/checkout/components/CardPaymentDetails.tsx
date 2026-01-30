import { useState } from "react";
import { TextInput, View } from "uniwind/components";
import { Text } from "../../shared/components/ui";

const PAYMENT_TYPES = ["Credit/Debit Card", "GCash", "Maya", "Bank Transfer", "Other"] as const;

interface CardPaymentDetailsProps {
  paymentType: string;
  referenceNumber: string;
  customPaymentType: string;
  onPaymentTypeChange: (type: string) => void;
  onReferenceNumberChange: (ref: string) => void;
  onCustomPaymentTypeChange: (type: string) => void;
}

export const CardPaymentDetails = ({
  paymentType,
  referenceNumber,
  customPaymentType,
  onPaymentTypeChange,
  onReferenceNumberChange,
  onCustomPaymentTypeChange,
}: CardPaymentDetailsProps) => {
  const selectedType = PAYMENT_TYPES.includes(paymentType as any) ? paymentType : "Other";

  return (
    <View className="bg-white mx-4 mt-3 p-4 rounded-xl">
      <Text variant="heading" size="sm" className="mb-3">
        Payment Details
      </Text>

      {/* Payment Type Chips */}
      <Text variant="muted" size="sm" className="mb-2">
        Payment Type
      </Text>
      <View className="flex-row flex-wrap gap-2 mb-3">
        {PAYMENT_TYPES.map((type) => {
          const isSelected =
            paymentType === type ||
            (type === "Other" && selectedType === "Other" && paymentType !== "");
          const isOtherSelected =
            type === "Other" &&
            !PAYMENT_TYPES.slice(0, -1).includes(paymentType as any) &&
            paymentType !== "";
          const active = type === paymentType || isOtherSelected;
          return (
            <View
              key={type}
              className={`px-3 py-2 rounded-full border ${
                active ? "bg-blue-500 border-blue-500" : "bg-white border-gray-300"
              }`}
              onTouchEnd={() => {
                if (type === "Other") {
                  onPaymentTypeChange(customPaymentType || "Other");
                } else {
                  onPaymentTypeChange(type);
                }
              }}
            >
              <Text size="sm" className={active ? "text-white font-medium" : "text-gray-700"}>
                {type}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Custom Payment Type Input */}
      {selectedType === "Other" && !PAYMENT_TYPES.slice(0, -1).includes(paymentType as any) && (
        <TextInput
          className="border border-gray-300 rounded-lg px-3 py-2 mb-3 text-base"
          placeholder="Enter payment type..."
          value={customPaymentType}
          onChangeText={(text: string) => {
            onCustomPaymentTypeChange(text);
            onPaymentTypeChange(text || "Other");
          }}
          autoCapitalize="words"
        />
      )}

      {/* Reference Number */}
      <Text variant="muted" size="sm" className="mb-2">
        Reference Number
      </Text>
      <TextInput
        className="border border-gray-300 rounded-lg px-3 py-2 text-base"
        placeholder="Enter reference number..."
        value={referenceNumber}
        onChangeText={onReferenceNumberChange}
        autoCapitalize="characters"
      />
    </View>
  );
};
