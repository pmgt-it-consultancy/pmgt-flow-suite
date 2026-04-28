import { useFonts } from "expo-font";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogBox, Platform, StatusBar, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { TamaguiProvider } from "tamagui";
import ConvexClientProvider from "./ConvexClientProvider";
import { AuthProvider } from "./src/features/auth";
import { useAuth } from "./src/features/auth/context";
import { IdleWarningBanner } from "./src/features/lock";
import { useIdleTimer } from "./src/features/lock/hooks/useIdleTimer";
import { useLockStore } from "./src/features/lock/stores/useLockStore";
import { SplashScreen } from "./src/features/shared/components/SplashScreen";
import { useAndroidFullscreen } from "./src/features/shared/hooks";
import Navigation from "./src/navigation/Navigation";
import { SyncBootstrap } from "./src/sync";
import config from "./tamagui.config";

function AppContent({ retriggerFullscreen }: { retriggerFullscreen: () => void }) {
  const { isLoading, isAuthenticated } = useAuth();
  const showIdleWarning = useLockStore((state) => state.showIdleWarning);
  const warningStartedAt = useLockStore((state) => state.warningStartedAt);
  const { resetActivity, setCurrentRoute } = useIdleTimer();
  const [showSplash, setShowSplash] = useState(true);
  const [animationDone, setAnimationDone] = useState(false);
  const [storeHydrated, setStoreHydrated] = useState(false);
  const resolvedRoute = useRef<"HomeScreen" | "LoginScreen" | "LockScreen" | null>(null);

  useEffect(() => {
    if (useLockStore.persist.hasHydrated()) {
      setStoreHydrated(true);
    }

    const unsubscribe = useLockStore.persist.onFinishHydration(() => {
      setStoreHydrated(true);
    });

    return unsubscribe;
  }, []);

  // Once auth resolves, lock in the initial route
  if (!isLoading && storeHydrated && resolvedRoute.current === null) {
    if (isAuthenticated) {
      const locked = useLockStore.getState().isLocked;
      resolvedRoute.current = locked ? "LockScreen" : "HomeScreen";
    } else {
      resolvedRoute.current = "LoginScreen";
    }
  }

  // Dismiss splash when both animation is done AND auth has resolved
  const handleSplashFinish = useCallback(() => {
    setAnimationDone(true);
  }, []);

  useEffect(() => {
    if (animationDone && !isLoading && storeHydrated) {
      setShowSplash(false);
    }
  }, [animationDone, isLoading, storeHydrated]);

  const handleRouteChange = useCallback(
    (routeName: string | null) => {
      retriggerFullscreen();
      setCurrentRoute(routeName as "HomeScreen" | "LoginScreen" | "LockScreen" | null);
    },
    [retriggerFullscreen, setCurrentRoute],
  );

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
          <View
            style={{ flex: 1 }}
            onStartShouldSetResponderCapture={() => {
              retriggerFullscreen();
              resetActivity();
              return false;
            }}
          >
            <Navigation
              initialRoute={resolvedRoute.current ?? "LoginScreen"}
              onRouteChange={handleRouteChange}
            />
            {showIdleWarning && warningStartedAt && (
              <IdleWarningBanner
                visible
                onDismiss={resetActivity}
                lockTime={warningStartedAt + 30_000}
              />
            )}
          </View>
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
  const retriggerFullscreen = useAndroidFullscreen(loaded);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <TamaguiProvider config={config} defaultTheme="light">
        <KeyboardProvider>
          <ConvexClientProvider>
            <AuthProvider>
              <SyncBootstrap />
              <AppContent retriggerFullscreen={retriggerFullscreen} />
            </AuthProvider>
          </ConvexClientProvider>
        </KeyboardProvider>
      </TamaguiProvider>
    </GestureHandlerRootView>
  );
}
