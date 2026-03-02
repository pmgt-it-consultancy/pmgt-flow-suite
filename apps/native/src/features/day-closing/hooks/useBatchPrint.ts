import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useConvex, useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { usePrinterStore } from "../../settings/stores/usePrinterStore";
import type { ReceiptData } from "../../shared/utils/receipt";

interface BatchPrintState {
  isPrinting: boolean;
  currentIndex: number;
  totalCount: number;
  failedOrderIds: Id<"orders">[];
}

export function useBatchPrint() {
  const [state, setState] = useState<BatchPrintState>({
    isPrinting: false,
    currentIndex: 0,
    totalCount: 0,
    failedOrderIds: [],
  });
  const cancelledRef = useRef(false);

  const convex = useConvex();
  const logReprint = useMutation(api.checkout.logReceiptReprint);
  const { printReceipt: printToThermal } = usePrinterStore();

  // Build ReceiptData from backend queries — mirrors OrderDetailScreen.handleReprint
  const buildReceiptData = useCallback(
    async (orderId: Id<"orders">): Promise<ReceiptData | null> => {
      try {
        const receipt = await convex.query(api.checkout.getReceipt, { orderId });
        if (!receipt) return null;

        const discounts = await convex.query(api.discounts.getOrderDiscounts, { orderId });

        const storeAddress = [receipt.storeAddress1, receipt.storeAddress2]
          .filter(Boolean)
          .join(", ");

        const discountsList = (discounts ?? []).map((d) => ({
          type:
            d.discountType === "senior_citizen"
              ? ("sc" as const)
              : d.discountType === "pwd"
                ? ("pwd" as const)
                : ("custom" as const),
          customerName: d.customerName,
          customerId: d.customerId,
          itemName: d.itemName ?? "Order",
          amount: d.discountAmount,
        }));

        return {
          storeName: receipt.storeName,
          storeAddress,
          storeTin: receipt.tin,
          orderNumber: receipt.orderNumber,
          tableName: receipt.tableName,
          pax: receipt.pax,
          orderType: receipt.orderType as "dine_in" | "take_out" | "delivery",
          cashierName: receipt.cashierName,
          items: receipt.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.unitPrice,
            total: i.lineTotal,
          })),
          subtotal: receipt.grossSales,
          discounts: discountsList,
          vatableSales: receipt.vatableSales,
          vatAmount: receipt.vatAmount,
          vatExemptSales: receipt.vatExemptSales,
          total: receipt.netSales,
          paymentMethod: receipt.paymentMethod === "cash" ? "cash" : "card_ewallet",
          amountTendered: receipt.cashReceived,
          change: receipt.changeGiven ?? 0,
          cardPaymentType: receipt.cardPaymentType,
          cardReferenceNumber: receipt.cardReferenceNumber,
          transactionDate: new Date(receipt.paidAt ?? receipt.createdAt),
          receiptNumber: receipt.orderNumber,
        };
      } catch {
        return null;
      }
    },
    [convex],
  );

  const printBatch = useCallback(
    async (orderIds: Id<"orders">[]) => {
      cancelledRef.current = false;
      const failed: Id<"orders">[] = [];

      setState({
        isPrinting: true,
        currentIndex: 0,
        totalCount: orderIds.length,
        failedOrderIds: [],
      });

      for (let i = 0; i < orderIds.length; i++) {
        if (cancelledRef.current) break;

        setState((prev) => ({ ...prev, currentIndex: i + 1 }));

        try {
          const receiptData = await buildReceiptData(orderIds[i]);
          if (receiptData) {
            await logReprint({ orderId: orderIds[i] });
            await printToThermal(receiptData);
          } else {
            failed.push(orderIds[i]);
          }
        } catch (error) {
          console.error(`Failed to print order ${orderIds[i]}:`, error);
          failed.push(orderIds[i]);
        }
      }

      setState((prev) => ({
        ...prev,
        isPrinting: false,
        failedOrderIds: failed,
      }));

      if (failed.length > 0 && !cancelledRef.current) {
        Alert.alert(
          "Batch Print Complete",
          `${orderIds.length - failed.length} of ${orderIds.length} receipts printed. ${failed.length} failed.`,
        );
      } else if (!cancelledRef.current) {
        Alert.alert("Success", `All ${orderIds.length} receipts printed.`);
      }
    },
    [buildReceiptData, logReprint, printToThermal],
  );

  const cancelBatch = useCallback(() => {
    cancelledRef.current = true;
    setState((prev) => ({ ...prev, isPrinting: false }));
  }, []);

  return {
    ...state,
    printBatch,
    cancelBatch,
  };
}
