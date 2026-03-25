import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";

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
      <XStack flex={1} alignItems="center">
        <Text variant="heading" size="lg">
          {title}
        </Text>
        <YStack
          marginHorizontal={8}
          width={4}
          height={4}
          borderRadius={2}
          backgroundColor="#9CA3AF"
        />
        <Text variant="muted" size="sm">
          {subtitle}
        </Text>
        {tabNumber && tabName && (
          <>
            <YStack
              marginHorizontal={8}
              width={4}
              height={4}
              borderRadius={2}
              backgroundColor="#9CA3AF"
            />
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
                borderRadius: 6,
              }}
            >
              <Text variant="muted" size="sm">
                {tabName}
              </Text>
              {onEditTabName && (
                <Ionicons
                  name="create-outline"
                  size={14}
                  color="#6B7280"
                  style={{ marginLeft: 4 }}
                />
              )}
            </TouchableOpacity>
          </>
        )}
      </XStack>
      {onViewOrders && (
        <IconButton icon="list" variant="ghost" onPress={onViewOrders} iconColor="#6B7280" />
      )}
      <SystemStatusBar />
      {onUpdatePax && (
        <IconButton
          icon="people"
          variant="ghost"
          onPress={onUpdatePax}
          iconColor="#6B7280"
          disabled={disableUpdatePax}
        />
      )}
      {onTransferTable && (
        <IconButton
          icon="swap-horizontal"
          variant="ghost"
          onPress={onTransferTable}
          iconColor="#6B7280"
        />
      )}
      {onAddNewTab && (
        <IconButton
          icon="add-circle-outline"
          variant="ghost"
          onPress={onAddNewTab}
          iconColor="#0D87E1"
          disabled={disableAddNewTab}
        />
      )}
    </XStack>
  );
};
