import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { PageHeader } from "../../shared/components/PageHeader";
import { Button, Text } from "../../shared/components/ui";
import { DateNavigationBar } from "../components/DateNavigationBar";
import { ItemBreakdownCard } from "../components/ItemBreakdownCard";
import { PaymentTransactionsCard } from "../components/PaymentTransactionsCard";
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

const parseBusinessDate = (businessDate: string): Date => {
  const [y, m, d] = businessDate.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

const weekdayKeyFromDate = (date: Date): WeekdayKey => WEEKDAY_KEYS[date.getDay()];

export const DayClosingScreen = ({ navigation }: DayClosingScreenProps) => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isPrintingZReport, setIsPrintingZReport] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [startTime, setStartTime] = useState<string | undefined>(undefined);
  const [endTime, setEndTime] = useState<string | undefined>(undefined);

  const storeId = user?.storeId;

  // The business day may lag the device's midnight when the store closes after
  // midnight (e.g. close=03:00). Subscribe to the schedule-aware date and use
  // it both to initialize selectedDate and to drive the navigation bar's
  // "today" lock so users can't jump past the current business day.
  const todayBusinessDate = useQuery(
    api.reports.getCurrentBusinessDate,
    storeId ? { storeId } : "skip",
  );

  useEffect(() => {
    if (todayBusinessDate && !selectedDate) {
      setSelectedDate(parseBusinessDate(todayBusinessDate));
    }
  }, [todayBusinessDate, selectedDate]);

  const reportDate = selectedDate ? formatDateKey(selectedDate) : null;

  // Queries — all skip until we have both storeId and a resolved business date
  const report = useQuery(
    api.reports.getDailyReport,
    storeId && reportDate ? { storeId, reportDate } : "skip",
  );
  const productSales = useQuery(
    api.reports.getDailyProductSales,
    storeId && reportDate ? { storeId, reportDate } : "skip",
  );
  const store = useQuery(api.stores.get, storeId ? { storeId } : "skip");
  const paymentTransactions = useQuery(
    api.reports.getDailyPaymentTransactions,
    storeId && reportDate ? { storeId, reportDate } : "skip",
  );

  const scheduleSlot =
    selectedDate && store?.schedule ? store.schedule[weekdayKeyFromDate(selectedDate)] : undefined;

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
    if (!storeId || !reportDate) return;
    setIsGenerating(true);
    try {
      await generateReport({ storeId, reportDate, startTime, endTime });
      await logDayClosing({ storeId, reportDate });
    } catch (_error) {
      Alert.alert("Error", "Failed to generate report.");
    } finally {
      setIsGenerating(false);
    }
  }, [storeId, reportDate, startTime, endTime, generateReport, logDayClosing]);

  // Print Z-Report to thermal printer
  const handlePrintZReport = useCallback(async () => {
    if (!report || !storeId || !store || !reportDate) return;
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
        paymentTransactions ?? [],
      );
      Alert.alert("Success", "Z-Report printed successfully.");
    } catch (_error) {
      Alert.alert("Error", "Failed to print Z-Report. Check printer connection.");
    } finally {
      setIsPrintingZReport(false);
    }
  }, [
    report,
    storeId,
    store,
    reportDate,
    charsPerLine,
    productSales,
    paymentTransactions,
    startTime,
    endTime,
  ]);

  const canPrint = !!report && !isPrintingZReport;

  return (
    <SafeAreaView style={styles.safeArea}>
      <YStack flex={1} backgroundColor="$gray100">
        <PageHeader
          title="Day Closing"
          onBack={() => navigation.goBack()}
          centerTitle
          rightContent={
            isGenerating ? (
              <ActivityIndicator size="small" color="#0D87E1" />
            ) : (
              <Button variant="outline" size="sm" onPress={handleGenerateReport}>
                Refresh Report
              </Button>
            )
          }
        />

        {/* Date Navigation — hidden until we have the business date so the
            "today" lock can be computed correctly. */}
        {selectedDate && todayBusinessDate && (
          <DateNavigationBar
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            todayBusinessDate={todayBusinessDate}
          />
        )}

        {/* Time Range */}
        <TimeRangeSelector
          startTime={startTime}
          endTime={endTime}
          onTimeRangeChange={handleTimeRangeChange}
          scheduleSlot={scheduleSlot}
        />

        {/* Scrollable Content — single ScrollView, no nested scrollables */}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <YStack gap={16}>
            <ZReportSummary report={report ?? null} isLoading={report === undefined} />
            <ItemBreakdownCard
              productSales={productSales ?? undefined}
              isLoading={productSales === undefined}
            />
            <PaymentTransactionsCard
              paymentGroups={paymentTransactions ?? undefined}
              isLoading={paymentTransactions === undefined}
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
          <Pressable
            android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
            onPress={handlePrintZReport}
            disabled={!canPrint}
            style={[styles.printButton, !canPrint && styles.printButtonDisabled]}
          >
            <Ionicons name="print-outline" size={22} color="#FFFFFF" />
            <Text style={styles.printButtonText}>
              {isPrintingZReport ? "Printing..." : "Print Z-Report"}
            </Text>
          </Pressable>
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
