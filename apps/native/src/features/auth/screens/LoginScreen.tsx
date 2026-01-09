import React, { useEffect } from "react";
import { View, KeyboardAvoidingView } from "uniwind/components";
import { Platform } from "react-native";
import { useAuth } from "../context";
import { LoginForm } from "../components";

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
