import type { Context, MiddlewareHandler } from "hono";

import type { AppEnv } from "./types";

const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function normalizeRequestId(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  if (value.length > MAX_REQUEST_ID_LENGTH) {
    return undefined;
  }

  if (!REQUEST_ID_PATTERN.test(value)) {
    return undefined;
  }

  return value;
}

export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (
  context,
  next,
) => {
  const requestId =
    normalizeRequestId(context.req.header("x-request-id")) ??
    crypto.randomUUID();

  context.set("requestId", requestId);
  await next();
  context.res.headers.set("X-Request-Id", requestId);
};

export function getRequestId(context: Context<AppEnv>): string {
  return context.get("requestId");
}
