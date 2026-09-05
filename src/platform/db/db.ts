import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema";

export type Database = DrizzleD1Database<typeof schema>;

export function createDb(binding: D1Database): Database {
  return drizzle(binding, { schema });
}

export function runBatch<
  T extends readonly [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
>(db: Database, statements: T): Promise<BatchResponse<T>> {
  return db.batch(statements);
}
