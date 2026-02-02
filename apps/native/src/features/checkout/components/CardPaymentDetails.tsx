import { useState } from "react";
import { TextInput } from "react-native";
import { XStack, YStack } from "tamagui";
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
    <YStack
      backgroundColor="#FFFFFF"
      marginHorizontal={16}
      marginTop={12}
      padding={16}
      borderRadius={12}
    >
      <Text variant="heading" size="sm" style={{ marginBottom: 12 }}>
        Payment Details
      </Text>

      {/* Payment Type Chips */}
      <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
        Payment Type
      </Text>
      <XStack flexWrap="wrap" gap={8} marginBottom={12}>
        {PAYMENT_TYPES.map((type) => {
          const isOtherSelected =
            type === "Other" &&
            !PAYMENT_TYPES.slice(0, -1).includes(paymentType as any) &&
            paymentType !== "";
          const active = type === paymentType || isOtherSelected;
          return (
            <YStack
              key={type}
              paddingHorizontal={12}
              paddingVertical={8}
              borderRadius={9999}
              borderWidth={1}
              backgroundColor={active ? "#0D87E1" : "#FFFFFF"}
              borderColor={active ? "#0D87E1" : "#D1D5DB"}
              onTouchEnd={() => {
                if (type === "Other") {
                  onPaymentTypeChange(customPaymentType || "Other");
                } else {
                  onPaymentTypeChange(type);
                }
              }}
            >
              <Text
                size="sm"
                style={active ? { color: "#FFFFFF", fontWeight: "500" } : { color: "#374151" }}
              >
                {type}
              </Text>
            </YStack>
          );
        })}
      </XStack>

      {/* Custom Payment Type Input */}
      {selectedType === "Other" && !PAYMENT_TYPES.slice(0, -1).includes(paymentType as any) && (
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: "#D1D5DB",
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginBottom: 12,
            fontSize: 16,
          }}
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
      <Text variant="muted" size="sm" style={{ marginBottom: 8 }}>
        Reference Number
      </Text>
      <TextInput
        style={{
          borderWidth: 1,
          borderColor: "#D1D5DB",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 16,
        }}
        placeholder="Enter reference number..."
        value={referenceNumber}
        onChangeText={onReferenceNumberChange}
        autoCapitalize="characters"
      />
    </YStack>
  );
};
