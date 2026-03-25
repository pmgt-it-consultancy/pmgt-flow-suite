import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { Alert, SafeAreaView, ScrollView, StyleSheet, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Text } from "../../shared/components/ui";
import { DateNavigationBar } from "../components/DateNavigationBar";
import { ItemBreakdownCard } from "../components/ItemBreakdownCard";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import { ZReportSummary } from "../components/ZReportSummary";
import { printZReportToThermal } from "../utils/zReportFormatter";

interface DayClosingScreenProps {
  navigation: any;
}

const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const DayClosingScreen = ({ navigation }: DayClosingScreenProps) => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isPrintingZReport, setIsPrintingZReport] = useState(false);
  const [startTime, setStartTime] = useState<string | undefined>(undefined);
  const [endTime, setEndTime] = useState<string | undefined>(undefined);

  const storeId = user?.storeId;
  const reportDate = formatDateKey(selectedDate);

  // Queries
  const report = useQuery(api.reports.getDailyReport, storeId ? { storeId, reportDate } : "skip");
  const productSales = useQuery(
    api.reports.getDailyProductSales,
    storeId ? { storeId, reportDate } : "skip",
  );
  const store = useQuery(api.stores.get, storeId ? { storeId } : "skip");

  // Mutations
  const generateReport = useMutation(api.reports.generateDailyReport);
  const logDayClosing = useMutation(api.closing.logDayClosing);

  // Printer config
  const charsPerLine = usePrinterStore((s) => {
    const receipt = s.printers.find((p) => p.role === "receipt");
    return receipt?.paperWidth === 80 ? 48 : 32;
  });

  const handleTimeRangeChange = useCallback(
    (newStart: string | undefined, newEnd: string | undefined) => {
      setStartTime(newStart);
      setEndTime(newEnd);
    },
    [],
  );

  // Generate report + log closing
  const handleGenerateReport = useCallback(async () => {
    if (!storeId) return;
    try {
      await generateReport({ storeId, reportDate, startTime, endTime });
      await logDayClosing({ storeId, reportDate });
    } catch (_error) {
      Alert.alert("Error", "Failed to generate report.");
    }
  }, [storeId, reportDate, startTime, endTime, generateReport, logDayClosing]);

  // Print Z-Report to thermal printer
  const handlePrintZReport = useCallback(async () => {
    if (!report || !storeId || !store) return;
    setIsPrintingZReport(true);
    try {
      const storeAddress = [store.address1, store.address2].filter(Boolean).join(", ");

      await printZReportToThermal(
        {
          storeName: store.name,
          storeAddress: storeAddress || undefined,
          storeTin: store.tin || undefined,
          reportDate,
          startTime,
          endTime,
          grossSales: report.grossSales,
          netSales: report.netSales,
          vatableSales: report.vatableSales,
          vatAmount: report.vatAmount,
          vatExemptSales: report.vatExemptSales,
          nonVatSales: report.nonVatSales ?? 0,
          seniorDiscounts: report.seniorDiscounts,
          pwdDiscounts: report.pwdDiscounts,
          promoDiscounts: report.promoDiscounts,
          manualDiscounts: report.manualDiscounts,
          totalDiscounts: report.totalDiscounts,
          voidCount: report.voidCount,
          voidAmount: report.voidAmount,
          cashTotal: report.cashTotal,
          cardEwalletTotal: report.cardEwalletTotal,
          transactionCount: report.transactionCount,
          averageTicket: report.averageTicket,
          generatedByName: report.generatedByName,
        },
        charsPerLine,
        productSales ?? [],
      );
      Alert.alert("Success", "Z-Report printed successfully.");
    } catch (_error) {
      Alert.alert("Error", "Failed to print Z-Report. Check printer connection.");
    } finally {
      setIsPrintingZReport(false);
    }
  }, [report, storeId, store, reportDate, charsPerLine, productSales, startTime, endTime]);

  const canPrint = !!report && !isPrintingZReport;

  return (
    <SafeAreaView style={styles.safeArea}>
      <YStack flex={1} backgroundColor="$gray100">
        {/* Header */}
        <XStack
          backgroundColor="$white"
          paddingHorizontal={16}
          paddingVertical={14}
          alignItems="center"
          borderBottomWidth={1}
          borderColor="$gray200"
        >
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#374151" />
          </TouchableOpacity>
          <YStack flex={1} alignItems="center">
            <Text variant="heading" size="lg">
              Day Closing
            </Text>
          </YStack>
          <TouchableOpacity onPress={handleGenerateReport} style={styles.refreshButton}>
            <Ionicons name="refresh" size={22} color="#0D87E1" />
          </TouchableOpacity>
        </XStack>

        {/* Date Navigation */}
        <DateNavigationBar selectedDate={selectedDate} onDateChange={setSelectedDate} />

        {/* Time Range */}
        <TimeRangeSelector
          startTime={startTime}
          endTime={endTime}
          onTimeRangeChange={handleTimeRangeChange}
        />

        {/* Scrollable Content — single ScrollView, no nested scrollables */}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <YStack gap={16}>
            <ZReportSummary report={report ?? null} isLoading={report === undefined} />
            <ItemBreakdownCard
              productSales={productSales ?? undefined}
              isLoading={productSales === undefined}
            />
          </YStack>
        </ScrollView>

        {/* Sticky Footer — Print Z-Report */}
        <YStack
          backgroundColor="$white"
          paddingHorizontal={20}
          paddingVertical={16}
          borderTopWidth={1}
          borderColor="$gray200"
        >
          <TouchableOpacity
            onPress={handlePrintZReport}
            disabled={!canPrint}
            activeOpacity={0.7}
            style={[styles.printButton, !canPrint && styles.printButtonDisabled]}
          >
            <Ionicons name="print-outline" size={22} color="#FFFFFF" />
            <Text style={styles.printButtonText}>
              {isPrintingZReport ? "Printing..." : "Print Z-Report"}
            </Text>
          </TouchableOpacity>
        </YStack>
      </YStack>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 8,
  },
  printButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0D87E1",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 10,
  },
  printButtonDisabled: {
    opacity: 0.5,
  },
  printButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
