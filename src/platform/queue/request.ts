import type { Context } from "hono";

import type { AppEnv } from "../http/types";

export function queueFrom(context: Context<AppEnv>): Queue {
  return context.env.JOBS;
}
