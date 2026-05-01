import { countRows } from "../SyncManager";
import type { ChangeBucket } from "../types";

describe("countRows", () => {
  const empty: ChangeBucket = { created: [], updated: [], deleted: [] };

  it("returns 0 + empty perTable for an empty change set", () => {
    expect(countRows({})).toEqual({ total: 0, perTable: {} });
  });

  it("sums created + updated + deleted across one table", () => {
    const changes: Record<string, ChangeBucket> = {
      products: {
        created: [{ id: "a" }, { id: "b" }],
        updated: [{ id: "c" }],
        deleted: ["d", "e"],
      },
    };
    expect(countRows(changes)).toEqual({
      total: 5,
      perTable: { products: 5 },
    });
  });

  it("sums across multiple tables and excludes empty tables from perTable", () => {
    const changes: Record<string, ChangeBucket> = {
      products: { created: [{ id: "a" }], updated: [], deleted: [] },
      categories: {
        created: [],
        updated: [{ id: "b" }, { id: "c" }],
        deleted: ["d"],
      },
      orders: empty,
    };
    expect(countRows(changes)).toEqual({
      total: 4,
      perTable: { products: 1, categories: 3 },
    });
  });

  it("tolerates an undefined deleted array", () => {
    const changes: Record<string, ChangeBucket> = {
      products: {
        created: [{ id: "a" }],
        updated: [],
        deleted: undefined as unknown as string[],
      },
    };
    expect(countRows(changes)).toEqual({
      total: 1,
      perTable: { products: 1 },
    });
  });
});
