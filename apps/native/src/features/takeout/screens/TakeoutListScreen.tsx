import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import * as Crypto from "expo-crypto";
import { useCallback, useMemo, useState } from "react";

import { ActivityIndicator, Alert, FlatList, RefreshControl } from "react-native";
import { XStack, YStack } from "tamagui";
import { useAuth } from "../../auth/context";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { Button, IconButton, Text } from "../../shared/components/ui";
import { DraftOrderCard, TakeoutOrderCard, TakeoutOrderDetailModal } from "../components";

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

  const isToday = getStartOfDay(selectedDate) === getStartOfDay(new Date());

  const takeoutOrders = useQuery(
    api.orders.getTakeoutOrders,
    user?.storeId
      ? {
          storeId: user.storeId,
          startDate: getStartOfDay(selectedDate),
          endDate: getEndOfDay(selectedDate),
        }
      : "skip",
  );

  const updateStatus = useMutation(api.orders.updateTakeoutStatus);
  const createDraftMutation = useMutation(api.orders.createDraftOrder);
  const discardDraftMutation = useMutation(api.orders.discardDraft);

  const drafts = useQuery(
    api.orders.getDraftOrders,
    user?.storeId ? { storeId: user.storeId } : "skip",
  );

  const { activeOrders, completedOrders } = useMemo(() => {
    if (!takeoutOrders) return { activeOrders: [], completedOrders: [] };
    return {
      activeOrders: takeoutOrders.filter(
        (o) =>
          o.status !== "voided" &&
          o.takeoutStatus &&
          !["completed", "cancelled"].includes(o.takeoutStatus),
      ),
      completedOrders: takeoutOrders.filter(
        (o) =>
          o.status === "voided" ||
          (o.takeoutStatus && ["completed", "cancelled"].includes(o.takeoutStatus)),
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
      const nextStatus = NEXT_STATUS[currentStatus];
      if (!nextStatus) return;
      try {
        await updateStatus({ orderId, newStatus: nextStatus });
      } catch (error: any) {
        console.error("Update takeout status error:", error);
      }
    },
    [updateStatus],
  );

  const handleNewOrder = useCallback(async () => {
    if (!user?.storeId || isCreating) return;
    setIsCreating(true);
    try {
      const orderId = await createDraftMutation({
        storeId: user.storeId,
        requestId: Crypto.randomUUID(),
      });
      navigation.navigate("TakeoutOrderScreen", {
        storeId: user.storeId,
        orderId,
      });
    } catch (error) {
      Alert.alert("Error", "Failed to create order. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }, [user?.storeId, navigation, createDraftMutation, isCreating]);

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

  const [discardingId, setDiscardingId] = useState<Id<"orders"> | null>(null);

  const handleDiscardDraft = useCallback(
    async (orderId: Id<"orders">) => {
      if (discardingId) return;
      setDiscardingId(orderId);
      try {
        await discardDraftMutation({ orderId });
      } catch (error) {
        Alert.alert("Error", "Failed to discard draft. Please try again.");
      } finally {
        setDiscardingId(null);
      }
    },
    [discardDraftMutation, discardingId],
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
      {/* Header */}
      <XStack
        backgroundColor="#FFFFFF"
        paddingHorizontal={16}
        paddingVertical={16}
        justifyContent="space-between"
        alignItems="center"
        borderBottomWidth={1}
        borderColor="#E5E7EB"
      >
        <XStack alignItems="center" gap={12}>
          <IconButton icon="arrow-back" onPress={() => navigation.goBack()} />
          <YStack>
            <Text variant="heading" size="lg">
              Takeout Orders
            </Text>
            <Text variant="muted" size="sm">
              {formatDateLabel(selectedDate)}'s takeout orders
            </Text>
          </YStack>
        </XStack>
        <XStack alignItems="center" gap={8}>
          <SystemStatusBar />
          <Button size="md" onPress={handleNewOrder} disabled={isCreating}>
            <XStack alignItems="center" gap={6}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>New Order</Text>
            </XStack>
          </Button>
        </XStack>
      </XStack>

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
          data={[...activeOrders, ...completedOrders]}
          keyExtractor={(item) => item._id}
          renderItem={({ item, index }) => (
            <YStack>
              {/* Section headers */}
              {index === 0 && activeOrders.length > 0 ? (
                <Text
                  variant="heading"
                  size="sm"
                  style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
                >
                  Active ({activeOrders.length})
                </Text>
              ) : null}
              {index === activeOrders.length && completedOrders.length > 0 ? (
                <Text
                  variant="heading"
                  size="sm"
                  style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
                >
                  Completed ({completedOrders.length})
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
                  onAdvanceStatus={handleAdvanceStatus}
                  onPress={setSelectedOrderId}
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
