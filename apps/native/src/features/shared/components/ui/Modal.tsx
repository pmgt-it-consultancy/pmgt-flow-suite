import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  Modal as RNModal,
  type ModalProps as RNModalProps,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { XStack, YStack } from "tamagui";
import { Text } from "./Text";

interface ModalProps extends RNModalProps {
  title?: string;
  description?: string;
  onClose?: () => void;
  showCloseButton?: boolean;
  position?: "center" | "bottom";
  wide?: boolean;
  children: React.ReactNode;
}

export const Modal = ({
  title,
  description,
  onClose,
  showCloseButton = true,
  position = "bottom",
  wide = false,
  children,
  ...props
}: ModalProps) => {
  const isCenter = position === "center";

  return (
    <RNModal transparent animationType="slide" {...props}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <YStack
          flex={1}
          {...(isCenter
            ? { justifyContent: "center", alignItems: "center" }
            : { justifyContent: "flex-end" })}
        >
          {/* Backdrop */}
          <Pressable
            onPress={onClose}
            style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          />
          {/* Content */}
          <KeyboardAvoidingView
            behavior="padding"
            style={
              isCenter
                ? {
                    backgroundColor: "#FFFFFF",
                    borderRadius: 16,
                    marginHorizontal: 16,
                    ...(wide ? { width: "90%" } : { maxWidth: 448, width: "100%" }),
                  }
                : {
                    backgroundColor: "#FFFFFF",
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    maxHeight: "80%",
                  }
            }
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={{ padding: 20 }}
            >
              {(title || showCloseButton) && (
                <XStack justifyContent="space-between" alignItems="center" marginBottom={16}>
                  <YStack flex={1}>
                    {title && (
                      <Text variant="heading" size="lg">
                        {title}
                      </Text>
                    )}
                    {description && (
                      <Text variant="muted" size="sm" style={{ marginTop: 4 }}>
                        {description}
                      </Text>
                    )}
                  </YStack>
                  {showCloseButton && onClose && (
                    <TouchableOpacity
                      onPress={onClose}
                      style={{ padding: 8, marginRight: -8 }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close" size={24} color="#6B7280" />
                    </TouchableOpacity>
                  )}
                </XStack>
              )}
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        </YStack>
      </GestureHandlerRootView>
    </RNModal>
  );
};
