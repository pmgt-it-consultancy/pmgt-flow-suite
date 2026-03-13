import { useFonts } from "expo-font";
import * as NavigationBar from "expo-navigation-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogBox, Platform, StatusBar, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { TamaguiProvider } from "tamagui";
import ConvexClientProvider from "./ConvexClientProvider";
import { AuthProvider } from "./src/features/auth";
import { useAuth } from "./src/features/auth/context";
import { SplashScreen } from "./src/features/shared/components/SplashScreen";
import Navigation from "./src/navigation/Navigation";
import config from "./tamagui.config";

function AppContent() {
  const { isLoading, isAuthenticated } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [animationDone, setAnimationDone] = useState(false);
  const resolvedRoute = useRef<"HomeScreen" | "LoginScreen" | null>(null);

  // Once auth resolves, lock in the initial route
  if (!isLoading && resolvedRoute.current === null) {
    resolvedRoute.current = isAuthenticated ? "HomeScreen" : "LoginScreen";
  }

  // Dismiss splash when both animation is done AND auth has resolved
  const handleSplashFinish = useCallback(() => {
    setAnimationDone(true);
  }, []);

  useEffect(() => {
    if (animationDone && !isLoading) {
      setShowSplash(false);
    }
  }, [animationDone, isLoading]);

  const STATUS_BAR_HEIGHT = Platform.OS === "ios" ? 50 : StatusBar.currentHeight;

  return (
    <View style={{ flex: 1 }}>
      {showSplash ? (
        <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <View style={{ height: STATUS_BAR_HEIGHT, backgroundColor: "#FFFFFF" }}>
            <StatusBar translucent backgroundColor="#FFFFFF" barStyle="dark-content" />
          </View>
          <SplashScreen onFinish={handleSplashFinish} />
        </View>
      ) : (
        <>
          <View style={{ height: STATUS_BAR_HEIGHT, backgroundColor: "#0D87E1" }}>
            <StatusBar translucent backgroundColor="#0D87E1" barStyle="light-content" />
          </View>
          <Navigation initialRoute={resolvedRoute.current ?? "LoginScreen"} />
        </>
      )}
    </View>
  );
}

export default function App() {
  LogBox.ignoreLogs(["Warning: ..."]);
  LogBox.ignoreAllLogs();

  const [loaded] = useFonts({
    Bold: require("./src/assets/fonts/Inter-Bold.ttf"),
    SemiBold: require("./src/assets/fonts/Inter-SemiBold.ttf"),
    Medium: require("./src/assets/fonts/Inter-Medium.ttf"),
    Regular: require("./src/assets/fonts/Inter-Regular.ttf"),

    MBold: require("./src/assets/fonts/Montserrat-Bold.ttf"),
    MSemiBold: require("./src/assets/fonts/Montserrat-SemiBold.ttf"),
    MMedium: require("./src/assets/fonts/Montserrat-Medium.ttf"),
    MRegular: require("./src/assets/fonts/Montserrat-Regular.ttf"),
    MLight: require("./src/assets/fonts/Montserrat-Light.ttf"),
  });

  useEffect(() => {
    if (Platform.OS === "android") {
      NavigationBar.setVisibilityAsync("hidden");
      NavigationBar.setBehaviorAsync("overlay-swipe");
    }
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <TamaguiProvider config={config} defaultTheme="light">
      <KeyboardProvider>
        <ConvexClientProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ConvexClientProvider>
      </KeyboardProvider>
    </TamaguiProvider>
  );
}
