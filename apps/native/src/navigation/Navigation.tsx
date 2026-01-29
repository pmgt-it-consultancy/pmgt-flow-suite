import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect } from "react";
import { Alert } from "react-native";
// Import screens from features
import { LoginScreen } from "../features/auth";
import { CheckoutScreen } from "../features/checkout";
import { HomeScreen } from "../features/home";
import { OrderDetailScreen, OrderHistoryScreen } from "../features/order-history";
import { OrderScreen } from "../features/orders";
import { PrinterSettingsScreen, SettingsScreen } from "../features/settings";
import { usePrinterStore } from "../features/settings/stores/usePrinterStore";
import { TablesScreen } from "../features/tables";
import { TakeoutListScreen, TakeoutOrderScreen } from "../features/takeout";

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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const Navigation = () => {
  const initialize = usePrinterStore((s) => s.initialize);
  const isInitialized = usePrinterStore((s) => s.isInitialized);

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

  return (
    <NavigationContainer>
      <Stack.Navigator
        id={undefined}
        initialRouteName="LoginScreen"
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
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default Navigation;
