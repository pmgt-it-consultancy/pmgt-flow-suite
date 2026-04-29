import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActivityIndicator, Alert, FlatList, RefreshControl } from "react-native";
import { XStack, YStack } from "tamagui";
import { useTakeoutOrders } from "../../../sync";
import { useAuth } from "../../auth/context";
import { PageHeader } from "../../shared/components/PageHeader";
import { Button, IconButton, Text } from "../../shared/components/ui";
import { DraftOrderCard, TakeoutOrderCard, TakeoutOrderDetailModal } from "../components";
import { createDraftOrder, discardDraft, updateTakeoutStatus } from "../services/takeoutMutations";

type TakeoutStatus = "pending" | "preparing" | "ready_for_pickup" | "completed" | "cancelled";

const NEXT_STATUS: Partial<Record<TakeoutStatus, TakeoutStatus>> = {
  pending: "preparing",
  preparing: "ready_for_pickup",
  ready_for_pickup: "completed",
};

function getStartOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getEndOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  const todayStart = getStartOfDay(today);
  const dateStart = getStartOfDay(date);

  if (dateStart === todayStart) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStart === getStartOfDay(yesterday)) return "Yesterday";

  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

interface TakeoutListScreenProps {
  navigation: any;
}

export const TakeoutListScreen = ({ navigation }: TakeoutListScreenProps) => {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [isCreating, setIsCreating] = useState(false);
  const creatingLockRef = useRef(false);
  const advanceLocksRef = useRef<Set<string>>(new Set());
  const [advancingOrderIds, setAdvancingOrderIds] = useState<Set<string>>(new Set());
  const discardLockRef = useRef<Set<string>>(new Set());

  const isToday = getStartOfDay(selectedDate) === getStartOfDay(new Date());

  const takeoutOrders = useTakeoutOrders(
    user?.storeId,
    getStartOfDay(selectedDate),
    getEndOfDay(selectedDate),
  );

  // Mutations — all use WatermelonDB service functions imported above

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      creatingLockRef.current = false;
      setIsCreating(false);
    });

    return unsubscribe;
  }, [navigation]);

  const drafts = useQuery(
    api.orders.getDraftOrders,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const { attentionOrders, kitchenOrders, completedOrders } = useMemo(() => {
    if (!takeoutOrders) return { attentionOrders: [], kitchenOrders: [], completedOrders: [] };
    return {
      // Open orders that are still pending (not yet sent to kitchen)
      attentionOrders: takeoutOrders.filter(
        (o) => o.status === "open" && (!o.takeoutStatus || o.takeoutStatus === "pending"),
      ),
      // In-progress: paid orders in kitchen workflow OR unpaid advance orders (open + preparing/ready)
      kitchenOrders: takeoutOrders.filter(
        (o) =>
          (o.status === "paid" &&
            o.takeoutStatus &&
            !["completed", "cancelled"].includes(o.takeoutStatus)) ||
          (o.status === "open" &&
            o.takeoutStatus &&
            ["preparing", "ready_for_pickup"].includes(o.takeoutStatus)),
      ),
      completedOrders: takeoutOrders.filter(
        (o) =>
          o.status === "voided" ||
          (o.status === "paid" &&
            o.takeoutStatus &&
            ["completed", "cancelled"].includes(o.takeoutStatus)),
      ),
    };
  }, [takeoutOrders]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  }, []);

  const handleAdvanceStatus = useCallback(
    async (orderId: Id<"orders">, currentStatus: TakeoutStatus) => {
      if (advanceLocksRef.current.has(orderId)) return;

      const nextStatus = NEXT_STATUS[currentStatus];
      if (!nextStatus) return;

      advanceLocksRef.current.add(orderId);
      setAdvancingOrderIds((prev) => new Set(prev).add(orderId));
      try {
        await updateTakeoutStatus({ orderId: orderId as string, status: nextStatus });
      } catch (error: any) {
        console.error("Update takeout status error:", error);
        Alert.alert("Error", error.message || "Failed to update takeout status");
      } finally {
        advanceLocksRef.current.delete(orderId);
        setAdvancingOrderIds((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }
    },
    [updateTakeoutStatus],
  );

  const handleNewOrder = useCallback(async () => {
    if (!user?.storeId || creatingLockRef.current) return;

    creatingLockRef.current = true;
    setIsCreating(true);
    try {
      const orderId = await createDraftOrder({
        storeId: user.storeId as string,
      });
      navigation.navigate("TakeoutOrderScreen", {
        storeId: user.storeId,
        orderId,
      });
    } catch (_error) {
      creatingLockRef.current = false;
      setIsCreating(false);
      Alert.alert("Error", "Failed to create order. Please try again.");
    }
  }, [user?.storeId, navigation, createDraftOrder]);

  const handleResumeDraft = useCallback(
    (orderId: Id<"orders">) => {
      if (!user?.storeId) return;
      navigation.navigate("TakeoutOrderScreen", {
        storeId: user.storeId,
        orderId,
      });
    },
    [user?.storeId, navigation],
  );

  const handleOpenTakeoutOrder = useCallback(
    (
      orderId: Id<"orders">,
      status?: "draft" | "open" | "paid" | "voided",
      takeoutStatus?: string,
    ) => {
      if (!user?.storeId) return;

      if (status === "open") {
        // Advance orders — card tap goes to order screen to add items
        if (takeoutStatus === "preparing" || takeoutStatus === "ready_for_pickup") {
          navigation.navigate("TakeoutOrderScreen", {
            storeId: user.storeId,
            orderId,
          });
          return;
        }
        // Regular open orders go to the order screen
        navigation.navigate("TakeoutOrderScreen", {
          storeId: user.storeId,
          orderId,
        });
        return;
      }

      setSelectedOrderId(orderId);
    },
    [user?.storeId, navigation],
  );

  const handleAddItems = useCallback(
    (orderId: Id<"orders">) => {
      if (!user?.storeId) return;
      navigation.navigate("TakeoutOrderScreen", {
        storeId: user.storeId,
        orderId,
      });
    },
    [user?.storeId, navigation],
  );

  const handleTakePayment = useCallback(
    (orderId: Id<"orders">) => {
      navigation.navigate("CheckoutScreen", {
        orderId,
        orderType: "takeout" as const,
      });
    },
    [navigation],
  );

  const [_discardingId, setDiscardingId] = useState<Id<"orders"> | null>(null);

  const handleDiscardDraft = useCallback(
    async (orderId: Id<"orders">) => {
      if (discardLockRef.current.has(orderId)) return;

      discardLockRef.current.add(orderId);
      setDiscardingId(orderId);
      try {
        await discardDraft({ orderId: orderId as string });
      } catch (_error) {
        Alert.alert("Error", "Failed to discard draft. Please try again.");
      } finally {
        discardLockRef.current.delete(orderId);
        setDiscardingId(null);
      }
    },
    [discardDraft],
  );

  const handlePrevDay = useCallback(() => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  }, []);

  const handleNextDay = useCallback(() => {
    if (isToday) return;
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  }, [isToday]);

  const handleGoToToday = useCallback(() => {
    setSelectedDate(new Date());
  }, []);

  return (
    <YStack flex={1} backgroundColor="#F3F4F6">
      <PageHeader
        title="Takeout Orders"
        subtitle={`${formatDateLabel(selectedDate)}'s takeout orders`}
        onBack={() => navigation.goBack()}
        rightContent={
          <Button size="md" onPress={handleNewOrder} disabled={isCreating}>
            <XStack alignItems="center" gap={6}>
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>New Order</Text>
            </XStack>
          </Button>
        }
      />

      {/* Date Navigation */}
      <XStack
        backgroundColor="#FFFFFF"
        paddingHorizontal={16}
        paddingVertical={8}
        alignItems="center"
        justifyContent="center"
        gap={12}
        borderBottomWidth={1}
        borderColor="#E5E7EB"
      >
        <IconButton icon="chevron-back" variant="ghost" onPress={handlePrevDay} />
        <Text variant="heading" size="sm" style={{ minWidth: 120, textAlign: "center" }}>
          {formatDateLabel(selectedDate)}
        </Text>
        <IconButton
          icon="chevron-forward"
          variant="ghost"
          onPress={handleNextDay}
          disabled={isToday}
          iconColor={isToday ? "#D1D5DB" : undefined}
        />
        {!isToday && (
          <Button size="sm" variant="outline" onPress={handleGoToToday}>
            <Text style={{ fontSize: 12, fontWeight: "600" }}>Today</Text>
          </Button>
        )}
      </XStack>

      {drafts && drafts.length > 0 && (
        <YStack paddingHorizontal={16} paddingTop={8} paddingBottom={12} gap={8}>
          <Text variant="heading" size="base" style={{ color: "#92400E" }}>
            Drafts ({drafts.length})
          </Text>
          {drafts.map((draft) => (
            <DraftOrderCard
              key={draft._id}
              id={draft._id}
              draftLabel={draft.draftLabel}
              customerName={draft.customerName}
              itemCount={draft.itemCount}
              subtotal={draft.subtotal}
              createdAt={draft.createdAt}
              onResume={handleResumeDraft}
              onDiscard={handleDiscardDraft}
            />
          ))}
        </YStack>
      )}

      {takeoutOrders === undefined ? (
        <YStack flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator size="large" color="#0D87E1" />
        </YStack>
      ) : (
        <FlatList
          data={[...attentionOrders, ...kitchenOrders, ...completedOrders]}
          keyExtractor={(item) => item._id}
          renderItem={({ item, index }) => (
            <YStack>
              {/* Section headers */}
              {index === 0 && attentionOrders.length > 0 ? (
                <Text
                  variant="heading"
                  size="sm"
                  style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
                >
                  Needs Attention ({attentionOrders.length})
                </Text>
              ) : null}
              {index === attentionOrders.length && kitchenOrders.length > 0 ? (
                <Text
                  variant="heading"
                  size="sm"
                  style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
                >
                  In Progress ({kitchenOrders.length})
                </Text>
              ) : null}
              {index === attentionOrders.length + kitchenOrders.length &&
              completedOrders.length > 0 ? (
                <Text
                  variant="heading"
                  size="sm"
                  style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
                >
                  History ({completedOrders.length})
                </Text>
              ) : null}
              <YStack paddingHorizontal={16}>
                <TakeoutOrderCard
                  id={item._id}
                  orderNumber={item.orderNumber}
                  customerName={item.customerName}
                  orderStatus={item.status}
                  takeoutStatus={item.takeoutStatus as TakeoutStatus | undefined}
                  netSales={item.netSales}
                  itemCount={item.itemCount}
                  createdAt={item.createdAt}
                  refundedFromOrderId={item.refundedFromOrderId}
                  onAdvanceStatus={handleAdvanceStatus}
                  onPress={(orderId) =>
                    handleOpenTakeoutOrder(orderId, item.status, item.takeoutStatus)
                  }
                  onAddItems={handleAddItems}
                  onTakePayment={handleTakePayment}
                  disableAdvance={
                    (item.takeoutStatus === "ready_for_pickup" && item.status !== "paid") ||
                    advancingOrderIds.has(item._id)
                  }
                />
              </YStack>
            </YStack>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <YStack flex={1} alignItems="center" justifyContent="center" paddingVertical={64}>
              <Ionicons name="bag-handle-outline" size={48} color="#D1D5DB" />
              <Text variant="muted" style={{ marginTop: 12 }}>
                No takeout orders {isToday ? "today" : "on this day"}
              </Text>
              {isToday && (
                <Button size="md" style={{ marginTop: 16 }} onPress={handleNewOrder}>
                  Create First Order
                </Button>
              )}
            </YStack>
          }
        />
      )}

      <TakeoutOrderDetailModal
        visible={selectedOrderId !== null}
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </YStack>
  );
};

export default TakeoutListScreen;
