import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, ScrollView, View } from "uniwind/components";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Button, Modal, Text } from "../../shared/components/ui";
import type { ReceiptData } from "../../shared/utils/receipt";

interface ReceiptPreviewModalProps {
  visible: boolean;
  receiptData: ReceiptData | null;
  onPrint: () => Promise<void>;
  onSkip: () => void;
}

const formatCurrency = (amount: number): string => {
  const formatted = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `P ${formatted}`;
};

const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
};

const orderTypeLabel = (type: ReceiptData["orderType"]): string => {
  switch (type) {
    case "dine_in":
      return "Dine-In";
    case "take_out":
      return "Take-Out";
    case "delivery":
      return "Delivery";
  }
};

const DashedSeparator = () => (
  <Text size="xs" variant="muted" className="text-center my-2">
    - - - - - - - - - - - - - - - - - - - -
  </Text>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <View className="flex-row justify-between mb-1">
    <Text size="xs" variant="muted">
      {label}
    </Text>
    <Text size="xs">{value}</Text>
  </View>
);

// Paper width to preview width mapping (approximate px per mm)
const PAPER_WIDTH_PX: Record<number, number> = {
  58: 220,
  80: 300,
};

export const ReceiptPreviewModal = ({
  visible,
  receiptData,
  onPrint,
  onSkip,
}: ReceiptPreviewModalProps) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<"success" | "error" | null>(null);
  const { printers, connectionStatus } = usePrinterStore();

  const receiptPrinter = printers.find((p) => p.role === "receipt" && p.isDefault);
  const isConnected = receiptPrinter ? connectionStatus[receiptPrinter.id] === true : false;
  const canPrint = !!receiptPrinter && isConnected;
  const paperWidth = receiptPrinter?.paperWidth ?? 80;
  const previewWidth = PAPER_WIDTH_PX[paperWidth] ?? 300;

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintResult(null);
    try {
      await onPrint();
      setPrintResult("success");
    } catch (err) {
      console.log("Print error:", err);
      setPrintResult("error");
    } finally {
      setIsPrinting(false);
    }
  };

  if (!receiptData) return null;

  const hasCustomerInfo =
    receiptData.customerName ||
    receiptData.customerId ||
    receiptData.customerAddress ||
    receiptData.customerTin;

  return (
    <Modal visible={visible} position="center" title="Receipt Preview" showCloseButton={false} wide>
      <View className="flex-row gap-4" style={{ maxHeight: 600 }}>
        {/* Left Panel — Receipt Preview */}
        <ScrollView
          showsVerticalScrollIndicator={true}
          className="bg-white rounded-xl border border-gray-200"
          contentContainerClassName="items-center"
          contentContainerStyle={{ padding: 16 }}
          nestedScrollEnabled={true}
          style={{
            maxHeight: 600,
          }}
        >
          <View style={{ width: previewWidth }}>
            {/* Store Header */}
            <Text variant="heading" size="base" className="text-center mb-1">
              {receiptData.storeName}
            </Text>
            {receiptData.storeAddress && (
              <Text variant="muted" size="xs" className="text-center">
                {receiptData.storeAddress}
              </Text>
            )}
            {receiptData.storeTin && (
              <Text variant="muted" size="xs" className="text-center">
                TIN: {receiptData.storeTin}
              </Text>
            )}

            <DashedSeparator />

            {/* Order Info */}
            <InfoRow
              label="Receipt #"
              value={receiptData.receiptNumber || receiptData.orderNumber}
            />
            <InfoRow label="Date" value={formatDate(receiptData.transactionDate)} />
            <InfoRow label="Order Type" value={orderTypeLabel(receiptData.orderType)} />
            {receiptData.tableName && <InfoRow label="Table" value={receiptData.tableName} />}
            <InfoRow label="Cashier" value={receiptData.cashierName} />

            {/* Customer Info */}
            {hasCustomerInfo && (
              <>
                <DashedSeparator />
                {receiptData.customerName && (
                  <InfoRow label="Customer" value={receiptData.customerName} />
                )}
                {receiptData.customerId && (
                  <InfoRow label="ID No." value={receiptData.customerId} />
                )}
                {receiptData.customerAddress && (
                  <InfoRow label="Address" value={receiptData.customerAddress} />
                )}
                {receiptData.customerTin && <InfoRow label="TIN" value={receiptData.customerTin} />}
              </>
            )}

            <DashedSeparator />

            {/* Order Items Header */}
            <Text variant="heading" size="xs" className="text-center mb-2">
              ORDER ITEMS
            </Text>

            {/* Column Headers */}
            <View className="flex-row mb-1">
              <Text size="xs" variant="muted" className="flex-1">
                Item
              </Text>
              <Text size="xs" variant="muted" className="w-6 text-center">
                Qty
              </Text>
              <Text size="xs" variant="muted" className="w-14 text-right">
                Price
              </Text>
              <Text size="xs" variant="muted" className="w-14 text-right">
                Total
              </Text>
            </View>

            {/* Items */}
            {receiptData.items.map((item, index) => (
              <View key={index}>
                <View className="flex-row mb-1">
                  <Text size="xs" className="flex-1" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text size="xs" className="w-6 text-center">
                    {item.quantity}
                  </Text>
                  <Text size="xs" className="w-14 text-right">
                    {formatCurrency(item.price)}
                  </Text>
                  <Text size="xs" className="w-14 text-right">
                    {formatCurrency(item.total)}
                  </Text>
                </View>
                {item.modifiers?.map((mod, modIndex) => (
                  <View key={modIndex} className="flex-row mb-0.5 pl-3">
                    <Text size="xs" variant="muted" className="flex-1">
                      + {mod.optionName}
                    </Text>
                    {mod.priceAdjustment > 0 && (
                      <Text size="xs" variant="muted" className="w-14 text-right">
                        +{formatCurrency(mod.priceAdjustment)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ))}

            <DashedSeparator />

            {/* Totals & VAT */}
            <InfoRow label="Subtotal" value={formatCurrency(receiptData.subtotal)} />
            <InfoRow label="Vatable Sales" value={formatCurrency(receiptData.vatableSales)} />
            <InfoRow label="VAT (12%)" value={formatCurrency(receiptData.vatAmount)} />
            <InfoRow label="VAT-Exempt" value={formatCurrency(receiptData.vatExemptSales)} />
            {receiptData.discounts.length > 0 && (
              <>
                {receiptData.discounts.map((d, i) => (
                  <View key={i} className="mb-2">
                    <Text size="xs" className="text-red-500 font-medium">
                      {d.type === "sc" ? "SC" : "PWD"}: {d.customerName}
                    </Text>
                    <Text size="xs" className="text-red-500">
                      ID: {d.customerId}
                    </Text>
                    <View className="flex-row justify-between">
                      <Text size="xs" className="text-red-500">
                        {d.itemName}
                      </Text>
                      <Text size="xs" className="text-red-500">
                        -{formatCurrency(d.amount)}
                      </Text>
                    </View>
                  </View>
                ))}
                <View className="flex-row justify-between mb-1">
                  <Text size="xs" className="text-red-500 font-medium">
                    Total Discount
                  </Text>
                  <Text size="xs" className="text-red-500 font-medium">
                    -{formatCurrency(receiptData.discounts.reduce((s, d) => s + d.amount, 0))}
                  </Text>
                </View>
              </>
            )}

            <Text size="xs" variant="muted" className="text-center my-1">
              = = = = = = = = = = = = = = = = = = = =
            </Text>
            <View className="flex-row justify-between mb-1">
              <Text variant="heading" size="base">
                TOTAL
              </Text>
              <Text variant="heading" size="base">
                {formatCurrency(receiptData.total)}
              </Text>
            </View>
            <Text size="xs" variant="muted" className="text-center my-1">
              = = = = = = = = = = = = = = = = = = = =
            </Text>

            {/* Payment */}
            <InfoRow
              label="Method"
              value={receiptData.paymentMethod === "cash" ? "Cash" : "Card"}
            />
            {receiptData.paymentMethod === "cash" ? (
              <>
                <InfoRow
                  label="Amount Tendered"
                  value={formatCurrency(receiptData.amountTendered || 0)}
                />
                <InfoRow label="Change" value={formatCurrency(receiptData.change || 0)} />
              </>
            ) : (
              <InfoRow label="Card Payment" value={`**** ${receiptData.cardLastFour || "0000"}`} />
            )}

            <DashedSeparator />

            {/* Footer */}
            <Text variant="heading" size="xs" className="text-center mt-2">
              Thank you for your patronage!
            </Text>
            <Text variant="muted" className="text-center mt-1 mb-2" style={{ fontSize: 9 }}>
              This does not serve as an official receipt
            </Text>
          </View>
        </ScrollView>

        {/* Right Panel — Actions */}
        <View style={{ flex: 1 }} className="justify-between">
          {/* Printer Info */}
          <View>
            <View className="bg-gray-50 rounded-lg p-3 mb-3">
              <Text variant="muted" size="xs" className="mb-1">
                Print to:
              </Text>
              {receiptPrinter ? (
                <>
                  <Text variant="heading" size="sm">
                    {receiptPrinter.name}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    <View
                      className={`w-2 h-2 rounded-full mr-1.5 ${isConnected ? "bg-green-500" : "bg-red-500"}`}
                    />
                    <Text size="xs" variant="muted">
                      {isConnected ? "Connected" : "Disconnected"}
                    </Text>
                    <Text size="xs" variant="muted" className="ml-2">
                      {receiptPrinter.paperWidth}mm
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <Text variant="muted" size="sm">
                    No printer configured
                  </Text>
                  <Text size="xs" className="text-blue-500 mt-1">
                    Go to Settings
                  </Text>
                </>
              )}
            </View>

            {/* Separator */}
            <View className="h-px bg-gray-200 my-2" />

            {/* Change Due (cash only) */}
            {receiptData.paymentMethod === "cash" && (
              <>
                <View className="my-3">
                  <Text variant="muted" size="xs">
                    Change Due
                  </Text>
                  <Text size="2xl" className="font-bold text-green-600">
                    {formatCurrency(receiptData.change || 0)}
                  </Text>
                </View>
                <View className="h-px bg-gray-200 my-2" />
              </>
            )}
          </View>

          {/* Print Feedback */}
          {printResult === "success" && (
            <View className="flex-row items-center bg-green-50 rounded-lg p-3 mb-2">
              <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
              <Text size="sm" className="text-green-700 ml-2 font-medium">
                Receipt sent to printer
              </Text>
            </View>
          )}
          {printResult === "error" && (
            <View className="flex-row items-center bg-red-50 rounded-lg p-3 mb-2">
              <Ionicons name="alert-circle" size={20} color="#dc2626" />
              <Text size="sm" className="text-red-700 ml-2 font-medium">
                Print failed. Check printer connection.
              </Text>
            </View>
          )}

          {/* Buttons */}
          <View className="gap-2">
            <Button variant="primary" disabled={!canPrint || isPrinting} onPress={handlePrint}>
              {isPrinting ? (
                <View className="flex-row items-center justify-center">
                  <ActivityIndicator color="#fff" size="small" />
                  <Text size="base" className="text-white font-semibold ml-2">
                    Printing...
                  </Text>
                </View>
              ) : (
                <View className="flex-row items-center justify-center">
                  <Ionicons name="print" size={18} color="#fff" />
                  <Text size="base" className="text-white font-semibold ml-2">
                    {printResult === "success" ? "Print Again" : "Print Receipt"}
                  </Text>
                </View>
              )}
            </Button>
            <Button variant="outline" onPress={onSkip}>
              {printResult === "success" ? "Done" : "Skip"}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
};
