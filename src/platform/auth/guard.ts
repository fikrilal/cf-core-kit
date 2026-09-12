import type { MiddlewareHandler } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import { getConfig } from "../config/config";
import type { Clock } from "../clock/clock";
import { systemClock } from "../clock/clock";
import { AppError } from "../errors/app-error";
import type { AppEnv } from "../http/types";
import { verifyAccessToken } from "./access-token";
import { getKeyRing } from "./keys";

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function extractBearerToken(
  header: string | undefined,
): string | undefined {
  if (header === undefined) return undefined;

  return BEARER_PATTERN.exec(header.trim())?.[1];
}

export function requireAuth(
  clock: Clock = systemClock,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const token = extractBearerToken(context.req.header("Authorization"));

    if (token === undefined) {
      throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
    }

    const config = getConfig(context.env);
    const keyRing = await getKeyRing(config);
    const principal = await verifyAccessToken({
      token,
      keyRing,
      now: clock.now(),
      issuer: config.authIssuer,
      audience: config.authAudience,
    });

    if (principal === undefined) {
      throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
    }

    context.set("principalId", principal.userId);
    context.set("principal", principal);

    await next();
  };
}
