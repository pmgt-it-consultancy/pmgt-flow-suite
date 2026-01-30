import { useState } from "react";
import { Alert } from "react-native";
import { Image, View } from "uniwind/components";
import { Button, Input, Text } from "../../shared/components/ui";
import { useAuth } from "../context";

interface LoginFormProps {
  onLoginSuccess?: () => void;
}

export const LoginForm = ({ onLoginSuccess }: LoginFormProps) => {
  const { signIn, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLoading = isAuthLoading || isSubmitting;

  const handleLogin = async () => {
    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email");
      return;
    }

    if (!password) {
      Alert.alert("Error", "Please enter your password");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signIn(email.trim(), password);

      if (!result.success) {
        Alert.alert("Login Failed", result.error || "Invalid credentials");
      } else {
        onLoginSuccess?.();
      }
    } catch (err) {
      console.error("Login error:", err);
      Alert.alert("Error", "An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View className="w-full items-center px-5">
      <Image
        source={require("../../../../assets/logo-full.png")}
        className="h-56 mt-5"
        resizeMode="contain"
      />

      <Text variant="muted" className="mt-6 mb-8 text-center">
        Enter your credentials to continue
      </Text>

      <View className="w-full gap-4">
        <Input
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!isLoading}
          returnKeyType="next"
        />

        <Input
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <Button
          variant="primary"
          size="lg"
          loading={isLoading}
          disabled={isLoading}
          onPress={handleLogin}
          className="mt-2"
        >
          Login
        </Button>
      </View>

      <Text variant="muted" size="xs" className="mt-10">
        PMGT Flow Suite POS v1.0
      </Text>
    </View>
  );
};
