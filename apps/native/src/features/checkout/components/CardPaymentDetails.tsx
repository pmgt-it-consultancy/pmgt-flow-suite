import { TextInput, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";

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
    <YStack paddingHorizontal={16} paddingVertical={12}>
      <Text variant="heading" style={{ marginBottom: 12 }}>
        Payment Details
      </Text>

      <Card variant="outlined">
        <Text variant="muted" size="xs" style={{ marginBottom: 12 }}>
          Capture the payment channel and reference before completing checkout
        </Text>

        <Text variant="muted" size="sm" style={{ marginBottom: 10 }}>
          Payment Type
        </Text>
        <XStack flexWrap="wrap" gap={10} marginBottom={14}>
          {PAYMENT_TYPES.map((type) => {
            const isOtherSelected =
              type === "Other" &&
              !PAYMENT_TYPES.slice(0, -1).includes(paymentType as any) &&
              paymentType !== "";
            const active = type === paymentType || isOtherSelected;
            return (
              <TouchableOpacity
                key={type}
                onPress={() => {
                  if (type === "Other") {
                    onPaymentTypeChange(customPaymentType || "Other");
                  } else {
                    onPaymentTypeChange(type);
                  }
                }}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderRadius: 9999,
                  borderWidth: 1.5,
                  backgroundColor: active ? "#EFF6FF" : "#FFFFFF",
                  borderColor: active ? "#0D87E1" : "#D1D5DB",
                  minHeight: 48,
                  justifyContent: "center",
                }}
              >
                <Text
                  size="sm"
                  style={{
                    color: active ? "#0D87E1" : "#374151",
                    fontWeight: "600",
                  }}
                >
                  {type}
                </Text>
              </TouchableOpacity>
            );
          })}
        </XStack>

        {selectedType === "Other" && !PAYMENT_TYPES.slice(0, -1).includes(paymentType as any) && (
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: "#D1D5DB",
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              marginBottom: 14,
              fontSize: 16,
              minHeight: 48,
              backgroundColor: "#F9FAFB",
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

        <Text variant="muted" size="sm" style={{ marginBottom: 10 }}>
          Reference Number
        </Text>
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: "#D1D5DB",
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 16,
            minHeight: 48,
            backgroundColor: "#F9FAFB",
          }}
          placeholder="Enter reference number..."
          value={referenceNumber}
          onChangeText={onReferenceNumberChange}
          autoCapitalize="characters"
        />
      </Card>
    </YStack>
  );
};
