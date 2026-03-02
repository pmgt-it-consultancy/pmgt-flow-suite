import { Ionicons } from "@expo/vector-icons";
import { Pressable, Modal as RNModal, StyleSheet } from "react-native";
import { YStack } from "tamagui";
import { Button, Text } from "../../shared/components/ui";

interface PrintProgressModalProps {
  visible: boolean;
  currentIndex: number;
  totalCount: number;
  onCancel: () => void;
}

export const PrintProgressModal = ({
  visible,
  currentIndex,
  totalCount,
  onCancel,
}: PrintProgressModalProps) => {
  const progress = totalCount > 0 ? currentIndex / totalCount : 0;

  return (
    <RNModal visible={visible} transparent animationType="fade">
      <Pressable style={styles.backdrop}>
        <YStack
          backgroundColor="$white"
          borderRadius={16}
          padding={24}
          marginHorizontal={40}
          alignItems="center"
          gap={16}
        >
          <Ionicons name="print-outline" size={40} color="#0D87E1" />
          <Text variant="heading" size="lg">
            Printing Receipts
          </Text>
          <Text variant="muted" size="base">
            {currentIndex} of {totalCount}
          </Text>

          {/* Progress bar */}
          <YStack
            width="100%"
            height={8}
            backgroundColor="#E5E7EB"
            borderRadius={4}
            overflow="hidden"
          >
            <YStack
              height="100%"
              backgroundColor="#0D87E1"
              borderRadius={4}
              width={`${progress * 100}%` as any}
            />
          </YStack>

          <Button
            variant="destructive"
            size="lg"
            style={{ width: "100%", marginTop: 8 }}
            onPress={onCancel}
          >
            <Text style={{ color: "#DC2626", fontWeight: "600" }}>Cancel Printing</Text>
          </Button>
        </YStack>
      </Pressable>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
});
