import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { Button, IconButton, Text } from "../../shared/components/ui";

interface OrderHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
  onTransferTable?: () => void;
  onUpdatePax?: () => void;
  disableUpdatePax?: boolean;
  onViewOrders?: () => void;
  tabNumber?: number;
  tabName?: string;
  onEditTabName?: () => void;
  onAddNewTab?: () => void;
  disableAddNewTab?: boolean;
}

export const OrderHeader = ({
  title,
  subtitle,
  onBack,
  onTransferTable,
  onUpdatePax,
  disableUpdatePax,
  onViewOrders,
  tabNumber,
  tabName,
  onEditTabName,
  onAddNewTab,
  disableAddNewTab,
}: OrderHeaderProps) => {
  return (
    <XStack
      backgroundColor="#FFFFFF"
      alignItems="center"
      paddingHorizontal={16}
      paddingVertical={10}
      borderBottomWidth={1}
      borderBottomColor="#E5E7EB"
    >
      <IconButton icon="arrow-back" variant="ghost" onPress={onBack} style={{ marginRight: 4 }} />
      <YStack flex={1}>
        <XStack flexWrap="wrap" alignItems="center" gap={8}>
          <Text variant="heading" size="lg" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="muted" size="sm" numberOfLines={1}>
            {subtitle}
          </Text>
          {tabNumber && tabName && (
            <TouchableOpacity
              onPress={onEditTabName}
              disabled={!onEditTabName}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 4,
                paddingHorizontal: 8,
                backgroundColor: onEditTabName ? "#F3F4F6" : "transparent",
                borderRadius: 999,
                borderWidth: 1,
                borderColor: onEditTabName ? "#E5E7EB" : "transparent",
              }}
            >
              <Text variant="muted" size="sm" numberOfLines={1}>
                {tabName}
              </Text>
              {onEditTabName ? (
                <Ionicons
                  name="create-outline"
                  size={14}
                  color="#6B7280"
                  style={{ marginLeft: 4 }}
                />
              ) : null}
            </TouchableOpacity>
          )}
        </XStack>
      </YStack>
      <XStack alignItems="center" gap={8} flexWrap="wrap" justifyContent="flex-end">
        {onViewOrders ? (
          <Button variant="outline" size="sm" onPress={onViewOrders}>
            Orders
          </Button>
        ) : null}
        <SystemStatusBar />
        {onUpdatePax ? (
          <Button variant="outline" size="sm" onPress={onUpdatePax} disabled={disableUpdatePax}>
            Update Pax
          </Button>
        ) : null}
        {onTransferTable ? (
          <Button variant="outline" size="sm" onPress={onTransferTable}>
            Transfer
          </Button>
        ) : null}
        {onAddNewTab ? (
          <Button variant="outline" size="sm" onPress={onAddNewTab} disabled={disableAddNewTab}>
            New Tab
          </Button>
        ) : null}
      </XStack>
    </XStack>
  );
};
