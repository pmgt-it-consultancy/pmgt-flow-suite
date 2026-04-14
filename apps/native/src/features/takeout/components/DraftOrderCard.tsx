import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Alert } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { XStack, YStack } from "tamagui";
import { Text } from "../../shared/components/ui";
import { useFormatCurrency } from "../../shared/hooks";

interface DraftOrderCardProps {
  id: Id<"orders">;
  draftLabel?: string;
  customerName?: string;
  itemCount: number;
  subtotal: number;
  createdAt: number;
  onResume: (orderId: Id<"orders">) => void;
  onDiscard: (orderId: Id<"orders">) => void;
}

export function DraftOrderCard({
  id,
  draftLabel,
  customerName,
  itemCount,
  subtotal,
  createdAt,
  onResume,
  onDiscard,
}: DraftOrderCardProps) {
  const formatCurrency = useFormatCurrency();
  const displayName = customerName || draftLabel || "Draft";
  const time = new Date(createdAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const handleDiscard = () => {
    Alert.alert("Discard Draft", `Discard "${displayName}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => onDiscard(id),
      },
    ]);
  };

  return (
    <Pressable onPress={() => onResume(id)}>
      <YStack
        backgroundColor="#FEF3C7"
        borderWidth={2}
        borderColor="#F59E0B"
        borderStyle="dashed"
        borderRadius={12}
        padding={14}
      >
        <XStack justifyContent="space-between" alignItems="center">
          <YStack flex={1}>
            <Text variant="heading" size="base">
              {displayName}
            </Text>
            <Text variant="muted" size="sm">
              {time} · {itemCount} {itemCount === 1 ? "item" : "items"} · {formatCurrency(subtotal)}
            </Text>
          </YStack>
          <XStack gap={8} alignItems="center">
            <Pressable
              android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
              onPress={handleDiscard}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={20} color="#DC2626" />
            </Pressable>
            <XStack
              backgroundColor="#F59E0B"
              borderRadius={8}
              paddingVertical={8}
              paddingHorizontal={14}
            >
              <Text style={{ color: "white", fontWeight: "600", fontSize: 13 }}>Resume</Text>
            </XStack>
          </XStack>
        </XStack>
      </YStack>
    </Pressable>
  );
}
