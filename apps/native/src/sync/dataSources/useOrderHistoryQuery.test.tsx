import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useOrderHistoryQuery } from "./useOrders";

const mockRows: Record<string, Record<string, any>[]> = {};
let mockItemReads = 0;
jest.mock("../../db", () => ({
  getDatabase: () => ({
    collections: {
      get: (table: string) => ({
        query: (...clauses: any[]) => ({
          observeWithColumns: () => ({
            subscribe: ({ next }: any) => {
              const Q = require("@nozbe/watermelondb/QueryDescription");
              const matcher = require("@nozbe/watermelondb/observation/encodeMatcher").default(
                Q.buildQueryDescription(clauses),
              );
              const rows = (mockRows[table] ?? []).filter((row) => matcher(row._raw));
              if (table === "order_items") mockItemReads += rows.length;
              next(rows);
              return { unsubscribe() {} };
            },
          }),
        }),
      }),
    },
  }),
}));
function row(values: Record<string, any>) {
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
it("hydrates only displayed history items after status, search and result limit", () => {
  mockRows.orders = Array.from({ length: 200 }, (_, i) =>
    row({
      id: `o${i}`,
      storeId: "s",
      createdAt: i,
      status: i % 2 ? "paid" : "voided",
      customerName: i < 100 ? "Other" : "Alice",
      netSales: 20,
    }),
  );
  mockRows.order_items = mockRows.orders.map((o) =>
    row({ id: `item-${o.id}`, orderId: o.id, quantity: 2, isVoided: false }),
  );
  mockRows.tables = [];
  mockItemReads = 0;
  let result: ReturnType<typeof useOrderHistoryQuery>;
  function Probe({ search }: { search: string }) {
    result = useOrderHistoryQuery({
      storeId: "s" as any,
      startDate: 0,
      endDate: 200,
      search,
      status: "paid",
      limit: 3,
    });
    return null;
  }
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(<Probe search="alice" />);
  });
  expect(result?.map((o) => o._id)).toEqual(["o199", "o197", "o195"]);
  expect(result?.map((o) => o.itemCount)).toEqual([2, 2, 2]);
  expect(mockItemReads).toBe(3);
  mockItemReads = 0;
  act(() => tree.update(<Probe search="Other" />));
  expect(result?.map((o) => o._id)).toEqual(["o99", "o97", "o95"]);
  expect(mockItemReads).toBe(3);
  act(() => tree.unmount());
});
