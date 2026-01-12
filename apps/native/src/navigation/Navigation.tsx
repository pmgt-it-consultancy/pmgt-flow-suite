import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// Import screens from features
import { LoginScreen } from "../features/auth";
import { CheckoutScreen } from "../features/checkout";
import { OrderScreen } from "../features/orders";
import { TablesScreen } from "../features/tables";

// Define navigation parameter types
export type RootStackParamList = {
  LoginScreen: undefined;
  TablesScreen: undefined;
  OrderScreen: {
    orderId: Id<"orders">;
    tableId?: Id<"tables">;
    tableName?: string;
  };
  CheckoutScreen: {
    orderId: Id<"orders">;
    tableId?: Id<"tables">;
    tableName?: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const Navigation = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        id={undefined}
        initialRouteName="LoginScreen"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="LoginScreen" component={LoginScreen} />
        <Stack.Screen name="TablesScreen" component={TablesScreen} />
        <Stack.Screen name="OrderScreen" component={OrderScreen} />
        <Stack.Screen name="CheckoutScreen" component={CheckoutScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default Navigation;
