import { XStack, YStack } from "tamagui";
import { Card, Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface ZReportData {
  grossSales: number;
  netSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  totalDiscounts: number;
  voidCount: number;
  voidAmount: number;
  cashTotal: number;
  cardEwalletTotal: number;
  transactionCount: number;
  averageTicket: number;
}

interface ZReportSummaryProps {
  report: ZReportData | null;
  isLoading: boolean;
}

const StatBox = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <YStack
    flex={1}
    backgroundColor="#F9FAFB"
    borderRadius={10}
    paddingVertical={12}
    paddingHorizontal={8}
    alignItems="center"
  >
    <Text style={{ fontSize: 22, fontWeight: "700", color }}>{value}</Text>
    <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>
      {label}
    </Text>
  </YStack>
);

export const ZReportSummary = ({ report, isLoading }: ZReportSummaryProps) => {
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">Loading report...</Text>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <Text variant="muted">No report data for this date. Tap refresh to generate.</Text>
      </Card>
    );
  }

  return (
    <YStack gap={12}>
      {/* Top stats row */}
      <XStack gap={8}>
        <StatBox label="Gross Sales" value={formatCurrency(report.grossSales)} color="#111827" />
        <StatBox label="Net Sales" value={formatCurrency(report.netSales)} color="#16A34A" />
        <StatBox label="Transactions" value={String(report.transactionCount)} color="#0D87E1" />
      </XStack>

      {/* Detail rows */}
      <YStack
        backgroundColor="$white"
        borderRadius={12}
        padding={16}
        borderWidth={1}
        borderColor="$gray200"
        gap={8}
      >
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">
            Cash
          </Text>
          <Text size="sm" style={{ fontWeight: "600" }}>
            {formatCurrency(report.cashTotal)}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">
            Card/E-Wallet
          </Text>
          <Text size="sm" style={{ fontWeight: "600" }}>
            {formatCurrency(report.cardEwalletTotal)}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">
            Discounts
          </Text>
          <Text size="sm" style={{ fontWeight: "600", color: "#DC2626" }}>
            -{formatCurrency(report.totalDiscounts)}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">
            Voids ({report.voidCount})
          </Text>
          <Text size="sm" style={{ fontWeight: "600", color: "#DC2626" }}>
            -{formatCurrency(report.voidAmount)}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">
            VAT (12%)
          </Text>
          <Text size="sm" style={{ fontWeight: "600" }}>
            {formatCurrency(report.vatAmount)}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text variant="muted" size="sm">
            Avg. Ticket
          </Text>
          <Text size="sm" style={{ fontWeight: "600" }}>
            {formatCurrency(report.averageTicket)}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
};
