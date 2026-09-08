import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Pressable, Text } from "react-native";
import renderer, { act } from "react-test-renderer";
import { useCartQuantityEdits, usePreventCartEditLoss } from "../hooks/useCartQuantityEdits";
import { CartItem } from "./CartItem";

jest.mock("tamagui", () => {
  const { View } = require("react-native");
  return { XStack: View, YStack: View };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
jest.mock("@react-navigation/native", () => ({ usePreventRemove: jest.fn() }));
jest.mock("react-native-gesture-handler", () => ({ Pressable: require("react-native").Pressable }));
jest.mock("../../shared/components/ui", () => ({
  Text: jest.fn((props) => {
    const NativeText = require("react-native").Text;
    return <NativeText {...props} />;
  }),
}));
jest.mock("../../shared/hooks", () => ({ useFormatCurrency: () => (n: number) => `PHP ${n}` }));

const itemId = "item-a" as Id<"orderItems">;
const noop = () => {};

function Cart({
  save,
  checkout,
  visible = true,
  id = itemId,
}: {
  save: (id: Id<"orderItems">, quantity: number) => Promise<void>;
  checkout: () => void;
  visible?: boolean;
  id?: Id<"orderItems">;
}) {
  const edits = useCartQuantityEdits();
  usePreventCartEditLoss(edits, { dispatch: checkout });
  return (
    <>
      {visible && (
        <CartItem
          id={id}
          productName="Rice"
          productPrice={50}
          quantity={1}
          lineTotal={50}
          isSentToKitchen={false}
          onIncrement={noop}
          onDecrement={noop}
          onSetQuantity={save}
          quantityEdits={edits}
        />
      )}
      <Pressable
        accessibilityLabel="Checkout"
        onPress={async () => {
          await edits.flush();
          checkout();
        }}
      >
        <Text>Checkout</Text>
      </Pressable>
    </>
  );
}

describe("cart quantity checkout boundary", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("blocks native back until edits save and retains a failed edit for retry", async () => {
    const { usePreventRemove } = require("@react-navigation/native");
    const save = jest.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
    const leave = jest.fn();
    let view!: renderer.ReactTestRenderer;
    act(() => {
      view = renderer.create(<Cart save={save} checkout={leave} />);
    });
    act(() => {
      let node = view.root.findAllByProps({ name: "add" })[0];
      while (!node.props.onPress) node = node.parent!;
      node.props.onPress();
    });
    const [blocked, back] = usePreventRemove.mock.calls.at(-1);
    expect(blocked).toBe(true);
    await act(async () => {
      await back({ data: { action: { type: "GO_BACK" } } });
    });
    expect(leave).not.toHaveBeenCalled();
    await act(async () => {
      await back({ data: { action: { type: "GO_BACK" } } });
    });
    expect(leave).toHaveBeenCalledWith({ type: "GO_BACK" });
    act(() => view.unmount());
  });

  it("shows rapid taps immediately and saves the latest quantity before checkout", async () => {
    let finish!: () => void;
    const saved: number[] = [];
    const save = async (_id: Id<"orderItems">, quantity: number) => {
      saved.push(quantity);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    const checkout = jest.fn();
    let view!: renderer.ReactTestRenderer;
    act(() => {
      view = renderer.create(<Cart save={save} checkout={checkout} />);
    });
    const increment = () => {
      let node = view.root.findAllByProps({ name: "add" })[0];
      while (!node.props.onPress) node = node.parent!;
      return node;
    };
    act(() => {
      increment().props.onPress();
      increment().props.onPress();
    });
    expect(view.root.findAllByType(Text).some((node) => node.props.children === 3)).toBe(true);
    let transition!: Promise<void>;
    act(() => {
      transition = view.root.findByProps({ accessibilityLabel: "Checkout" }).props.onPress();
    });
    expect(saved).toEqual([3]);
    expect(checkout).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await transition;
    });
    expect(checkout).toHaveBeenCalledTimes(1);
    act(() => view.unmount());
  });

  it("keeps the latest displayed edit when a virtualized row remounts and retries failed checkout", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(new Error("disk busy"))
      .mockResolvedValue(undefined);
    const checkout = jest.fn();
    let view!: renderer.ReactTestRenderer;
    act(() => {
      view = renderer.create(<Cart save={save} checkout={checkout} />);
    });
    act(() => {
      let node = view.root.findAllByProps({ name: "add" })[0];
      while (!node.props.onPress) node = node.parent!;
      node.props.onPress();
    });
    act(() => view.update(<Cart save={save} checkout={checkout} visible={false} />));
    act(() => view.update(<Cart save={save} checkout={checkout} />));
    expect(view.root.findAllByType(Text).some((node) => node.props.children === 2)).toBe(true);
    await act(async () => {
      await expect(
        view.root.findByProps({ accessibilityLabel: "Checkout" }).props.onPress(),
      ).rejects.toThrow("disk busy");
    });
    expect(checkout).not.toHaveBeenCalled();
    expect(view.root.findAllByType(Text).some((node) => node.props.children === 2)).toBe(true);
    await act(async () => {
      await view.root.findByProps({ accessibilityLabel: "Checkout" }).props.onPress();
    });
    expect(save.mock.calls.map((call) => call[1])).toEqual([2, 2]);
    expect(checkout).toHaveBeenCalledTimes(1);
    act(() => view.unmount());
  });

  it("does not redraw a row for equal modifier arrays but uses a replaced quantity callback", async () => {
    const TextComponent = require("../../shared/components/ui").Text;
    const save = jest.fn();
    const replacement = jest.fn();
    const row = (onSetQuantity = save, adjustment = 10) => (
      <CartItem
        id={itemId}
        productName="Rice"
        productPrice={50}
        quantity={1}
        lineTotal={60}
        isSentToKitchen={false}
        onIncrement={noop}
        onDecrement={noop}
        onSetQuantity={onSetQuantity}
        modifiers={[{ groupName: "Size", optionName: "Large", priceAdjustment: adjustment }]}
      />
    );
    let view!: renderer.ReactTestRenderer;
    act(() => {
      view = renderer.create(row());
    });
    TextComponent.mockClear();
    act(() => view.update(row()));
    expect(TextComponent).not.toHaveBeenCalled();
    act(() => {
      let node = view.root.findAllByProps({ name: "add" })[0];
      while (!node.props.onPress) node = node.parent!;
      node.props.onPress();
    });
    act(() => view.update(row(replacement, 20)));
    expect(JSON.stringify(view.toJSON())).toContain("PHP 20");
    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledWith(itemId, 2);
  });

  it("serializes an edit made during a slow save before allowing checkout", async () => {
    const completed: number[] = [];
    const releases: (() => void)[] = [];
    const save = async (_id: Id<"orderItems">, quantity: number) => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      completed.push(quantity);
    };
    const checkout = jest.fn();
    let view!: renderer.ReactTestRenderer;
    act(() => {
      view = renderer.create(<Cart save={save} checkout={checkout} />);
    });
    const tap = () => {
      let node = view.root.findAllByProps({ name: "add" })[0];
      while (!node.props.onPress) node = node.parent!;
      node.props.onPress();
    };
    act(tap);
    act(() => jest.advanceTimersByTime(300));
    act(tap);
    let transition!: Promise<void>;
    act(() => {
      transition = view.root.findByProps({ accessibilityLabel: "Checkout" }).props.onPress();
    });
    expect(releases).toHaveLength(1);
    await act(async () => {
      releases[0]();
      await Promise.resolve();
    });
    expect(completed).toEqual([2]);
    expect(releases).toHaveLength(2);
    expect(checkout).not.toHaveBeenCalled();
    await act(async () => {
      releases[1]();
      await transition;
    });
    expect(completed).toEqual([2, 3]);
    expect(checkout).toHaveBeenCalledTimes(1);
    act(() => view.unmount());
  });

  it("uses the current save callback after a pending row is recycled", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const replacement = jest.fn().mockResolvedValue(undefined);
    let view!: renderer.ReactTestRenderer;
    act(() => {
      view = renderer.create(<Cart save={save} checkout={noop} />);
    });
    act(() => {
      let node = view.root.findAllByProps({ name: "add" })[0];
      while (!node.props.onPress) node = node.parent!;
      node.props.onPress();
    });
    act(() => view.update(<Cart save={replacement} checkout={noop} visible={false} />));
    act(() => view.update(<Cart save={replacement} checkout={noop} />));
    await act(async () => {
      await view.root.findByProps({ accessibilityLabel: "Checkout" }).props.onPress();
    });
    expect(save).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledWith(itemId, 2);
    act(() => view.unmount());
  });

  it("keeps edits associated with their row when switching rows and flushes on screen unmount", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    let view!: renderer.ReactTestRenderer;
    act(() => {
      view = renderer.create(<Cart save={save} checkout={noop} />);
    });
    const tap = () => {
      let node = view.root.findAllByProps({ name: "add" })[0];
      while (!node.props.onPress) node = node.parent!;
      node.props.onPress();
    };
    act(tap);
    act(() => view.update(<Cart save={save} checkout={noop} id={"item-b" as Id<"orderItems">} />));
    expect(view.root.findAllByType(Text).some((node) => node.props.children === 1)).toBe(true);
    act(() => {
      tap();
      tap();
    });
    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });
    expect(save.mock.calls).toEqual([
      ["item-a", 2],
      ["item-b", 3],
    ]);
  });
});
