import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";

import { requireAuth } from "../../platform/auth/guard";
import { requirePrincipal } from "../../platform/auth/principal";
import { assertAllowedOrFailOpen } from "../../platform/rate-limit/enforce";
import type { Clock } from "../../platform/clock/clock";
import { configFrom } from "../../platform/config/request";
import { sha256Base64Url } from "../../platform/crypto/crypto";
import { databaseFrom } from "../../platform/db/request";
import { createEmailPort, type EmailPort } from "../../platform/email/email";
import { noContent } from "../../platform/http/envelope";
import { captureRawJson, rawJsonOf } from "../../platform/http/raw-body";
import type { OperationMetadata } from "../../platform/http/openapi";
import type { AppEnv } from "../../platform/http/types";
import { rejectUnknownKeys } from "../../platform/http/validation";
import type { Logger } from "../../platform/logging/logger";
import { createLogger } from "../../platform/logging/logger";
import { queueFrom } from "../../platform/queue/request";
import type { LimiterFactory } from "../../platform/rate-limit/require-rate-limit";
import { AppError } from "../../platform/errors/app-error";
import { verifyEmailRequestSchema } from "../../shared/contract/auth";
import { ErrorCode } from "../../shared/error-codes";
import { createSendVerificationEmailProducer } from "./email-verification.jobs";
import { consumeEmailVerificationToken, findUserById } from "./repository";

export const verifyEmailRoute = createRoute({
  method: "post",
  path: "/v1/auth/email/verify",
  operationId: "auth.email.verify",
  tags: ["Auth"],
  summary: "Verify email",
  description: "Verifies a user email using a token sent via email.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: verifyEmailRequestSchema } },
    },
  },
  responses: {
    204: { description: "" },
  },
});

export const verifyEmailOperation: OperationMetadata = {
  method: "post",
  path: "/v1/auth/email/verify",
  operationId: "auth.email.verify",
  errorCodes: [
    ErrorCode.VALIDATION_FAILED,
    ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_INVALID,
    ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED,
    ErrorCode.INTERNAL,
  ],
};

export const resendVerificationEmailRoute = createRoute({
  method: "post",
  path: "/v1/auth/email/verification/resend",
  operationId: "auth.email.verification.resend",
  tags: ["Auth"],
  summary: "Resend verification email (current user)",
  description:
    "Sends a fresh email verification token to the authenticated user's email address. Callers can re-login afterwards to pick up the verified state.",
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const resendVerificationEmailOperation: OperationMetadata = {
  method: "post",
  path: "/v1/auth/email/verification/resend",
  operationId: "auth.email.verification.resend",
  errorCodes: [
    ErrorCode.UNAUTHORIZED,
    ErrorCode.RATE_LIMITED,
    ErrorCode.INTERNAL,
  ],
};

export function createVerifyEmailHandler(
  clock: Clock,
): RouteHandler<typeof verifyEmailRoute, AppEnv> {
  return async (context) => {
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["token"]);

    const outcome = await consumeEmailVerificationToken(databaseFrom(context), {
      tokenHash: await sha256Base64Url(body.token),
      now: clock.now(),
    });

    if (outcome === "token_invalid") {
      throw new AppError({
        status: 400,
        code: ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_INVALID,
        message: "Email verification token is invalid",
      });
    }
    if (outcome === "token_expired") {
      throw new AppError({
        status: 400,
        code: ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED,
        message: "Email verification token expired",
      });
    }

    return noContent();
  };
}

export const emailVerificationOperations: readonly OperationMetadata[] = [
  verifyEmailOperation,
  resendVerificationEmailOperation,
];

export type EmailVerificationRouteDependencies = Readonly<{
  clock: Clock;
  limiterFactory: LimiterFactory;
  email?: EmailPort;
  queue?: Queue;
}>;

export function registerEmailVerificationRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: EmailVerificationRouteDependencies,
): void {
  app.use("/v1/auth/email/verify", captureRawJson());
  app.use(
    "/v1/auth/email/verification/resend",
    requireAuth(dependencies.clock),
  );

  app.openapi(verifyEmailRoute, createVerifyEmailHandler(dependencies.clock));
  app.openapi(
    resendVerificationEmailRoute,
    createResendVerificationEmailHandler(dependencies),
  );
}

export type ResendVerificationEmailDependencies = Readonly<{
  clock: Clock;
  limiterFactory: LimiterFactory;
  logger?: Logger;
  email?: EmailPort;
  queue?: Queue;
}>;

export function createResendVerificationEmailHandler(
  dependencies: ResendVerificationEmailDependencies,
): RouteHandler<typeof resendVerificationEmailRoute, AppEnv> {
  return async (context) => {
    const config = configFrom(context);
    const logger = dependencies.logger ?? createLogger(config);
    const producer = createSendVerificationEmailProducer({
      queue: dependencies.queue ?? queueFrom(context),
      clock: dependencies.clock,
      email: dependencies.email ?? createEmailPort(config),
      logger,
    });

    if (!producer.isEnabled()) {
      throw new AppError({
        status: 500,
        code: ErrorCode.INTERNAL,
        message: "Email is not configured",
      });
    }

    const principal = requirePrincipal(context);
    const user = await findUserById(databaseFrom(context), principal.userId);
    if (user === undefined || user.status === "DELETED") {
      throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
    }
    if (user.emailVerifiedAt !== null) {
      return noContent();
    }

    const limiter = dependencies.limiterFactory(context);
    const ip = context.req.header("CF-Connecting-IP");
    if (ip !== undefined) {
      await assertAllowedOrFailOpen(context, limiter, {
        key: `auth.email.verification.resend:ip:${ip}`,
        limit: config.authEmailVerificationResendIpMaxAttempts,
        windowSeconds: config.authEmailVerificationResendIpWindowSeconds,
        blockSeconds: config.authEmailVerificationResendIpBlockSeconds,
      });
    }
    await assertAllowedOrFailOpen(context, limiter, {
      key: `auth.email.verification.resend:user:${principal.userId}`,
      limit: 1,
      windowSeconds: config.authEmailVerificationResendCooldownSeconds,
    });

    const enqueued = await producer.enqueueSendVerificationEmail({
      userId: principal.userId,
      requestedAt: dependencies.clock.now().toISOString(),
    });
    if (!enqueued) {
      throw new AppError({
        status: 500,
        code: ErrorCode.INTERNAL,
        message: "Email is not configured",
      });
    }

    return noContent();
  };
}
