import type React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ModifierSelectionModal } from "./ModifierSelectionModal";

jest.mock("tamagui", () => {
  const { View, Text } = require("react-native");
  return {
    XStack: View,
    YStack: View,
    SizableText: Text,
    styled: (component: unknown) => component,
  };
});
jest.mock("react-native-gesture-handler", () => {
  const { View, Pressable } = require("react-native");
  return { GestureHandlerRootView: View, Pressable };
});
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAvoidingView: require("react-native").View,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: require("react-native").Text }));
jest.mock("react-native/Libraries/Modal/Modal", () =>
  require("react-native/Libraries/Components/View/View"),
);

type Props = React.ComponentProps<typeof ModifierSelectionModal>;
const product: NonNullable<Props["product"]> = {
  id: "p" as NonNullable<Props["product"]>["id"],
  name: "Burger",
  price: 100,
};
const groups: Props["modifierGroups"] = [
  {
    groupId: "required" as any,
    groupName: "Bread",
    selectionType: "single",
    minSelections: 1,
    sortOrder: 0,
    options: [
      { optionId: "white" as any, name: "White", priceAdjustment: 0, isDefault: true },
      { optionId: "wheat" as any, name: "Wheat", priceAdjustment: 10, isDefault: false },
    ],
  },
  {
    groupId: "optional" as any,
    groupName: "Extras",
    selectionType: "multi",
    minSelections: 0,
    sortOrder: 1,
    options: [{ optionId: "cheese" as any, name: "Cheese", priceAdjustment: 5, isDefault: true }],
  },
];
let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));
const button = (label: string) =>
  tree.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) => node.findAll((n) => n.props.children === label).length > 0)!;

test("applies required and optional defaults when choices arrive after the modal opens", () => {
  const onConfirm = jest.fn();
  const props: Props = {
    visible: true,
    product,
    modifierGroups: [],
    isLoading: false,
    onClose: jest.fn(),
    onConfirm,
  };
  act(() => {
    tree = create(<ModifierSelectionModal {...props} />);
  });
  act(() => tree.update(<ModifierSelectionModal {...props} modifierGroups={groups} />));
  expect(button("Add 1 to Order").props.disabled).toBe(false);
  act(() => button("Add 1 to Order").props.onPress());
  expect(onConfirm).toHaveBeenLastCalledWith(
    1,
    "",
    [
      { modifierGroupName: "Bread", modifierOptionName: "White", priceAdjustment: 0 },
      { modifierGroupName: "Extras", modifierOptionName: "Cheese", priceAdjustment: 5 },
    ],
    undefined,
  );
});

test("retains cashier choices and notes across refreshes and resets defaults for another product", () => {
  const onConfirm = jest.fn();
  const props: Props = {
    visible: true,
    product,
    modifierGroups: groups,
    isLoading: false,
    onClose: jest.fn(),
    onConfirm,
  };
  act(() => {
    tree = create(<ModifierSelectionModal {...props} />);
  });
  act(() => button("Wheat").props.onPress());
  act(() => button("Cheese").props.onPress());
  act(() => tree.root.findByType(TextInput).props.onChangeText("Toast it"));
  act(() => tree.update(<ModifierSelectionModal {...props} modifierGroups={[]} />));
  act(() =>
    tree.update(
      <ModifierSelectionModal {...props} modifierGroups={groups.map((group) => ({ ...group }))} />,
    ),
  );
  act(() => button("Add 1 to Order").props.onPress());
  expect(onConfirm).toHaveBeenLastCalledWith(
    1,
    "Toast it",
    [{ modifierGroupName: "Bread", modifierOptionName: "Wheat", priceAdjustment: 10 }],
    undefined,
  );

  const nextProduct = { ...product, id: "p2" as typeof product.id, name: "Sandwich" };
  act(() =>
    tree.update(<ModifierSelectionModal {...props} product={nextProduct} modifierGroups={[]} />),
  );
  act(() => tree.update(<ModifierSelectionModal {...props} product={nextProduct} />));
  act(() => button("Add 1 to Order").props.onPress());
  expect(onConfirm).toHaveBeenLastCalledWith(
    1,
    "",
    [
      { modifierGroupName: "Bread", modifierOptionName: "White", priceAdjustment: 0 },
      { modifierGroupName: "Extras", modifierOptionName: "Cheese", priceAdjustment: 5 },
    ],
    undefined,
  );
});

test("required groups without defaults still require selection while optional defaults are applied", () => {
  const requiredWithoutDefaults = groups.map((group) =>
    group.minSelections > 0
      ? { ...group, options: group.options.map((option) => ({ ...option, isDefault: false })) }
      : group,
  );
  act(() => {
    tree = create(
      <ModifierSelectionModal
        visible
        product={product}
        modifierGroups={requiredWithoutDefaults}
        isLoading={false}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
  });
  expect(button("Add 1 to Order").props.disabled).toBe(true);
  act(() => button("White").props.onPress());
  expect(button("Add 1 to Order").props.disabled).toBe(false);
});
