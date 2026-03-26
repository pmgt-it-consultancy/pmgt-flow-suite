import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface PaymentTransaction {
  orderId: string;
  orderNumber: string;
  referenceNumber: string;
  amount: number;
  paidAt: number;
}

interface PaymentTypeGroup {
  paymentType: string;
  transactions: PaymentTransaction[];
  subtotal: number;
}

interface PaymentTransactionsCardProps {
  paymentGroups: PaymentTypeGroup[] | undefined;
  isLoading: boolean;
}

export const PaymentTransactionsCard = ({
  paymentGroups,
  isLoading,
}: PaymentTransactionsCardProps) => {
  const formatCurrency = useFormatCurrency();

  if (isLoading || !paymentGroups || paymentGroups.length === 0) {
    return null;
  }

  const totalTransactionCount = paymentGroups.reduce(
    (sum, group) => sum + group.transactions.length,
    0,
  );
  const grandTotal = paymentGroups.reduce((sum, group) => sum + group.subtotal, 0);

  return (
    <YStack gap={8}>
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="heading" size="base">
          Payment Transactions
        </Text>
        <Text variant="muted" size="sm">
          {totalTransactionCount} transaction(s)
        </Text>
      </XStack>

      <YStack
        backgroundColor="$white"
        borderRadius={12}
        borderWidth={1}
        borderColor="$gray200"
        overflow="hidden"
      >
        {/* Table header */}
        <XStack
          paddingVertical={10}
          paddingHorizontal={14}
          backgroundColor="#F9FAFB"
          borderBottomWidth={1}
          borderColor="$gray200"
        >
          <Text variant="muted" size="sm" style={{ flex: 1 }}>
            Order / Ref #
          </Text>
          <Text variant="muted" size="sm" style={{ width: 90, textAlign: "right" }}>
            Amount
          </Text>
        </XStack>

        {/* Payment type groups */}
        {paymentGroups.map((group) => (
          <YStack key={group.paymentType}>
            {/* Group header */}
            <XStack
              paddingVertical={8}
              paddingHorizontal={14}
              backgroundColor="#F0FDF4"
              borderBottomWidth={1}
              borderColor="#DCFCE7"
              alignItems="center"
            >
              <Text size="sm" style={{ flex: 1, fontWeight: "700", color: "#166534" }}>
                {group.paymentType}
              </Text>
              <Text size="xs" style={{ color: "#166534" }}>
                {group.transactions.length} transaction(s)
              </Text>
            </XStack>

            {/* Transaction rows */}
            {group.transactions.map((tx) => (
              <XStack
                key={tx.orderId}
                paddingVertical={10}
                paddingHorizontal={14}
                borderBottomWidth={1}
                borderColor="#F3F4F6"
                alignItems="center"
              >
                <YStack style={{ flex: 1 }}>
                  <Text size="sm" style={{ fontWeight: "600" }}>
                    #{tx.orderNumber}
                  </Text>
                  <Text variant="muted" size="xs">
                    {tx.referenceNumber}
                  </Text>
                </YStack>
                <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "600" }}>
                  {formatCurrency(tx.amount)}
                </Text>
              </XStack>
            ))}

            {/* Group subtotal row */}
            <XStack
              paddingVertical={10}
              paddingHorizontal={14}
              backgroundColor="#F0FDF4"
              borderBottomWidth={1}
              borderColor="#DCFCE7"
            >
              <Text size="sm" style={{ flex: 1, fontWeight: "700", color: "#166534" }}>
                Subtotal
              </Text>
              <Text
                size="sm"
                style={{ width: 90, textAlign: "right", fontWeight: "700", color: "#166534" }}
              >
                {formatCurrency(group.subtotal)}
              </Text>
            </XStack>
          </YStack>
        ))}

        {/* Grand total row */}
        <XStack
          paddingVertical={12}
          paddingHorizontal={14}
          backgroundColor="#F9FAFB"
          borderTopWidth={1}
          borderColor="$gray200"
        >
          <Text size="sm" style={{ flex: 1, fontWeight: "700" }}>
            Total
          </Text>
          <Text size="sm" style={{ width: 90, textAlign: "right", fontWeight: "700" }}>
            {formatCurrency(grandTotal)}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
};
