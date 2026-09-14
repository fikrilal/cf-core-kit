import type { Context, MiddlewareHandler } from "hono";

import type { AppEnv } from "./types";

export function captureRawJson(): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    try {
      const raw: unknown = await context.req.raw.clone().json();
      context.set("rawJson", raw);
    } catch {
      context.set("rawJson", undefined);
    }

    await next();
  };
}

export function rawJsonOf(context: Context<AppEnv>): unknown {
  return context.get("rawJson");
}
