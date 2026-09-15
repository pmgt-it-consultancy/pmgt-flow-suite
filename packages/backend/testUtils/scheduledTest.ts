import { convexTest as createConvexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, vi } from "vitest";
import type schema from "../convex/schema";

const instances: TestConvex<typeof schema>[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  try {
    for (const instance of instances) {
      await instance.finishAllScheduledFunctions(vi.runAllTimers);
    }
  } finally {
    instances.length = 0;
    vi.useRealTimers();
  }
});

// Tests own the workers they schedule; drain them before the next database is created.
export function convexTest(
  definition: typeof schema,
  modules: Record<string, () => Promise<unknown>>,
) {
  const instance = createConvexTest(definition, modules);
  instances.push(instance);
  return instance;
}
