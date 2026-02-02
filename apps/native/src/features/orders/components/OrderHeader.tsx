import { XStack, YStack } from "tamagui";
import { SystemStatusBar } from "../../shared/components/SystemStatusBar";
import { IconButton, Text } from "../../shared/components/ui";

interface OrderHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
  onTransferTable?: () => void;
  onUpdatePax?: () => void;
  onViewOrders?: () => void;
}

export const OrderHeader = ({
  title,
  subtitle,
  onBack,
  onTransferTable,
  onUpdatePax,
  onViewOrders,
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
      </XStack>
      {onViewOrders && (
        <IconButton icon="list" variant="ghost" onPress={onViewOrders} iconColor="#6B7280" />
      )}
      <SystemStatusBar />
      {onUpdatePax && (
        <IconButton icon="people" variant="ghost" onPress={onUpdatePax} iconColor="#6B7280" />
      )}
      {onTransferTable && (
        <IconButton
          icon="swap-horizontal"
          variant="ghost"
          onPress={onTransferTable}
          iconColor="#6B7280"
        />
      )}
    </XStack>
  );
};
