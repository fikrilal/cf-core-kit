import type { Context } from "hono";
import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";

import { requireAuth } from "../../platform/auth/guard";
import type { Clock } from "../../platform/clock/clock";
import { databaseFrom } from "../../platform/db/request";
import { noContent } from "../../platform/http/envelope";
import type { OperationMetadata } from "../../platform/http/openapi";
import type { AppEnv } from "../../platform/http/types";
import { captureRawJson, rawJsonOf } from "../../platform/http/raw-body";
import { rejectUnknownKeys } from "../../platform/http/validation";
import type { PushPort } from "../../platform/push/push";
import { requirePrincipal } from "../../platform/auth/principal";
import { AppError } from "../../platform/errors/app-error";
import { mePushTokenUpsertRequestSchema } from "../../shared/contract/users";
import { ErrorCode } from "../../shared/error-codes";
import {
  revokeSessionPushToken,
  upsertSessionPushToken,
} from "./push-token.repository";
import { findUserById } from "./repository";

export const pushTokenUpsertRoute = createRoute({
  method: "put",
  path: "/v1/me/push-token",
  operationId: "users.me.pushToken.upsert",
  tags: ["Users"],
  summary: "Register/update push token (current session)",
  description:
    "Stores the FCM registration token for the current session. Idempotent; replaces any existing token for the session.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: mePushTokenUpsertRequestSchema },
      },
    },
  },
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const pushTokenRevokeRoute = createRoute({
  method: "delete",
  path: "/v1/me/push-token",
  operationId: "users.me.pushToken.revoke",
  tags: ["Users"],
  summary: "Revoke push token (current session)",
  description:
    "Clears the stored push token for the current session. Idempotent.",
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const pushTokenOperations: readonly OperationMetadata[] = [
  {
    method: "put",
    path: "/v1/me/push-token",
    operationId: "users.me.pushToken.upsert",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.AUTH_PUSH_NOT_CONFIGURED,
      ErrorCode.INTERNAL,
    ],
  },
  {
    method: "delete",
    path: "/v1/me/push-token",
    operationId: "users.me.pushToken.revoke",
    errorCodes: [ErrorCode.UNAUTHORIZED, ErrorCode.INTERNAL],
  },
];

async function requireLiveUser(context: Context<AppEnv>, userId: string) {
  const user = await findUserById(databaseFrom(context), userId);

  if (user === undefined || user.status === "DELETED") {
    throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
  }

  return user;
}

export type PushTokenRouteDependencies = Readonly<{
  push: PushPort;
  clock: Clock;
}>;

export function createPushTokenUpsertHandler(
  dependencies: PushTokenRouteDependencies,
): RouteHandler<typeof pushTokenUpsertRoute, AppEnv> {
  return async (context) => {
    if (!dependencies.push.isEnabled()) {
      throw new AppError({
        status: 501,
        code: ErrorCode.AUTH_PUSH_NOT_CONFIGURED,
        message: "Push provider is not configured",
      });
    }

    const principal = requirePrincipal(context);
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["platform", "token"]);
    await requireLiveUser(context, principal.userId);

    const outcome = await upsertSessionPushToken(databaseFrom(context), {
      userId: principal.userId,
      sessionId: principal.sessionId,
      platform: body.platform,
      token: body.token,
      now: dependencies.clock.now(),
    });

    if (outcome === "session_not_found") {
      throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
    }

    return noContent();
  };
}

export function createPushTokenRevokeHandler(
  dependencies: PushTokenRouteDependencies,
): RouteHandler<typeof pushTokenRevokeRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    await requireLiveUser(context, principal.userId);

    await revokeSessionPushToken(databaseFrom(context), {
      userId: principal.userId,
      sessionId: principal.sessionId,
      now: dependencies.clock.now(),
    });

    return noContent();
  };
}

export function registerPushTokenRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: PushTokenRouteDependencies,
): void {
  app.use("/v1/me/push-token", captureRawJson());
  app.use("/v1/me/push-token", requireAuth(dependencies.clock));

  app.openapi(pushTokenUpsertRoute, createPushTokenUpsertHandler(dependencies));
  app.openapi(pushTokenRevokeRoute, createPushTokenRevokeHandler(dependencies));
}
