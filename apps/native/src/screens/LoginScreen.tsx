import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  Alert,
} from "react-native";
import { RFValue } from "react-native-responsive-fontsize";

// TODO: Implement actual POS login in Phase 10
// This is a placeholder until Android POS UI implementation
const LoginScreen = ({ navigation }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const onLogin = async () => {
    if (!username || !password) {
      Alert.alert("Error", "Please enter username and password");
      return;
    }

    setIsLoading(true);
    try {
      // TODO: Call api.auth.login action in Phase 10
      // For now, just navigate to dashboard as placeholder
      Alert.alert(
        "Phase 10 Implementation",
        "Login functionality will be implemented in Phase 10 (Android POS UI)",
        [
          {
            text: "OK",
            onPress: () => navigation.navigate("NotesDashboardScreen"),
          },
        ]
      );
    } catch (err) {
      console.error("Login error", err);
      Alert.alert("Error", "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Image
          source={require("../assets/icons/logo.png")}
          style={styles.logo}
        />
        <Text style={styles.title}>POS Login</Text>
        <Text style={styles.subtitle}>Enter your credentials to continue</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[styles.buttonLogin, isLoading && styles.buttonDisabled]}
          onPress={onLogin}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            {isLoading ? "Logging in..." : "Login"}
          </Text>
        </TouchableOpacity>

        <View style={styles.infoContainer}>
          <Text style={styles.infoText}>
            POS authentication will be implemented in Phase 10
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#fff",
    padding: 20,
    alignItems: "center",
    width: "100%",
  },
  logo: {
    width: 74,
    height: 74,
    marginTop: 20,
  },
  title: {
    marginTop: 49,
    fontSize: RFValue(21),
    fontFamily: "SemiBold",
  },
  subtitle: {
    marginTop: 8,
    fontSize: RFValue(14),
    color: "#000",
    fontFamily: "Regular",
    marginBottom: 32,
    textAlign: "center",
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#D0D5DD",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    fontFamily: "Regular",
    fontSize: RFValue(14),
  },
  buttonLogin: {
    backgroundColor: "#0D87E1",
    padding: 15,
    borderRadius: 10,
    width: "100%",
    marginTop: 8,
    minHeight: 44,
  },
  buttonDisabled: {
    backgroundColor: "#A0C4E8",
  },
  buttonText: {
    textAlign: "center",
    color: "#FFF",
    fontFamily: "SemiBold",
    fontSize: RFValue(14),
  },
  infoContainer: {
    marginTop: 24,
    padding: 16,
    backgroundColor: "#F0F9FF",
    borderRadius: 8,
    width: "100%",
  },
  infoText: {
    textAlign: "center",
    color: "#0D87E1",
    fontFamily: "Regular",
    fontSize: RFValue(12),
  },
});

export default LoginScreen;
