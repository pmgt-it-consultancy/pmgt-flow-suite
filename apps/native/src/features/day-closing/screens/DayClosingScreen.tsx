import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";
import { OrderSelectionItem } from "../components/OrderSelectionItem";
import { PrintProgressModal } from "../components/PrintProgressModal";
import { ZReportSummary } from "../components/ZReportSummary";
import { useBatchPrint } from "../hooks/useBatchPrint";
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

const getDateRange = (date: Date): { start: number; end: number } => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
};

export const DayClosingScreen = ({ navigation }: DayClosingScreenProps) => {
  const { user } = useAuth();
  const formatCurrency = useFormatCurrency();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<Id<"orders">>>(new Set());
  const [isPrintingZReport, setIsPrintingZReport] = useState(false);

  const storeId = user?.storeId;
  const reportDate = formatDateKey(selectedDate);
  const { start, end } = useMemo(() => getDateRange(selectedDate), [selectedDate]);

  // Queries
  const report = useQuery(api.reports.getDailyReport, storeId ? { storeId, reportDate } : "skip");

  const orders = useQuery(
    api.orders.getOrderHistory,
    storeId ? { storeId, startDate: start, endDate: end } : "skip",
  );

  const store = useQuery(api.stores.get, storeId ? { storeId } : "skip");

  // Mutations
  const generateReport = useMutation(api.reports.generateDailyReport);
  const logDayClosing = useMutation(api.closing.logDayClosing);

  // Batch print
  const { isPrinting, currentIndex, totalCount, printBatch, cancelBatch } = useBatchPrint();
  const charsPerLine = usePrinterStore((s) => {
    const receipt = s.printers.find((p) => p.role === "receipt");
    return receipt?.paperWidth === 80 ? 48 : 32;
  });

  // Auto-select paid orders when orders load
  useEffect(() => {
    if (orders) {
      const paidIds = new Set(orders.filter((o) => o.status === "paid").map((o) => o._id));
      setSelectedOrderIds(paidIds);
    }
  }, [orders]);

  const paidOrders = useMemo(() => orders?.filter((o) => o.status === "paid") ?? [], [orders]);
  const allOrders = orders ?? [];
  const selectedCount = selectedOrderIds.size;

  const toggleOrder = useCallback((orderId: Id<"orders">) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedCount === paidOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(paidOrders.map((o) => o._id)));
    }
  }, [selectedCount, paidOrders]);

  // Generate report + log closing
  const handleGenerateReport = useCallback(async () => {
    if (!storeId) return;
    try {
      await generateReport({ storeId, reportDate });
      await logDayClosing({ storeId, reportDate });
    } catch (error) {
      Alert.alert("Error", "Failed to generate report.");
    }
  }, [storeId, reportDate, generateReport, logDayClosing]);

  // Print Z-Report to thermal
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
      );
      Alert.alert("Success", "Z-Report printed successfully.");
    } catch (error) {
      Alert.alert("Error", "Failed to print Z-Report. Check printer connection.");
    } finally {
      setIsPrintingZReport(false);
    }
  }, [report, storeId, store, reportDate, charsPerLine]);

  // Batch reprint selected receipts
  const handleBatchReprint = useCallback(() => {
    const orderIds = Array.from(selectedOrderIds);
    if (orderIds.length === 0) {
      Alert.alert("No Receipts", "Select at least one order to reprint.");
      return;
    }

    Alert.alert(
      "Batch Reprint",
      `Print ${orderIds.length} receipt(s)? This may take a few minutes.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Print", onPress: () => printBatch(orderIds) },
      ],
    );
  }, [selectedOrderIds, printBatch]);

  const renderOrderItem = useCallback(
    ({ item }: { item: (typeof allOrders)[0] }) => (
      <OrderSelectionItem
        order={item}
        isSelected={selectedOrderIds.has(item._id)}
        onToggle={toggleOrder}
        formatCurrency={formatCurrency}
      />
    ),
    [selectedOrderIds, toggleOrder, formatCurrency],
  );

  const keyExtractor = useCallback((item: (typeof allOrders)[0]) => item._id, []);

  const dateLabel = selectedDate.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
            <TouchableOpacity onPress={() => setShowDatePicker(true)}>
              <XStack alignItems="center" gap={4} marginTop={2}>
                <Ionicons name="calendar-outline" size={16} color="#0D87E1" />
                <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 14 }}>
                  {dateLabel}
                </Text>
              </XStack>
            </TouchableOpacity>
          </YStack>
          {/* Generate/Refresh report button */}
          <TouchableOpacity onPress={handleGenerateReport} style={styles.refreshButton}>
            <Ionicons name="refresh" size={22} color="#0D87E1" />
          </TouchableOpacity>
        </XStack>

        {showDatePicker && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            maximumDate={new Date()}
            onChange={(_, date) => {
              setShowDatePicker(false);
              if (date) setSelectedDate(date);
            }}
          />
        )}

        {/* Content */}
        <FlatList
          data={allOrders}
          keyExtractor={keyExtractor}
          renderItem={renderOrderItem}
          extraData={selectedOrderIds}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <YStack gap={16} marginBottom={16}>
              {/* Z-Report Summary */}
              <ZReportSummary
                report={report ?? null}
                isLoading={report === undefined}
                onPrintZReport={handlePrintZReport}
                isPrintingZReport={isPrintingZReport}
              />

              {/* Receipts header */}
              <XStack justifyContent="space-between" alignItems="center">
                <Text variant="heading" size="base">
                  Receipts ({allOrders.length} orders)
                </Text>
                <TouchableOpacity onPress={toggleSelectAll} style={styles.selectAllButton}>
                  <Ionicons
                    name={
                      selectedCount === paidOrders.length && paidOrders.length > 0
                        ? "checkbox"
                        : "square-outline"
                    }
                    size={20}
                    color="#0D87E1"
                  />
                  <Text
                    style={{ color: "#0D87E1", fontWeight: "600", fontSize: 14, marginLeft: 6 }}
                  >
                    {selectedCount === paidOrders.length && paidOrders.length > 0
                      ? "Deselect All"
                      : "Select All"}
                  </Text>
                </TouchableOpacity>
              </XStack>
            </YStack>
          }
          ListEmptyComponent={
            <YStack alignItems="center" justifyContent="center" paddingVertical={40}>
              <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
              <Text variant="muted" size="base" style={{ marginTop: 12 }}>
                No orders found for this date.
              </Text>
            </YStack>
          }
        />

        {/* Sticky Footer */}
        {allOrders.length > 0 && (
          <YStack
            backgroundColor="$white"
            paddingHorizontal={20}
            paddingVertical={16}
            borderTopWidth={1}
            borderColor="$gray200"
          >
            <TouchableOpacity
              onPress={handleBatchReprint}
              disabled={selectedCount === 0 || isPrinting}
              activeOpacity={0.7}
              style={[
                styles.batchPrintButton,
                (selectedCount === 0 || isPrinting) && styles.batchPrintButtonDisabled,
              ]}
            >
              <Ionicons name="print-outline" size={22} color="#FFFFFF" />
              <Text style={styles.batchPrintText}>
                Reprint {selectedCount} Selected Receipt{selectedCount !== 1 ? "s" : ""}
              </Text>
            </TouchableOpacity>
          </YStack>
        )}

        {/* Print Progress Modal */}
        <PrintProgressModal
          visible={isPrinting}
          currentIndex={currentIndex}
          totalCount={totalCount}
          onCancel={cancelBatch}
        />
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
  listContent: {
    padding: 16,
    paddingBottom: 8,
  },
  selectAllButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  batchPrintButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0D87E1",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 10,
  },
  batchPrintButtonDisabled: {
    opacity: 0.5,
  },
  batchPrintText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
