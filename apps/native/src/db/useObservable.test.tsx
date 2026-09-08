import type { Model, Query } from "@nozbe/watermelondb";
import { NavigationContext } from "@react-navigation/native";
import type { ContextType } from "react";
import renderer, { act } from "react-test-renderer";
import { useObservable } from "./useObservable";

it("pauses display observations on blur and loads current data on focus", () => {
  let focused = true;
  const listeners = new Set<() => void>();
  const navigation = {
    isFocused: () => focused,
    addListener: (_event: string, fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } as unknown as ContextType<typeof NavigationContext>;
  let subscribed = 0;
  let current = [{ id: "first" }] as Model[];
  const query = {
    observe: () => ({
      subscribe: ({ next }: { next: (rows: Model[]) => void }) => {
        subscribed++;
        next(current);
        return { unsubscribe: () => subscribed-- };
      },
    }),
  } as unknown as Query<Model>;
  let visible: Model[] | undefined;
  function Probe({ scope }: { scope: string }) {
    visible = useObservable(() => query, [scope]);
    return null;
  }
  let tree: renderer.ReactTestRenderer;
  const render = (scope: string) => (
    <NavigationContext.Provider value={navigation}>
      <Probe scope={scope} />
    </NavigationContext.Provider>
  );
  act(() => {
    tree = renderer.create(render("store-a"));
  });
  expect(subscribed).toBe(1);
  expect(visible?.[0].id).toBe("first");
  act(() => {
    focused = false;
    for (const fn of listeners) fn();
  });
  expect(subscribed).toBe(0);
  current = [{ id: "latest" }] as Model[];
  act(() => {
    tree.update(render("store-b"));
  });
  expect(visible).toBeUndefined();
  expect(subscribed).toBe(0);
  act(() => {
    focused = true;
    for (const fn of listeners) fn();
  });
  expect(subscribed).toBe(1);
  expect(visible?.[0].id).toBe("latest");
  act(() => tree.unmount());
  expect(subscribed).toBe(0);
});
