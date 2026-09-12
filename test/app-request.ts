import { env } from "cloudflare:workers";
import type { Hono } from "hono";

import type { ConfigInput } from "../src/platform/config/config";
import type { AppEnv } from "../src/platform/http/types";

export type RuntimeEnv = Env & ConfigInput;

export function send(
  app: Hono<AppEnv>,
  input: string | Request,
  init?: RequestInit,
  runtimeEnv: RuntimeEnv = env,
) {
  return app.request(input, init, runtimeEnv);
}
