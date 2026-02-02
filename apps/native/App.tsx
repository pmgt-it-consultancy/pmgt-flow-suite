import { useFonts } from "expo-font";
import * as NavigationBar from "expo-navigation-bar";
import { useCallback, useEffect, useState } from "react";
import { LogBox, Platform, StatusBar, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { TamaguiProvider } from "tamagui";
import ConvexClientProvider from "./ConvexClientProvider";
import { AuthProvider } from "./src/features/auth";
import { SplashScreen } from "./src/features/shared/components/SplashScreen";
import Navigation from "./src/navigation/Navigation";
import config from "./tamagui.config";

export default function App() {
  LogBox.ignoreLogs(["Warning: ..."]);
  LogBox.ignoreAllLogs();

  const [showSplash, setShowSplash] = useState(true);

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

  const handleSplashFinish = useCallback(() => setShowSplash(false), []);

  useEffect(() => {
    if (Platform.OS === "android") {
      NavigationBar.setVisibilityAsync("hidden");
      NavigationBar.setBehaviorAsync("overlay-swipe");
    }
  }, []);

  if (!loaded) {
    return null;
  }

  const STATUS_BAR_HEIGHT = Platform.OS === "ios" ? 50 : StatusBar.currentHeight;

  return (
    <TamaguiProvider config={config} defaultTheme="light">
      <KeyboardProvider>
        <ConvexClientProvider>
          <AuthProvider>
            <View style={{ flex: 1 }}>
              <View style={{ height: STATUS_BAR_HEIGHT, backgroundColor: "#0D87E1" }}>
                <StatusBar translucent backgroundColor={"#0D87E1"} barStyle="light-content" />
              </View>
              <Navigation />
              {showSplash && <SplashScreen onFinish={handleSplashFinish} />}
            </View>
          </AuthProvider>
        </ConvexClientProvider>
      </KeyboardProvider>
    </TamaguiProvider>
  );
}
