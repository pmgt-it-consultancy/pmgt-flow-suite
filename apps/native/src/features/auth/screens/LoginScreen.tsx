import { useEffect } from "react";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { View } from "uniwind/components";
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
        routes: [{ name: "HomeScreen" }],
      });
    }
  }, [isAuthenticated, navigation]);

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
      style={{ flex: 1, backgroundColor: "white" }}
      showsVerticalScrollIndicator={false}
    >
      <View className="items-center">
        <LoginForm />
      </View>
    </KeyboardAwareScrollView>
  );
};

export default LoginScreen;
