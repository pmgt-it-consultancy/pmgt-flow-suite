import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "../screens/LoginScreen";
import TablesScreen from "../screens/TablesScreen";
import OrderScreen from "../screens/OrderScreen";
import CheckoutScreen from "../screens/CheckoutScreen";
import { Id } from "@packages/backend/convex/_generated/dataModel";

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
