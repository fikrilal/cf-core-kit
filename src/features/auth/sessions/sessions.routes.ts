import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";
import { z } from "zod";

import { requireAuth } from "../../../platform/auth/guard";
import { requirePrincipal } from "../../../platform/auth/principal";
import type { Clock } from "../../../platform/clock/clock";
import { databaseFrom } from "../../../platform/db/request";
import { listPayload, noContent } from "../../../platform/http/envelope";
import { readListQuery } from "../../../platform/http/list-query";
import type {
  OperationMetadata,
  OperationParameter,
} from "../../../platform/http/openapi";
import type { AppEnv } from "../../../platform/http/types";
import { AppError } from "../../../platform/errors/app-error";
import { ErrorCode } from "../../../shared/error-codes";
import { meSessionsListEnvelopeSchema } from "../../../shared/contract/users";
import type { ListQueryOptions } from "../../../shared/list-query";
import {
  listUserSessions,
  revokeUserSession,
  type SessionSortField,
} from "./sessions.service";

const SESSIONS_QUERY_OPTIONS: ListQueryOptions<SessionSortField, never> = {
  defaultLimit: 25,
  maxLimit: 100,
  sort: {
    allowed: { createdAt: { type: "datetime" }, id: { type: "uuid" } },
    default: [{ field: "createdAt", direction: "desc" }],
    tieBreaker: { field: "id", direction: "desc" },
  },
};

const SESSION_LIST_PARAMETERS: readonly OperationParameter[] = [
  {
    name: "limit",
    in: "query",
    required: false,
    description: "Max results to return (default 25, max 100).",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
  {
    name: "cursor",
    in: "query",
    required: false,
    description: "Opaque cursor from the previous response meta.nextCursor.",
    schema: { type: "string" },
  },
  {
    name: "sort",
    in: "query",
    required: false,
    description:
      'Comma-separated fields; prefix "-" for descending. Max 3 fields. Default: "-createdAt". Allowed: createdAt, id',
    schema: { type: "string", example: "-createdAt" },
  },
];

const sessionsListRoute = createRoute({
  method: "get",
  path: "/v1/me/sessions",
  operationId: "users.me.sessions.list",
  tags: ["Users"],
  summary: "List current user sessions",
  description:
    "Lists all sessions (active, revoked, expired) for the authenticated user. Revoked sessions have refresh tokens revoked; access tokens remain valid until expiry.",
  responses: {
    200: {
      description: "",
      content: {
        "application/json": { schema: meSessionsListEnvelopeSchema },
      },
    },
  },
  security: [{ "access-token": [] }],
});

const sessionRevokeRoute = createRoute({
  method: "post",
  path: "/v1/me/sessions/{sessionId}/revoke",
  operationId: "users.me.sessions.revoke",
  tags: ["Users"],
  summary: "Revoke a session (current user)",
  description: "Revokes the given session and its refresh tokens. Idempotent.",
  request: {
    params: z.object({
      sessionId: z
        .string()
        .meta({ example: "3d2c7b2a-2dd6-46a5-8f8e-3b5de8a5b0f0" }),
    }),
  },
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const sessionsOperations: readonly OperationMetadata[] = [
  {
    method: "get",
    path: "/v1/me/sessions",
    operationId: "users.me.sessions.list",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.INTERNAL,
    ],
    parameters: SESSION_LIST_PARAMETERS,
  },
  {
    method: "post",
    path: "/v1/me/sessions/{sessionId}/revoke",
    operationId: "users.me.sessions.revoke",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.NOT_FOUND,
      ErrorCode.INTERNAL,
    ],
  },
];

function createSessionsListHandler(
  clock: Clock,
): RouteHandler<typeof sessionsListRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    const query = readListQuery(context, SESSIONS_QUERY_OPTIONS);
    const page = await listUserSessions({
      db: databaseFrom(context),
      userId: principal.userId,
      currentSessionId: principal.sessionId,
      query,
      now: clock.now(),
    });

    return context.json(listPayload(page), 200);
  };
}

function createSessionRevokeHandler(
  clock: Clock,
): RouteHandler<typeof sessionRevokeRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    const { sessionId } = context.req.valid("param");

    if (!z.uuid().safeParse(sessionId).success) {
      throw new AppError({
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        issues: [{ field: "sessionId", message: "must be a UUID" }],
      });
    }

    const revoked = await revokeUserSession({
      db: databaseFrom(context),
      userId: principal.userId,
      sessionId,
      now: clock.now(),
    });

    if (!revoked) {
      throw new AppError({
        status: 404,
        code: ErrorCode.NOT_FOUND,
        message: "Session not found",
      });
    }

    return noContent();
  };
}

export type SessionsRouteDependencies = Readonly<{ clock: Clock }>;

export function registerSessionsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: SessionsRouteDependencies,
): void {
  app.use("/v1/me/sessions", requireAuth(dependencies.clock));
  app.use("/v1/me/sessions/:sessionId/revoke", requireAuth(dependencies.clock));

  app.openapi(sessionsListRoute, createSessionsListHandler(dependencies.clock));
  app.openapi(
    sessionRevokeRoute,
    createSessionRevokeHandler(dependencies.clock),
  );
}
