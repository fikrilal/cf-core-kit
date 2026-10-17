import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";

import type { Clock } from "../../../platform/clock/clock";
import { configFrom } from "../../../platform/config/request";
import { databaseFrom } from "../../../platform/db/request";
import { dataPayload, noContent } from "../../../platform/http/envelope";
import type { OperationMetadata } from "../../../platform/http/openapi";
import { captureRawJson, rawJsonOf } from "../../../platform/http/raw-body";
import type { AppEnv } from "../../../platform/http/types";
import { rejectUnknownKeys } from "../../../platform/http/validation";
import { getKeyRing } from "../../../platform/auth/keys";
import {
  authResultEnvelopeSchema,
  logoutRequestSchema,
  refreshRequestSchema,
} from "../../../shared/contract/auth";
import { ErrorCode } from "../../../shared/error-codes";
import { logoutSession, refreshSession } from "./session.service";

const refreshRoute = createRoute({
  method: "post",
  path: "/v1/auth/refresh",
  operationId: "auth.refresh",
  tags: ["Auth"],
  summary: "Refresh tokens",
  description:
    "Rotates the refresh token and returns a new access + refresh token.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: refreshRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "",
      content: { "application/json": { schema: authResultEnvelopeSchema } },
    },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/v1/auth/logout",
  operationId: "auth.logout",
  tags: ["Auth"],
  summary: "Logout",
  description:
    "Revokes the session associated with the provided refresh token.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: logoutRequestSchema } },
    },
  },
  responses: {
    204: { description: "" },
  },
});

export const sessionOperations: readonly OperationMetadata[] = [
  {
    method: "post",
    path: "/v1/auth/refresh",
    operationId: "auth.refresh",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
      ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED,
      ErrorCode.AUTH_REFRESH_TOKEN_REUSED,
      ErrorCode.AUTH_SESSION_REVOKED,
      ErrorCode.AUTH_USER_SUSPENDED,
      ErrorCode.INTERNAL,
    ],
  },
  {
    method: "post",
    path: "/v1/auth/logout",
    operationId: "auth.logout",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
      ErrorCode.INTERNAL,
    ],
  },
];

function createRefreshHandler(
  clock: Clock,
): RouteHandler<typeof refreshRoute, AppEnv> {
  return async (context) => {
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["refreshToken"]);
    const config = configFrom(context);
    const result = await refreshSession({
      db: databaseFrom(context),
      clock,
      config,
      keyRing: await getKeyRing(config),
      refreshToken: body.refreshToken,
      ip: context.req.header("CF-Connecting-IP"),
      userAgent: context.req.header("User-Agent"),
    });

    return context.json(dataPayload(result), 200);
  };
}

function createLogoutHandler(
  clock: Clock,
): RouteHandler<typeof logoutRoute, AppEnv> {
  return async (context) => {
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["refreshToken"]);

    await logoutSession({
      db: databaseFrom(context),
      clock,
      refreshToken: body.refreshToken,
    });

    return noContent();
  };
}

export type SessionRouteDependencies = Readonly<{ clock: Clock }>;

export function registerSessionRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: SessionRouteDependencies,
): void {
  app.use("/v1/auth/refresh", captureRawJson());
  app.use("/v1/auth/logout", captureRawJson());

  app.openapi(refreshRoute, createRefreshHandler(dependencies.clock));
  app.openapi(logoutRoute, createLogoutHandler(dependencies.clock));
}
