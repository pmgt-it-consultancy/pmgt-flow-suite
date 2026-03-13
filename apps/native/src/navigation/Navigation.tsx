import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
// Import screens from features
import { LoginScreen } from "../features/auth";
import { useAuth } from "../features/auth/context";
import { CheckoutScreen } from "../features/checkout";
import { DayClosingScreen } from "../features/day-closing";
import { HomeScreen } from "../features/home";
import { LockScreen } from "../features/lock";
import { useLockStore } from "../features/lock/stores/useLockStore";
import { OrderDetailScreen, OrderHistoryScreen } from "../features/order-history";
import { OrderScreen } from "../features/orders";
import { PrinterSettingsScreen, SettingsScreen } from "../features/settings";
import { useBluetoothConnectionEvents } from "../features/settings/hooks/useBluetoothConnectionEvents";
import { usePrinterConnectionPolling } from "../features/settings/hooks/usePrinterConnectionPolling";
import { usePrinterStore } from "../features/settings/stores/usePrinterStore";
import { TablesScreen } from "../features/tables";
import { TakeoutListScreen, TakeoutOrderScreen } from "../features/takeout";
import {
  ForceUpdateModal,
  OptionalUpdateDialog,
} from "../features/updater/components/UpdateDialog";
import { UpdatesScreen } from "../features/updater/screens/UpdatesScreen";
import { useUpdateStore } from "../features/updater/stores/useUpdateStore";

// Define navigation parameter types
export type RootStackParamList = {
  LoginScreen: undefined;
  HomeScreen: undefined;
  TablesScreen: undefined;
  OrderScreen: {
    orderId?: Id<"orders">;
    tableId: Id<"tables">;
    tableName: string;
    storeId: Id<"stores">;
  };
  CheckoutScreen: {
    orderId: Id<"orders">;
    tableId?: Id<"tables">;
    tableName?: string;
    orderType?: "dine_in" | "takeout";
  };
  OrderHistoryScreen: undefined;
  OrderDetailScreen: {
    orderId: Id<"orders">;
  };
  SettingsScreen: undefined;
  PrinterSettingsScreen: { printerId?: string } | undefined;
  TakeoutListScreen: undefined;
  TakeoutOrderScreen: {
    storeId: Id<"stores">;
  };
  UpdatesScreen: undefined;
  DayClosingScreen: undefined;
  LockScreen: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const Navigation = ({
  initialRoute = "LoginScreen",
  onRouteChange,
}: {
  initialRoute?: keyof RootStackParamList;
  onRouteChange?: (routeName: keyof RootStackParamList | null) => void;
}) => {
  const initialize = usePrinterStore((s) => s.initialize);
  const isInitialized = usePrinterStore((s) => s.isInitialized);
  usePrinterConnectionPolling();
  useBluetoothConnectionEvents();

  const checkForUpdateAction = useAction(api.appUpdate.checkForUpdate);
  const { isAuthenticated } = useAuth();
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const dialogDismissed = useUpdateStore((s) => s.dialogDismissed);
  const storeCheck = useUpdateStore((s) => s.checkForUpdate);
  const navigationRef = useRef<any>(null);
  const isLocked = useLockStore((state) => state.isLocked);
  const setLastRoute = useLockStore((state) => state.setLastRoute);

  useEffect(() => {
    if (!isInitialized) {
      initialize().then(({ failedPrinters }) => {
        if (failedPrinters.length > 0) {
          Alert.alert(
            "Printer Connection Failed",
            `Could not connect to: ${failedPrinters.join(", ")}. Please check the printer is turned on and in range.`,
            [
              { text: "Retry", onPress: () => initialize() },
              { text: "Dismiss", style: "cancel" },
            ],
          );
        }
      });
    }
  }, []);

  // Check for updates on mount
  useEffect(() => {
    storeCheck(checkForUpdateAction);
  }, [storeCheck, checkForUpdateAction]);

  // Handle notification taps (e.g., "Update ready to install" → trigger APK install)
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === "update-install") {
        useUpdateStore.getState().installUpdate();
      } else if (data?.type === "update-failed" || data?.type === "update-available") {
        navigationRef.current?.navigate("UpdatesScreen");
      }
    });
    return () => sub.remove();
  }, []);

  // Check for updates on foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        storeCheck(checkForUpdateAction);
      }
    });
    return () => sub.remove();
  }, [storeCheck, checkForUpdateAction]);

  useEffect(() => {
    if (isLocked && isAuthenticated && navigationRef.current) {
      const currentRoute = navigationRef.current.getCurrentRoute();
      if (currentRoute?.name !== "LockScreen") {
        navigationRef.current.navigate("LockScreen");
      }
    }
  }, [isAuthenticated, isLocked]);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        const currentRoute = navigationRef.current?.getCurrentRoute();
        if (currentRoute?.name && currentRoute.name !== "LockScreen") {
          setLastRoute(
            currentRoute.name,
            (currentRoute.params as Record<string, unknown> | undefined) ?? null,
          );
        }
        onRouteChange?.((currentRoute?.name as keyof RootStackParamList | undefined) ?? null);
      }}
      onStateChange={() => {
        const currentRoute = navigationRef.current?.getCurrentRoute();
        if (currentRoute?.name && currentRoute.name !== "LockScreen") {
          setLastRoute(
            currentRoute.name,
            (currentRoute.params as Record<string, unknown> | undefined) ?? null,
          );
        }
        onRouteChange?.((currentRoute?.name as keyof RootStackParamList | undefined) ?? null);
      }}
    >
      <Stack.Navigator
        id={undefined}
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="LoginScreen" component={LoginScreen} />
        <Stack.Screen name="HomeScreen" component={HomeScreen} />
        <Stack.Screen name="TablesScreen" component={TablesScreen} />
        <Stack.Screen name="OrderScreen" component={OrderScreen} />
        <Stack.Screen name="CheckoutScreen" component={CheckoutScreen} />
        <Stack.Screen name="OrderHistoryScreen" component={OrderHistoryScreen} />
        <Stack.Screen name="OrderDetailScreen" component={OrderDetailScreen} />
        <Stack.Screen name="SettingsScreen" component={SettingsScreen} />
        <Stack.Screen name="PrinterSettingsScreen" component={PrinterSettingsScreen} />
        <Stack.Screen name="TakeoutListScreen" component={TakeoutListScreen} />
        <Stack.Screen name="TakeoutOrderScreen" component={TakeoutOrderScreen} />
        <Stack.Screen name="UpdatesScreen" component={UpdatesScreen} />
        <Stack.Screen name="DayClosingScreen" component={DayClosingScreen} />
        <Stack.Screen
          name="LockScreen"
          component={LockScreen}
          options={{ gestureEnabled: false, animation: "fade" }}
        />
      </Stack.Navigator>
      {isAuthenticated && updateInfo?.isForced && (
        <ForceUpdateModal
          updateInfo={updateInfo}
          onGoToUpdates={() => {
            useUpdateStore.getState().dismiss();
            navigationRef.current?.navigate("UpdatesScreen");
          }}
        />
      )}
      {isAuthenticated && updateInfo && !updateInfo.isForced && !dialogDismissed && (
        <OptionalUpdateDialog
          updateInfo={updateInfo}
          onGoToUpdates={() => {
            useUpdateStore.getState().dismiss();
            navigationRef.current?.navigate("UpdatesScreen");
          }}
          onDismiss={() => useUpdateStore.getState().dismiss()}
        />
      )}
    </NavigationContainer>
  );
};

export default Navigation;
