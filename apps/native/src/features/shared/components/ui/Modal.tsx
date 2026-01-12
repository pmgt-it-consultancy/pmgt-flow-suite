import { Ionicons } from "@expo/vector-icons";
import { Platform, type ModalProps as RNModalProps } from "react-native";
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "uniwind/components";
import { Text } from "./Text";

interface ModalProps extends RNModalProps {
  title?: string;
  description?: string;
  onClose?: () => void;
  showCloseButton?: boolean;
  position?: "center" | "bottom";
  children: React.ReactNode;
}

export const Modal = ({
  title,
  description,
  onClose,
  showCloseButton = true,
  position = "bottom",
  children,
  ...props
}: ModalProps) => {
  const positionClasses = position === "center" ? "justify-center items-center" : "justify-end";

  const contentClasses =
    position === "center"
      ? "bg-white rounded-2xl p-5 mx-4 max-w-md w-full"
      : "bg-white rounded-t-2xl p-5 max-h-[80%]";

  return (
    <RNModal transparent animationType="slide" {...props}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View className={`flex-1 bg-black/50 ${positionClasses}`}>
          <TouchableWithoutFeedback>
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
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </RNModal>
  );
};
