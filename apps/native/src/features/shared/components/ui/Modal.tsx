import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, type ModalProps as RNModalProps, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardAvoidingView, Modal as RNModal, TouchableOpacity, View } from "uniwind/components";
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
  const positionClasses = position === "center" ? "justify-center items-center" : "justify-end";

  const contentClasses =
    position === "center"
      ? wide
        ? "bg-white rounded-2xl p-5 mx-4 w-[90%]"
        : "bg-white rounded-2xl p-5 mx-4 max-w-md w-full"
      : "bg-white rounded-t-2xl p-5 max-h-[80%]";

  return (
    <RNModal transparent animationType="slide" {...props}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className={`flex-1 ${positionClasses}`}>
          {/* Backdrop — absolute so it doesn't wrap content */}
          <Pressable onPress={onClose} style={StyleSheet.absoluteFill} className="bg-black/50" />
          {/* Content — no touchable wrapper, so ScrollViews work freely */}
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className={contentClasses}
          >
            {(title || showCloseButton) && (
              <View className="flex-row justify-between items-center mb-4">
                <View className="flex-1">
                  {title && (
                    <Text variant="heading" size="lg">
                      {title}
                    </Text>
                  )}
                  {description && (
                    <Text variant="muted" size="sm" className="mt-1">
                      {description}
                    </Text>
                  )}
                </View>
                {showCloseButton && onClose && (
                  <TouchableOpacity
                    onPress={onClose}
                    className="p-2 -mr-2"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={24} color="#6B7280" />
                  </TouchableOpacity>
                )}
              </View>
            )}
            {children}
          </KeyboardAvoidingView>
        </View>
      </GestureHandlerRootView>
    </RNModal>
  );
};
