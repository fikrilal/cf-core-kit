import type { Context, MiddlewareHandler } from "hono";

import { getConfig } from "../config/config";
import { AppError } from "../errors/app-error";
import { createLogger } from "../logging/logger";
import type { AppEnv } from "./types";

export type RequestLoggingOptions = Readonly<{
  skipPaths?: readonly string[];
}>;

const DEFAULT_SKIP_PATHS: readonly string[] = ["/health", "/ready"];

function requestLogFields(
  context: Context<AppEnv>,
  status: number,
  durationMs: number,
) {
  return {
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    status,
    durationMs,
    requestId: context.get("requestId"),
  };
}

export function requestLogging(
  options: RequestLoggingOptions = {},
): MiddlewareHandler<AppEnv> {
  const skipPaths = options.skipPaths ?? DEFAULT_SKIP_PATHS;

  return async (context, next) => {
    const path = new URL(context.req.url).pathname;
    const start = Date.now();

    await next();

    if (context.error !== undefined) return;
    if (skipPaths.includes(path)) return;

    const logger = createLogger(getConfig(context.env));
    const fields = requestLogFields(
      context,
      context.res.status,
      Date.now() - start,
    );

    if (context.res.status >= 500) {
      logger.error("request", fields);
      return;
    }

    if (context.res.status >= 400) {
      logger.warn("request", fields);
      return;
    }

    logger.info("request", fields);
  };
}

export function logRequestError(
  context: Context<AppEnv>,
  error: unknown,
): void {
  const logger = createLogger(getConfig(context.env));
  const status = error instanceof AppError ? error.status : 500;
  const fields = {
    ...requestLogFields(context, status, 0),
    ...(error instanceof AppError
      ? {
          ...(error.message.length === 0 ? {} : { error: error.message }),
          code: error.code,
        }
      : { error: error instanceof Error ? error.message : "unknown error" }),
    ...(error instanceof Error &&
    !(error instanceof AppError) &&
    error.stack !== undefined
      ? { stack: error.stack }
      : {}),
  };

  if (status >= 500) {
    logger.error("request error", fields);
    return;
  }

  logger.warn("request error", fields);
}
