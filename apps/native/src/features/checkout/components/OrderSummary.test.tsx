import renderer, { act } from "react-test-renderer";
import { OrderSummary } from "./OrderSummary";

jest.mock("tamagui", () => ({
  XStack: ({ children }: { children?: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  YStack: ({ children }: { children?: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
}));

jest.mock("../../shared/components/ui", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => {
    const { Text } = require("react-native");
    return <Text>{children}</Text>;
  },
  Card: ({ children }: { children?: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  Text: ({ children }: { children?: React.ReactNode }) => {
    const { Text } = require("react-native");
    return <Text>{children}</Text>;
  },
}));

jest.mock("../../shared/hooks", () => ({
  useFormatCurrency: () => (amount: number) => `PHP ${amount.toFixed(2)}`,
}));

describe("OrderSummary", () => {
  it("shows modifier option names and price adjustments under checkout items", () => {
    let component: renderer.ReactTestRenderer;

    act(() => {
      component = renderer.create(
        <OrderSummary
          orderDefaultServiceType="takeout"
          items={[
            {
              _id: "item-1",
              productName: "Royal",
              isVatable: false,
              quantity: 1,
              lineTotal: 45,
              modifiers: [
                {
                  optionName: "Large",
                  priceAdjustment: 10,
                },
              ],
            },
          ]}
        />,
      );
    });

    const tree = component!.toJSON();

    expect(JSON.stringify(tree)).toContain("Large");
    expect(JSON.stringify(tree)).toContain("PHP 10.00");
  });
});
