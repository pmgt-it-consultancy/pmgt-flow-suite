import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import { XStack, YStack } from "tamagui";
import type { KitchenTicketData } from "../../settings/services/escposFormatter";
import { printKitchenTicketToThermal } from "../../settings/services/escposFormatter";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import { Button, Modal, Text } from "../../shared/components/ui";
import type { ReceiptData } from "../../shared/utils/receipt";

interface ReceiptPreviewModalProps {
  visible: boolean;
  receiptData: ReceiptData | null;
  kitchenTicketData: KitchenTicketData | null;
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
  <Text size="xs" variant="muted" style={{ textAlign: "center", marginVertical: 8 }}>
    - - - - - - - - - - - - - - - - - - - -
  </Text>
);

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <XStack justifyContent="space-between" marginBottom={4}>
    <Text size="xs" variant="muted">
      {label}
    </Text>
    <Text size="xs">{value}</Text>
  </XStack>
);

// Paper width to preview width mapping (approximate px per mm)
const PAPER_WIDTH_PX: Record<number, number> = {
  58: 220,
  80: 300,
};

export const ReceiptPreviewModal = ({
  visible,
  receiptData,
  kitchenTicketData,
  onPrint,
  onSkip,
}: ReceiptPreviewModalProps) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<"success" | "error" | null>(null);
  const [kitchenPrintResult, setKitchenPrintResult] = useState<"success" | "error" | null>(null);
  const [isKitchenPrinting, setIsKitchenPrinting] = useState(false);
  const printers = usePrinterStore((s) => s.printers);
  const connectionStatus = usePrinterStore((s) => s.connectionStatus);
  const connectPrinter = usePrinterStore((s) => s.connectPrinter);
  const useReceiptPrinterForKitchen = usePrinterStore((s) => s.useReceiptPrinterForKitchen);

  // Reset print states whenever the modal opens so stale results don't persist
  useEffect(() => {
    if (visible) {
      setPrintResult(null);
      setKitchenPrintResult(null);
      setIsPrinting(false);
      setIsKitchenPrinting(false);
    }
  }, [visible]);

  const receiptPrinter = printers.find((p) => p.role === "receipt" && p.isDefault);
  const kitchenPrinter = printers.find((p) => p.role === "kitchen" && p.isDefault);
  const canPrintKitchen = !!kitchenPrinter || (useReceiptPrinterForKitchen && !!receiptPrinter);
  const isConnected = receiptPrinter ? connectionStatus[receiptPrinter.id] === "connected" : false;
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
      if (__DEV__) console.log("Print error:", err);
      setPrintResult("error");
    } finally {
      setIsPrinting(false);
    }
  };

  const handlePrintKitchenReceipt = async () => {
    if (!kitchenTicketData || !receiptPrinter) return;
    setIsKitchenPrinting(true);
    setKitchenPrintResult(null);
    try {
      // Use dedicated kitchen printer if available, fall back to receipt printer if toggle is on
      const targetPrinter = kitchenPrinter ?? (useReceiptPrinterForKitchen ? receiptPrinter : null);
      if (!targetPrinter) return;
      const connected = await connectPrinter(targetPrinter.id);
      if (!connected) throw new Error("Failed to connect to printer");

      const charsPerLine = targetPrinter.paperWidth === 58 ? 32 : 48;
      await printKitchenTicketToThermal(kitchenTicketData, charsPerLine);
      setKitchenPrintResult("success");
    } catch (err) {
      if (__DEV__) console.log("Kitchen print error:", err);
      setKitchenPrintResult("error");
    } finally {
      setIsKitchenPrinting(false);
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
      <XStack gap={16} style={{ maxHeight: 600 }}>
        {/* Left Panel — Receipt Preview */}
        <ScrollView
          showsVerticalScrollIndicator={true}
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#E5E7EB",
            maxHeight: 600,
          }}
          contentContainerStyle={{ alignItems: "center", padding: 16 }}
          nestedScrollEnabled={true}
        >
          <YStack style={{ width: previewWidth }}>
            {/* Store Header */}
            <Text variant="heading" size="base" style={{ textAlign: "center", marginBottom: 4 }}>
              {receiptData.storeName}
            </Text>
            {receiptData.storeAddress && (
              <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                {receiptData.storeAddress}
              </Text>
            )}
            {receiptData.storeTin && (
              <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
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
            <Text variant="heading" size="xs" style={{ textAlign: "center", marginBottom: 8 }}>
              ORDER ITEMS
            </Text>

            {/* Column Headers */}
            <XStack marginBottom={4}>
              <Text size="xs" variant="muted" style={{ flex: 1 }}>
                Item
              </Text>
              <Text size="xs" variant="muted" style={{ width: 24, textAlign: "center" }}>
                Qty
              </Text>
              <Text size="xs" variant="muted" style={{ width: 56, textAlign: "right" }}>
                Price
              </Text>
              <Text size="xs" variant="muted" style={{ width: 56, textAlign: "right" }}>
                Total
              </Text>
            </XStack>

            {/* Items */}
            {receiptData.items.map((item, index) => {
              const orderDefault =
                receiptData.orderDefaultServiceType ??
                (receiptData.orderCategory
                  ? receiptData.orderCategory === "dine_in"
                    ? "dine_in"
                    : "takeout"
                  : receiptData.orderType === "dine_in"
                    ? "dine_in"
                    : "takeout");
              const itemType = item.serviceType ?? orderDefault;
              return (
                <YStack key={index}>
                  <XStack marginBottom={0}>
                    <Text size="xs" style={{ flex: 1 }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text size="xs" style={{ width: 24, textAlign: "center" }}>
                      {item.quantity}
                    </Text>
                    <Text size="xs" style={{ width: 56, textAlign: "right" }}>
                      {formatCurrency(item.price)}
                    </Text>
                    <Text size="xs" style={{ width: 56, textAlign: "right" }}>
                      {formatCurrency(item.total)}
                    </Text>
                  </XStack>
                  <Text
                    size="xs"
                    style={{
                      color: "#9CA3AF",
                      fontSize: 9,
                      fontStyle: "italic",
                      paddingLeft: 2,
                      marginBottom: 4,
                    }}
                  >
                    {itemType === "takeout" ? "Takeout" : "Dine-In"}
                  </Text>
                  {item.modifiers?.map((mod, modIndex) => (
                    <XStack key={modIndex} marginBottom={2} paddingLeft={12}>
                      <Text size="xs" variant="muted" style={{ flex: 1 }}>
                        + {mod.optionName}
                      </Text>
                      {mod.priceAdjustment > 0 && (
                        <Text size="xs" variant="muted" style={{ width: 56, textAlign: "right" }}>
                          +{formatCurrency(mod.priceAdjustment)}
                        </Text>
                      )}
                    </XStack>
                  ))}
                </YStack>
              );
            })}

            <DashedSeparator />

            {/* Totals & VAT */}
            <InfoRow label="Subtotal" value={formatCurrency(receiptData.subtotal)} />
            <InfoRow label="Vatable Sales" value={formatCurrency(receiptData.vatableSales)} />
            <InfoRow label="VAT (12%)" value={formatCurrency(receiptData.vatAmount)} />
            <InfoRow label="VAT-Exempt" value={formatCurrency(receiptData.vatExemptSales)} />
            {receiptData.discounts.length > 0 && (
              <>
                {receiptData.discounts.map((d, i) => (
                  <YStack key={i} marginBottom={8}>
                    <Text size="xs" style={{ color: "#EF4444", fontWeight: "500" }}>
                      {d.type === "sc" ? "SC" : "PWD"}: {d.customerName}
                    </Text>
                    <Text size="xs" style={{ color: "#EF4444" }}>
                      ID: {d.customerId}
                    </Text>
                    <XStack justifyContent="space-between">
                      <Text size="xs" style={{ color: "#EF4444" }}>
                        {d.itemName}
                      </Text>
                      <Text size="xs" style={{ color: "#EF4444" }}>
                        -{formatCurrency(d.amount)}
                      </Text>
                    </XStack>
                  </YStack>
                ))}
                <XStack justifyContent="space-between" marginBottom={4}>
                  <Text size="xs" style={{ color: "#EF4444", fontWeight: "500" }}>
                    Total Discount
                  </Text>
                  <Text size="xs" style={{ color: "#EF4444", fontWeight: "500" }}>
                    -{formatCurrency(receiptData.discounts.reduce((s, d) => s + d.amount, 0))}
                  </Text>
                </XStack>
              </>
            )}

            <Text size="xs" variant="muted" style={{ textAlign: "center", marginVertical: 4 }}>
              = = = = = = = = = = = = = = = = = = = =
            </Text>
            <XStack justifyContent="space-between" marginBottom={4}>
              <Text variant="heading" size="base">
                TOTAL
              </Text>
              <Text variant="heading" size="base">
                {formatCurrency(receiptData.total)}
              </Text>
            </XStack>
            <Text size="xs" variant="muted" style={{ textAlign: "center", marginVertical: 4 }}>
              = = = = = = = = = = = = = = = = = = = =
            </Text>

            {/* Payment */}
            {receiptData.payments && receiptData.payments.length > 0 ? (
              (() => {
                let totalCashReceived = 0;
                let totalChangeGiven = 0;
                return (
                  <>
                    {receiptData.payments.map((payment, i) => {
                      if (payment.paymentMethod === "cash") {
                        if (payment.cashReceived !== undefined)
                          totalCashReceived += payment.cashReceived;
                        if (payment.changeGiven !== undefined)
                          totalChangeGiven += payment.changeGiven;
                        return (
                          <InfoRow key={i} label="Cash" value={formatCurrency(payment.amount)} />
                        );
                      }
                      const label = payment.cardPaymentType || "Card/E-Wallet";
                      return (
                        <YStack key={i}>
                          <InfoRow label={label} value={formatCurrency(payment.amount)} />
                          {payment.cardReferenceNumber ? (
                            <InfoRow label="Ref #" value={payment.cardReferenceNumber} />
                          ) : null}
                        </YStack>
                      );
                    })}
                    {totalCashReceived > 0 && (
                      <>
                        <InfoRow
                          label="Amount Tendered"
                          value={formatCurrency(totalCashReceived)}
                        />
                        <InfoRow label="Change" value={formatCurrency(totalChangeGiven)} />
                      </>
                    )}
                  </>
                );
              })()
            ) : (
              <>
                <InfoRow
                  label="Method"
                  value={
                    receiptData.paymentMethod === "cash"
                      ? "Cash"
                      : receiptData.cardPaymentType || "Card/E-Wallet"
                  }
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
                  <>
                    {receiptData.cardReferenceNumber ? (
                      <InfoRow label="Ref #" value={receiptData.cardReferenceNumber} />
                    ) : null}
                  </>
                )}
              </>
            )}

            <DashedSeparator />

            {/* Footer */}
            <Text variant="heading" size="xs" style={{ textAlign: "center", marginTop: 8 }}>
              {receiptData.storeFooter || "Thank you for your patronage!"}
            </Text>
            <Text
              variant="muted"
              style={{ textAlign: "center", marginTop: 4, marginBottom: 8, fontSize: 9 }}
            >
              This does not serve as an official receipt
            </Text>
          </YStack>
        </ScrollView>

        {/* Right Panel — Actions */}
        <YStack flex={1} justifyContent="space-between">
          {/* Printer Info */}
          <YStack>
            <YStack backgroundColor="#F9FAFB" borderRadius={8} padding={12} marginBottom={12}>
              <Text variant="muted" size="xs" style={{ marginBottom: 4 }}>
                Print to:
              </Text>
              {receiptPrinter ? (
                <>
                  <Text variant="heading" size="sm">
                    {receiptPrinter.name}
                  </Text>
                  <XStack alignItems="center" marginTop={4}>
                    <YStack
                      width={8}
                      height={8}
                      borderRadius={4}
                      backgroundColor={isConnected ? "#22C55E" : "#EF4444"}
                      marginRight={6}
                    />
                    <Text size="xs" variant="muted">
                      {isConnected ? "Connected" : "Disconnected"}
                    </Text>
                    <Text size="xs" variant="muted" style={{ marginLeft: 8 }}>
                      {receiptPrinter.paperWidth}mm
                    </Text>
                  </XStack>
                </>
              ) : (
                <>
                  <Text variant="muted" size="sm">
                    No printer configured
                  </Text>
                  <Text size="xs" style={{ color: "#0D87E1", marginTop: 4 }}>
                    Go to Settings
                  </Text>
                </>
              )}
            </YStack>

            {/* Separator */}
            <YStack height={1} backgroundColor="#E5E7EB" marginVertical={8} />

            {/* Change Due (cash only, only when change > 0) */}
            {(() => {
              let changeDue: number | null = null;
              if (receiptData.payments && receiptData.payments.length > 0) {
                const totalChange = receiptData.payments.reduce(
                  (sum, p) => sum + (p.changeGiven ?? 0),
                  0,
                );
                const hasCash = receiptData.payments.some((p) => p.paymentMethod === "cash");
                if (hasCash) changeDue = totalChange;
              } else if (receiptData.paymentMethod === "cash") {
                changeDue = receiptData.change || 0;
              }
              if (changeDue === null || changeDue <= 0) return null;
              return (
                <>
                  <YStack marginVertical={12}>
                    <Text variant="muted" size="xs">
                      Change Due
                    </Text>
                    <Text size="2xl" style={{ fontWeight: "700", color: "#16A34A" }}>
                      {formatCurrency(changeDue)}
                    </Text>
                  </YStack>
                  <YStack height={1} backgroundColor="#E5E7EB" marginVertical={8} />
                </>
              );
            })()}
          </YStack>

          {/* Print Feedback */}
          {printResult === "success" && (
            <XStack
              alignItems="center"
              backgroundColor="#F0FDF4"
              borderRadius={8}
              padding={12}
              marginBottom={8}
            >
              <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
              <Text size="sm" style={{ color: "#15803D", marginLeft: 8, fontWeight: "500" }}>
                Receipt sent to printer
              </Text>
            </XStack>
          )}
          {printResult === "error" && (
            <XStack
              alignItems="center"
              backgroundColor="#FEF2F2"
              borderRadius={8}
              padding={12}
              marginBottom={8}
            >
              <Ionicons name="alert-circle" size={20} color="#dc2626" />
              <Text size="sm" style={{ color: "#B91C1C", marginLeft: 8, fontWeight: "500" }}>
                Print failed. Check printer connection.
              </Text>
            </XStack>
          )}

          {/* Kitchen Print Feedback */}
          {kitchenPrintResult === "success" && (
            <XStack
              alignItems="center"
              backgroundColor="#F0FDF4"
              borderRadius={8}
              padding={12}
              marginBottom={8}
            >
              <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
              <Text size="sm" style={{ color: "#15803D", marginLeft: 8, fontWeight: "500" }}>
                Kitchen receipt sent to printer
              </Text>
            </XStack>
          )}
          {kitchenPrintResult === "error" && (
            <XStack
              alignItems="center"
              backgroundColor="#FEF2F2"
              borderRadius={8}
              padding={12}
              marginBottom={8}
            >
              <Ionicons name="alert-circle" size={20} color="#dc2626" />
              <Text size="sm" style={{ color: "#B91C1C", marginLeft: 8, fontWeight: "500" }}>
                Kitchen print failed. Check printer connection.
              </Text>
            </XStack>
          )}

          {/* Buttons */}
          <YStack gap={8}>
            <Button variant="primary" disabled={!canPrint || isPrinting} onPress={handlePrint}>
              {isPrinting ? (
                <XStack alignItems="center" justifyContent="center">
                  <ActivityIndicator color="#fff" size="small" />
                  <Text size="base" style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
                    Printing...
                  </Text>
                </XStack>
              ) : (
                <XStack alignItems="center" justifyContent="center">
                  <Ionicons name="print" size={18} color="#fff" />
                  <Text size="base" style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: 8 }}>
                    {printResult === "success" ? "Print Again" : "Print Receipt"}
                  </Text>
                </XStack>
              )}
            </Button>

            {/* Kitchen Receipt Button */}
            {kitchenTicketData && canPrintKitchen && printResult === "success" && (
              <Text size="xs" variant="muted" style={{ textAlign: "center", marginBottom: 4 }}>
                Tear the customer receipt first, then print the kitchen receipt below.
              </Text>
            )}
            {kitchenTicketData && canPrintKitchen && (
              <Button
                variant="outline"
                disabled={!canPrint || isKitchenPrinting}
                onPress={handlePrintKitchenReceipt}
              >
                {isKitchenPrinting ? (
                  <XStack alignItems="center" justifyContent="center">
                    <ActivityIndicator color="#0D87E1" size="small" />
                    <Text
                      size="base"
                      style={{ color: "#0D87E1", fontWeight: "600", marginLeft: 8 }}
                    >
                      Printing Kitchen Receipt...
                    </Text>
                  </XStack>
                ) : (
                  <XStack alignItems="center" justifyContent="center">
                    <Ionicons name="restaurant" size={18} color="#0D87E1" />
                    <Text
                      size="base"
                      style={{ color: "#0D87E1", fontWeight: "600", marginLeft: 8 }}
                    >
                      {kitchenPrintResult === "success"
                        ? "Print Kitchen Again"
                        : "Print Kitchen Receipt"}
                    </Text>
                  </XStack>
                )}
              </Button>
            )}

            <Button variant="outline" onPress={onSkip}>
              {printResult === "success" ? "Done" : "Skip"}
            </Button>
          </YStack>
        </YStack>
      </XStack>
    </Modal>
  );
};
