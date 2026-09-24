import type { Context, MiddlewareHandler } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import { logRequestError } from "../http/request-logging";
import type { AppEnv } from "../http/types";
import type { RateLimitDecision, RateLimitRequest } from "./rate-limiter";

export type RateLimitPolicy = Readonly<{
  name: string;
  limit: number;
  windowSeconds: number;
  blockSeconds?: number;
}>;

export type RateLimiterPort = (
  input: RateLimitRequest,
) => Promise<RateLimitDecision>;

export type LimiterFactory = (context: Context<AppEnv>) => RateLimiterPort;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDecision(value: unknown): RateLimitDecision {
  if (!isRecord(value))
    throw new Error("rate limiter returned an invalid decision");

  const allowed = value.allowed;
  const retryAfterSeconds = value.retryAfterSeconds;

  if (typeof allowed !== "boolean" || typeof retryAfterSeconds !== "number") {
    throw new Error("rate limiter returned an invalid decision");
  }

  return { allowed, retryAfterSeconds };
}

export function createDurableObjectLimiter(
  namespace: DurableObjectNamespace,
): RateLimiterPort {
  return async (input) => {
    const stub = namespace.get(namespace.idFromName(input.key));
    const response = await stub.fetch("https://auth-rate-limiter/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(
        `rate limiter responded with status ${String(response.status)}`,
      );
    }

    const decision: unknown = await response.json();

    return readDecision(decision);
  };
}

export function durableObjectLimiterFactory(): LimiterFactory {
  return (context) => createDurableObjectLimiter(context.env.AUTH_RATE_LIMITER);
}

function defaultClientKey(context: Context<AppEnv>): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function requireRateLimit(
  policy: RateLimitPolicy,
  limiterFactory: LimiterFactory,
  clientKeyOf: (
    context: Context<AppEnv>,
  ) => string | undefined = defaultClientKey,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const clientKey = clientKeyOf(context);
    if (clientKey === undefined) {
      await next();

      return;
    }

    let decision: RateLimitDecision;

    try {
      const evaluated = await limiterFactory(context)({
        key: `${policy.name}:${clientKey}`,
        limit: policy.limit,
        windowSeconds: policy.windowSeconds,
        ...(policy.blockSeconds === undefined
          ? {}
          : { blockSeconds: policy.blockSeconds }),
      });

      if (typeof evaluated.allowed !== "boolean") {
        throw new Error("rate limiter returned an invalid decision");
      }
      if (!Number.isFinite(evaluated.retryAfterSeconds)) {
        throw new Error("rate limiter returned an invalid decision");
      }

      decision = evaluated;
    } catch (error) {
      logRequestError(context, error);
      await next();

      return;
    }

    if (!decision.allowed) {
      throw new AppError({
        status: 429,
        code: ErrorCode.RATE_LIMITED,
        retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterSeconds)),
      });
    }

    await next();
  };
}
