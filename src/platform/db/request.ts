import type { Context } from "hono";

import type { AppEnv } from "../http/types";
import { createDb, type Database } from "./db";

export function databaseFrom(context: Context<AppEnv>): Database {
  return createDb(context.env.DB);
}
