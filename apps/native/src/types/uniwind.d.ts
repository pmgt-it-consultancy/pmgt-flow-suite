/**
 * Type declarations for uniwind/components
 * Uniwind wraps React Native components with className support
 */

declare module "uniwind/components" {
  import * as React from "react";
  import {
    View as RNView,
    Text as RNText,
    Image as RNImage,
    ScrollView as RNScrollView,
    FlatList as RNFlatList,
    TextInput as RNTextInput,
    TouchableOpacity as RNTouchableOpacity,
    TouchableWithoutFeedback as RNTouchableWithoutFeedback,
    ActivityIndicator as RNActivityIndicator,
    Modal as RNModal,
    KeyboardAvoidingView as RNKeyboardAvoidingView,
    RefreshControl as RNRefreshControl,
    Pressable as RNPressable,
    SafeAreaView as RNSafeAreaView,
    SectionList as RNSectionList,
    VirtualizedList as RNVirtualizedList,
    Switch as RNSwitch,
    ImageBackground as RNImageBackground,
    InputAccessoryView as RNInputAccessoryView,
    TouchableHighlight as RNTouchableHighlight,
    TouchableNativeFeedback as RNTouchableNativeFeedback,
    Button as RNButton,
    ViewProps,
    TextProps,
    ImageProps,
    ScrollViewProps,
    FlatListProps,
    TextInputProps,
    TouchableOpacityProps,
    TouchableWithoutFeedbackProps,
    ActivityIndicatorProps,
    ModalProps,
    KeyboardAvoidingViewProps,
    RefreshControlProps,
    PressableProps,
    SafeAreaViewProps,
    SectionListProps,
    VirtualizedListProps,
    SwitchProps,
    ImageBackgroundProps,
    InputAccessoryViewProps,
    TouchableHighlightProps,
    TouchableNativeFeedbackProps,
    ButtonProps,
  } from "react-native";

  // Add className prop to all wrapped components
  interface UniwindProps {
    className?: string;
  }

  // Export wrapped components with forwardRef support
  export const View: React.ForwardRefExoticComponent<ViewProps & UniwindProps & React.RefAttributes<RNView>>;
  export const Text: React.ForwardRefExoticComponent<TextProps & UniwindProps & React.RefAttributes<RNText>>;
  export const Image: React.ForwardRefExoticComponent<ImageProps & UniwindProps & React.RefAttributes<RNImage>>;
  export const ScrollView: React.ForwardRefExoticComponent<ScrollViewProps & UniwindProps & React.RefAttributes<RNScrollView>>;
  export const FlatList: typeof RNFlatList;
  export const TextInput: React.ForwardRefExoticComponent<TextInputProps & UniwindProps & React.RefAttributes<RNTextInput>>;
  export const TouchableOpacity: React.ForwardRefExoticComponent<TouchableOpacityProps & UniwindProps & React.RefAttributes<RNTouchableOpacity>>;
  export const TouchableWithoutFeedback: React.ForwardRefExoticComponent<TouchableWithoutFeedbackProps & UniwindProps & React.RefAttributes<RNTouchableWithoutFeedback>>;
  export const ActivityIndicator: React.ForwardRefExoticComponent<ActivityIndicatorProps & UniwindProps & React.RefAttributes<RNActivityIndicator>>;
  export const Modal: React.ForwardRefExoticComponent<ModalProps & UniwindProps & React.RefAttributes<RNModal>>;
  export const KeyboardAvoidingView: React.ForwardRefExoticComponent<KeyboardAvoidingViewProps & UniwindProps & React.RefAttributes<RNKeyboardAvoidingView>>;
  export const RefreshControl: React.ForwardRefExoticComponent<RefreshControlProps & UniwindProps & React.RefAttributes<RNRefreshControl>>;
  export const Pressable: React.ForwardRefExoticComponent<PressableProps & UniwindProps & React.RefAttributes<RNPressable>>;
  export const SafeAreaView: React.ForwardRefExoticComponent<SafeAreaViewProps & UniwindProps & React.RefAttributes<RNSafeAreaView>>;
  export const SectionList: typeof RNSectionList;
  export const VirtualizedList: typeof RNVirtualizedList;
  export const Switch: React.ForwardRefExoticComponent<SwitchProps & UniwindProps & React.RefAttributes<RNSwitch>>;
  export const ImageBackground: React.ForwardRefExoticComponent<ImageBackgroundProps & UniwindProps & React.RefAttributes<RNImageBackground>>;
  export const InputAccessoryView: React.ForwardRefExoticComponent<InputAccessoryViewProps & UniwindProps & React.RefAttributes<RNInputAccessoryView>>;
  export const TouchableHighlight: React.ForwardRefExoticComponent<TouchableHighlightProps & UniwindProps & React.RefAttributes<RNTouchableHighlight>>;
  export const TouchableNativeFeedback: React.ForwardRefExoticComponent<TouchableNativeFeedbackProps & UniwindProps & React.RefAttributes<RNTouchableNativeFeedback>>;
  export const Button: React.ForwardRefExoticComponent<ButtonProps & UniwindProps & React.RefAttributes<RNButton>>;

  // Re-export non-wrapped components from react-native
  export {
    Alert,
    Platform,
    StyleSheet,
    Dimensions,
    Animated,
    Easing,
    Keyboard,
    LayoutAnimation,
    Linking,
    LogBox,
    StatusBar,
    AppState,
    BackHandler,
    DeviceEventEmitter,
    NativeEventEmitter,
    NativeModules,
    PixelRatio,
    Share,
    ToastAndroid,
    Vibration,
  } from "react-native";
}
