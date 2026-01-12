import { useEffect } from "react";
import { Platform } from "react-native";
import { KeyboardAvoidingView, View } from "uniwind/components";
import { LoginForm } from "../components";
import { useAuth } from "../context";

interface LoginScreenProps {
  navigation: any;
}

export const LoginScreen = ({ navigation }: LoginScreenProps) => {
  const { isAuthenticated } = useAuth();

  // Navigate to tables screen when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigation.reset({
        index: 0,
        routes: [{ name: "TablesScreen" }],
      });
    }
  }, [isAuthenticated, navigation]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white justify-center"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="items-center">
        <LoginForm />
      </View>
    </KeyboardAvoidingView>
  );
};

export default LoginScreen;
