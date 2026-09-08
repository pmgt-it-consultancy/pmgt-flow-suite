import { NavigationContext } from "@react-navigation/native";
import type React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type ModifierGroupItem, useModifiersForProduct } from "./useModifiers";

type Row = Record<string, any>;
let mockRows: Record<string, Row[]>;
let mockReads: Record<string, number>;
const mockListeners = new Set<() => void>();
jest.mock("../../db", () => ({
  getDatabase: () => ({
    collections: {
      get: (table: string) => ({
        query: (...clauses: any[]) => ({
          observeWithColumns: () => ({
            subscribe: ({ next }: any) => {
              const Q = require("@nozbe/watermelondb/QueryDescription");
              const encodeMatcher =
                require("@nozbe/watermelondb/observation/encodeMatcher").default;
              const matcher = encodeMatcher(Q.buildQueryDescription(clauses));
              const emit = () => {
                const rows = (mockRows[table] ?? []).filter((row) => matcher(row._raw));
                mockReads[table] = (mockReads[table] ?? 0) + rows.length;
                next(rows);
              };
              mockListeners.add(emit);
              emit();
              return { unsubscribe: () => mockListeners.delete(emit) };
            },
          }),
        }),
      }),
    },
  }),
}));

function row(values: Row): Row {
  return {
    ...values,
    _raw: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    ),
  };
}
let result: ModifierGroupItem[] | undefined;
let renderer: ReactTestRenderer;
function Probe({ id }: { id?: string }) {
  result = useModifiersForProduct(id as any);
  return null;
}
beforeEach(() => {
  mockRows = {
    products: [row({ id: "p", storeId: "s", categoryId: "child" })],
    categories: [row({ id: "child", parentId: "parent" }), row({ id: "parent" })],
    modifier_groups: [
      row({ id: "g", isActive: true, name: "Extras", selectionType: "multi", minSelections: 1 }),
    ],
    modifier_options: [
      row({
        id: "o",
        modifierGroupId: "g",
        name: "Cheese",
        isAvailable: true,
        sortOrder: 1,
        priceAdjustment: 5,
      }),
    ],
    modifier_group_assignments: [
      row({ id: "a", categoryId: "parent", modifierGroupId: "g", sortOrder: 0 }),
    ],
  };
  mockReads = {};
});
afterEach(() => {
  act(() => renderer?.unmount());
  mockListeners.clear();
});

test("selected product choices remain bounded as irrelevant catalog grows, and no selection loads nothing", () => {
  for (let i = 0; i < 1000; i++) {
    for (const table of Object.keys(mockRows))
      mockRows[table].push(
        row({ id: `irrelevant-${i}`, storeId: "other", isActive: true, isAvailable: true }),
      );
  }
  act(() => {
    renderer = create(<Probe id="p" />);
  });
  expect(result?.[0].options[0].name).toBe("Cheese");
  expect(Object.values(mockReads).reduce((a, b) => a + b, 0)).toBeLessThan(30);
  mockReads = {};
  act(() => renderer.update(<Probe />));
  expect(result).toBeUndefined();
  expect(Object.values(mockReads).reduce((a, b) => a + b, 0)).toBe(0);
});

function changeCatalog(change: () => void) {
  act(() => {
    change();
    for (const emit of [...mockListeners]) if (mockListeners.has(emit)) emit();
  });
}

test("pauses selected-product subscriptions while hidden and refreshes on return", () => {
  let focused = true;
  const listeners = new Set<() => void>();
  const navigation = {
    isFocused: () => focused,
    addListener: (_event: string, fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } as unknown as React.ContextType<typeof NavigationContext>;
  act(() => {
    renderer = create(
      <NavigationContext.Provider value={navigation}>
        <Probe id="p" />
      </NavigationContext.Provider>,
    );
  });
  expect(result?.[0].groupName).toBe("Extras");
  act(() => {
    focused = false;
    for (const fn of listeners) fn();
  });
  expect(mockListeners.size).toBe(0);
  expect(result?.[0].groupName).toBe("Extras");
  mockRows.modifier_groups[0] = row({ ...mockRows.modifier_groups[0], name: "Latest extras" });
  act(() => {
    focused = true;
    for (const fn of listeners) fn();
  });
  expect(result?.[0].groupName).toBe("Latest extras");
});

test("inherits ancestors, prefers product overrides, sorts choices and reacts to catalog changes", () => {
  mockRows.modifier_group_assignments.push(
    row({
      id: "direct",
      productId: "p",
      modifierGroupId: "g",
      minSelectionsOverride: 0,
      maxSelectionsOverride: 2,
      sortOrder: 3,
    }),
  );
  mockRows.modifier_options.push(
    row({
      id: "first",
      modifierGroupId: "g",
      name: "Bacon",
      isAvailable: true,
      sortOrder: 0,
      priceAdjustment: 10,
    }),
  );
  act(() => {
    renderer = create(<Probe id="p" />);
  });
  expect(result?.[0]).toMatchObject({ minSelections: 0, maxSelections: 2, sortOrder: 3 });
  expect(result?.[0].options.map((o) => o.name)).toEqual(["Bacon", "Cheese"]);
  changeCatalog(() => {
    mockRows.modifier_group_assignments.pop();
  });
  expect(result?.[0].minSelections).toBe(1);
  changeCatalog(() => {
    mockRows.modifier_options[0] = row({
      ...mockRows.modifier_options[0],
      name: "Updated cheese",
      priceAdjustment: 7,
      sortOrder: -1,
    });
  });
  expect(result?.[0].options[0]).toMatchObject({ name: "Updated cheese", priceAdjustment: 7 });
  changeCatalog(() => {
    mockRows.categories[0] = row({ id: "child", parentId: "elsewhere" });
  });
  expect(result).toEqual([]);
  changeCatalog(() => {
    mockRows.modifier_group_assignments.push(
      row({ id: "new", categoryId: "elsewhere", modifierGroupId: "g", sortOrder: 0 }),
    );
  });
  expect(result?.[0].groupName).toBe("Extras");
  changeCatalog(() => {
    mockRows.modifier_groups[0] = row({ ...mockRows.modifier_groups[0], isActive: false });
  });
  expect(result).toEqual([]);
  changeCatalog(() => {
    mockRows.modifier_groups[0] = row({ ...mockRows.modifier_groups[0], isActive: true });
  });
  expect(result?.[0].groupName).toBe("Extras");
  act(() => renderer.update(<Probe id="missing" />));
  expect(result).toBeUndefined();
  act(() => renderer.unmount());
  expect(mockListeners.size).toBe(0);
});
