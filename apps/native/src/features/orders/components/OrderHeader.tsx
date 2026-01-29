import { View } from "uniwind/components";
import { IconButton, Text } from "../../shared/components/ui";

interface OrderHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
  onTransferTable?: () => void;
}

export const OrderHeader = ({ title, subtitle, onBack, onTransferTable }: OrderHeaderProps) => {
  return (
    <View className="bg-white flex-row items-center px-4 py-2.5 border-b border-gray-200">
      <IconButton icon="arrow-back" variant="ghost" onPress={onBack} className="mr-1" />
      <View className="flex-1 flex-row items-center">
        <Text variant="heading" size="lg">
          {title}
        </Text>
        <View className="mx-2 w-1 h-1 rounded-full bg-gray-400" />
        <Text variant="muted" size="sm">
          {subtitle}
        </Text>
      </View>
      {onTransferTable && (
        <IconButton
          icon="swap-horizontal"
          variant="ghost"
          onPress={onTransferTable}
          iconColor="#6B7280"
        />
      )}
    </View>
  );
};
