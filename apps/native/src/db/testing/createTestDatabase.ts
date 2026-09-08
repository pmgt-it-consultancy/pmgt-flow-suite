import { Database } from "@nozbe/watermelondb";
import LokiJSAdapter from "@nozbe/watermelondb/adapters/lokijs";
import * as Models from "../models";
import { watermelonSchema } from "../schema";

/** Real WatermelonDB model/writer semantics with an in-memory test adapter. */
export function createTestDatabase(): Database {
  return new Database({
    adapter: new LokiJSAdapter({
      schema: watermelonSchema,
      useWebWorker: false,
      useIncrementalIndexedDB: true,
      extraLokiOptions: { autosave: false },
    }),
    modelClasses: Object.values(Models),
  });
}
