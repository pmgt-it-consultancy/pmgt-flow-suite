import { describe, expect, it } from "vitest";
import { buildModifiersByProduct } from "../useModifiers";

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: "group-1",
    isActive: true,
    name: "Size",
    selectionType: "single",
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    storeId: "store-1",
    ...overrides,
  } as any;
}

function makeOption(overrides: Record<string, unknown> = {}) {
  return {
    id: "opt-1",
    isAvailable: true,
    modifierGroupId: "group-1",
    name: "Large",
    priceAdjustment: 50,
    isDefault: false,
    sortOrder: 0,
    ...overrides,
  } as any;
}

function makeAssignment(overrides: Record<string, unknown> = {}) {
  return {
    modifierGroupId: "group-1",
    sortOrder: 0,
    ...overrides,
  } as any;
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    storeId: "store-1",
    categoryId: "cat-1",
    ...overrides,
  } as any;
}

function makeCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: "cat-1",
    storeId: "store-1",
    parentId: null,
    ...overrides,
  } as any;
}

describe("buildModifiersByProduct", () => {
  it("returns empty map for empty inputs", () => {
    const result = buildModifiersByProduct([], [], [], "store-1");
    expect(result.size).toBe(0);
  });

  it("maps product-level assignment to correct product", () => {
    const groups = [makeGroup()];
    const options = [makeOption()];
    const assignments = [makeAssignment({ productId: "prod-1" })];
    const products = [makeProduct()];
    const categories = [makeCategory()];

    const result = buildModifiersByProduct(
      groups,
      options,
      assignments,
      "store-1",
      products,
      categories,
    );

    expect(result.size).toBe(1);
    const entry = result.get("prod-1");
    expect(entry).toBeDefined();
    expect(entry![0].groupId).toBe("group-1");
    expect(entry![0].groupName).toBe("Size");
    expect(entry![0].options).toHaveLength(1);
    expect(entry![0].options[0].optionId).toBe("opt-1");
  });

  it("resolves category-inherited assignment via ancestor chain", () => {
    const parentCategory = makeCategory({ id: "cat-parent", parentId: null });
    const childCategory = makeCategory({ id: "cat-child", parentId: "cat-parent" });
    const groups = [makeGroup()];
    const options = [makeOption()];
    const assignments = [makeAssignment({ categoryId: "cat-parent" })];
    const products = [makeProduct({ categoryId: "cat-child" })];
    const categories = [parentCategory, childCategory];

    const result = buildModifiersByProduct(
      groups,
      options,
      assignments,
      "store-1",
      products,
      categories,
    );

    expect(result.size).toBe(1);
    const entry = result.get("prod-1");
    expect(entry).toBeDefined();
    expect(entry![0].groupId).toBe("group-1");
  });

  it("filters products not belonging to the store", () => {
    const groups = [makeGroup()];
    const options = [makeOption()];
    const assignments = [makeAssignment({ productId: "prod-1" })];
    const products = [makeProduct({ storeId: "other-store" })];
    const categories = [makeCategory()];

    const result = buildModifiersByProduct(
      groups,
      options,
      assignments,
      "store-1",
      products,
      categories,
    );

    expect(result.size).toBe(0);
  });

  it("skips inactive groups", () => {
    const groups = [makeGroup({ isActive: false })];
    const options = [makeOption()];
    const assignments = [makeAssignment({ productId: "prod-1" })];
    const products = [makeProduct()];
    const categories = [makeCategory()];

    const result = buildModifiersByProduct(
      groups,
      options,
      assignments,
      "store-1",
      products,
      categories,
    );

    expect(result.size).toBe(0);
  });

  it("skips unavailable options", () => {
    const groups = [makeGroup()];
    const options = [makeOption({ isAvailable: false })];
    const assignments = [makeAssignment({ productId: "prod-1" })];
    const products = [makeProduct()];
    const categories = [makeCategory()];

    const result = buildModifiersByProduct(
      groups,
      options,
      assignments,
      "store-1",
      products,
      categories,
    );

    expect(result.size).toBe(1);
    expect(result.get("prod-1")![0].options).toHaveLength(0);
  });

  it("applies override minSelections and maxSelections from assignment", () => {
    const groups = [makeGroup({ minSelections: 1, maxSelections: 3 })];
    const options = [makeOption()];
    const assignments = [
      makeAssignment({ productId: "prod-1", minSelectionsOverride: 2, maxSelectionsOverride: 5 }),
    ];
    const products = [makeProduct()];
    const categories = [makeCategory()];

    const result = buildModifiersByProduct(
      groups,
      options,
      assignments,
      "store-1",
      products,
      categories,
    );

    expect(result.size).toBe(1);
    const entry = result.get("prod-1")![0];
    expect(entry.minSelections).toBe(2);
    expect(entry.maxSelections).toBe(5);
  });
});
