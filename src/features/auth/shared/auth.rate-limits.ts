import type { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "../../../platform/http/types";
import {
  requireRateLimit,
  type LimiterFactory,
  type RateLimitPolicy,
} from "../../../platform/rate-limit/require-rate-limit";

export type AuthRateLimitTarget = "exchange" | "connect" | "refresh" | "logout";

export type AuthRateLimits = Readonly<
  Record<AuthRateLimitTarget, RateLimitPolicy>
>;

const DEFAULT_RATE_LIMITS: AuthRateLimits = {
  exchange: { name: "auth.oidc.exchange", limit: 20, windowSeconds: 60 },
  connect: { name: "auth.oidc.connect", limit: 20, windowSeconds: 60 },
  refresh: { name: "auth.refresh", limit: 60, windowSeconds: 60 },
  logout: { name: "auth.logout", limit: 60, windowSeconds: 60 },
};

function resolveRateLimits(
  overrides: Partial<AuthRateLimits> | undefined,
): AuthRateLimits {
  return {
    exchange: overrides?.exchange ?? DEFAULT_RATE_LIMITS.exchange,
    connect: overrides?.connect ?? DEFAULT_RATE_LIMITS.connect,
    refresh: overrides?.refresh ?? DEFAULT_RATE_LIMITS.refresh,
    logout: overrides?.logout ?? DEFAULT_RATE_LIMITS.logout,
  };
}

export function registerAuthRateLimits(
  app: OpenAPIHono<AppEnv>,
  overrides: Partial<AuthRateLimits> | undefined,
  limiterFactory: LimiterFactory,
): void {
  const rateLimits = resolveRateLimits(overrides);

  app.use(
    "/v1/auth/oidc/exchange",
    requireRateLimit(rateLimits.exchange, limiterFactory),
  );
  app.use(
    "/v1/auth/oidc/connect",
    requireRateLimit(rateLimits.connect, limiterFactory),
  );
  app.use(
    "/v1/auth/refresh",
    requireRateLimit(rateLimits.refresh, limiterFactory),
  );
  app.use(
    "/v1/auth/logout",
    requireRateLimit(rateLimits.logout, limiterFactory),
  );
}
