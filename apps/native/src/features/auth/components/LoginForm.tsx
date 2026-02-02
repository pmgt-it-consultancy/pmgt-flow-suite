import { useState } from "react";
import { Alert, Image } from "react-native";
import { YStack } from "tamagui";
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
    <YStack width="100%" alignItems="center" paddingHorizontal={20}>
      <Image
        source={require("../../../../assets/logo-full.png")}
        style={{ height: 224, marginTop: 20 }}
        resizeMode="contain"
      />

      <Text variant="muted" style={{ marginTop: 24, marginBottom: 32, textAlign: "center" }}>
        Enter your credentials to continue
      </Text>

      <YStack width="100%" gap={16}>
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
          style={{ marginTop: 8 }}
        >
          Login
        </Button>
      </YStack>

      <Text variant="muted" size="xs" style={{ marginTop: 40 }}>
        PMGT Flow Suite POS v1.0
      </Text>
    </YStack>
  );
};
