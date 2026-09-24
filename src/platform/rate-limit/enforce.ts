import type { Context } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import { logRequestError } from "../http/request-logging";
import type { AppEnv } from "../http/types";
import type { RateLimiterPort } from "./require-rate-limit";
import type { RateLimitRequest } from "./rate-limiter";

export async function assertAllowedOrFailOpen(
  context: Context<AppEnv>,
  limiter: RateLimiterPort,
  input: RateLimitRequest,
): Promise<void> {
  let decision;

  try {
    decision = await limiter(input);
  } catch (error) {
    logRequestError(context, error);

    return;
  }

  if (!decision.allowed) {
    throw new AppError({
      status: 429,
      code: ErrorCode.RATE_LIMITED,
      retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterSeconds)),
    });
  }
}
