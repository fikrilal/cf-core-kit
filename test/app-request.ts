import { env } from "cloudflare:workers";
import type { Hono } from "hono";

import type { AppEnv } from "../src/platform/http/types";

export function send(
  app: Hono<AppEnv>,
  input: string | Request,
  init?: RequestInit,
) {
  return app.request(input, init, env);
}
