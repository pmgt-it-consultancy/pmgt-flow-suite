import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Wiring guard: actual hook/modal lifecycle behavior is covered by their
// rendered suites. Parsing the screen avoids mocking its application hooks.
const source = ts.createSourceFile(
  "TakeoutOrderScreen.tsx",
  readFileSync(join(__dirname, "TakeoutOrderScreen.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function nodesMatching<T extends ts.Node>(guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node) => {
    if (guard(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
function propValue(component: string, prop: string, values: Record<string, unknown>) {
  const element = nodesMatching(ts.isJsxSelfClosingElement).find(
    (node) => node.tagName.getText(source) === component,
  )!;
  const attribute = element.attributes.properties.find(
    (node) => ts.isJsxAttribute(node) && node.name.getText(source) === prop,
  );
  if (
    !attribute ||
    !ts.isJsxAttribute(attribute) ||
    !attribute.initializer ||
    !ts.isJsxExpression(attribute.initializer)
  )
    throw new Error(`Missing ${component}.${prop}`);
  return new Function(
    ...Object.keys(values),
    `return (${attribute.initializer.expression!.getText(source)});`,
  )(...Object.values(values));
}

test("takeout requests only selected-product modifiers, including no selection", () => {
  const calls = nodesMatching(ts.isCallExpression);
  expect(calls.some((call) => call.expression.getText(source) === "useModifiersForStore")).toBe(
    false,
  );
  const call = calls.find((call) => call.expression.getText(source) === "useModifiersForProduct");
  expect(call).toBeDefined();
  const selectedId = new Function(
    "selectedProduct",
    `return (${call!.arguments[0].getText(source)});`,
  );
  expect(selectedId(null)).toBeUndefined();
  expect(selectedId({ id: "chosen-product" })).toBe("chosen-product");
});

test("takeout gates confirmation while modifiers load and routes resolved choices", () => {
  const values = {
    selectedProduct: { id: "p" },
    modifierGroups: undefined,
    isAddingItem: false,
    isSending: false,
  };
  expect(propValue("ModifierSelectionModal", "isLoading", values)).toBe(true);
  expect(propValue("AddItemModal", "visible", values)).toBe(false);
  expect(propValue("ModifierSelectionModal", "visible", { ...values, modifierGroups: [{}] })).toBe(
    true,
  );
  expect(propValue("AddItemModal", "visible", { ...values, modifierGroups: [] })).toBe(true);
  expect(propValue("ModifierSelectionModal", "visible", { ...values, modifierGroups: [] })).toBe(
    false,
  );
  expect(
    propValue("AddItemModal", "visible", { ...values, selectedProduct: null, modifierGroups: [] }),
  ).toBe(false);
});
