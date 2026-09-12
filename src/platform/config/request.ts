import type { Context } from "hono";

import type { AppEnv } from "../http/types";
import { getConfig, type AppConfig } from "./config";

export function configFrom(context: Context<AppEnv>): AppConfig {
  return getConfig(context.env);
}
