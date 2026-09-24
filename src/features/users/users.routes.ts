import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import { requireAuth } from "../../platform/auth/guard";
import { readListQuery } from "../../platform/http/list-query";
import { systemClock, type Clock } from "../../platform/clock/clock";
import { databaseFrom } from "../../platform/db/request";
import {
  durableObjectLimiterFactory,
  type LimiterFactory,
} from "../../platform/rate-limit/require-rate-limit";
import { AppError } from "../../platform/errors/app-error";
import { idempotent } from "../../platform/http/idempotency";
import { listPayload, noContent } from "../../platform/http/envelope";

import type { AppEnv } from "../../platform/http/types";
import { captureRawJson, rawJsonOf } from "../../platform/http/raw-body";
import { fieldOf, rejectUnknownKeys } from "../../platform/http/validation";
import { ErrorCode } from "../../shared/error-codes";
import {
  meEnvelopeSchema,
  meSessionsListEnvelopeSchema,
  patchMeRequestSchema,
  type PatchMeProfile,
} from "../../shared/contract/users";
import type { ListQueryOptions } from "../../shared/list-query";
import type { AccessTokenPrincipal } from "../../platform/auth/access-token";
import {
  listUserSessions,
  revokeUserSession,
  type SessionSortField,
} from "../auth/index";
import { loadMe, updateMeProfile, type ProfilePatch } from "./me";
import { registerAccountDeletionRoutes } from "./account-deletion.routes";
import { registerProfileImageRoutes } from "./profile-image.routes";

import { toMePayload } from "./payload";

const IDEMPOTENCY_KEY_PARAM = z.object({
  "Idempotency-Key": z.string().min(1).max(128).optional().meta({
    description:
      "Idempotency key for safe retries of write requests. Replays return `Idempotency-Replayed: true`.",
  }),
});

const meRoute = createRoute({
  method: "get",
  path: "/v1/me",
  operationId: "users.me.get",
  tags: ["Users"],
  summary: "Get current user",
  description: "Returns the authenticated user profile.",
  responses: {
    200: {
      description: "",
      content: { "application/json": { schema: meEnvelopeSchema } },
    },
  },
  security: [{ "access-token": [] }],
});

const patchMeRoute = createRoute({
  method: "patch",
  path: "/v1/me",
  operationId: "users.me.patch",
  tags: ["Users"],
  summary: "Update current user profile",
  description:
    "Partially updates the authenticated user profile. Omitted fields are unchanged; null clears a field.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: patchMeRequestSchema } },
    },
    headers: IDEMPOTENCY_KEY_PARAM,
  },
  responses: {
    200: {
      description: "",
      content: { "application/json": { schema: meEnvelopeSchema } },
    },
  },
  security: [{ "access-token": [] }],
});

const SESSIONS_QUERY_OPTIONS: ListQueryOptions<SessionSortField, never> = {
  defaultLimit: 25,
  maxLimit: 100,
  sort: {
    allowed: { createdAt: { type: "datetime" }, id: { type: "uuid" } },
    default: [{ field: "createdAt", direction: "desc" }],
    tieBreaker: { field: "id", direction: "desc" },
  },
};

export type UsersRouteDependencies = Readonly<{
  clock?: Clock;
  rateLimiterFactory?: LimiterFactory;
  queue?: Queue;
}>;

const PROFILE_FIELDS = ["displayName", "givenName", "familyName"] as const;

function principalOf(context: Context<AppEnv>): AccessTokenPrincipal {
  const principal = context.get("principal");
  if (principal === undefined) {
    throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
  }

  return principal;
}

function sanitizeProfile(profile: PatchMeProfile): ProfilePatch {
  const patch: {
    displayName?: string | null;
    givenName?: string | null;
    familyName?: string | null;
  } = {};

  for (const field of PROFILE_FIELDS) {
    const value = profile[field];
    if (value === undefined) continue;

    if (value === null) {
      patch[field] = null;
      continue;
    }

    const trimmed = value.trim();
    if (trimmed === "") {
      throw new AppError({
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        issues: [{ field: `profile.${field}`, message: "must not be empty" }],
      });
    }

    patch[field] = trimmed;
  }

  return patch;
}

function onlyMethod(
  method: string,
  middleware: MiddlewareHandler<AppEnv>,
): MiddlewareHandler<AppEnv> {
  return async (context, next) =>
    context.req.method === method ? middleware(context, next) : next();
}

const meHandler: RouteHandler<typeof meRoute, AppEnv> = async (context) => {
  const principal = principalOf(context);
  const me = await loadMe(databaseFrom(context), principal.userId);

  if (me === undefined) {
    throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
  }

  return context.json({ data: toMePayload(me) }, 200);
};

function createPatchMeHandler(
  clock: Clock,
): RouteHandler<typeof patchMeRoute, AppEnv> {
  return async (context) => {
    const principal = principalOf(context);
    const raw = rawJsonOf(context);
    const body = context.req.valid("json");

    rejectUnknownKeys(raw, ["profile"]);
    rejectUnknownKeys(fieldOf(raw, "profile"), [...PROFILE_FIELDS], "profile.");

    const me = await updateMeProfile(
      databaseFrom(context),
      principal.userId,
      sanitizeProfile(body.profile),
      clock.now(),
    );

    if (me === undefined) {
      throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
    }

    return context.json({ data: toMePayload(me) }, 200);
  };
}

function createSessionsListHandler(
  clock: Clock,
): RouteHandler<typeof sessionsListRoute, AppEnv> {
  return async (context) => {
    const principal = principalOf(context);
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
    const principal = principalOf(context);
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

export function registerUsersRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: UsersRouteDependencies = {},
): void {
  const clock = dependencies.clock ?? systemClock;
  const limiterFactory =
    dependencies.rateLimiterFactory ?? durableObjectLimiterFactory();

  app.use("/v1/me", captureRawJson());
  app.use("/v1/me", requireAuth(clock));
  app.use(
    "/v1/me",
    onlyMethod("PATCH", idempotent({ scopeKey: "users.me.patch" })),
  );
  app.use("/v1/me/sessions", requireAuth(clock));
  app.use("/v1/me/sessions/:sessionId/revoke", requireAuth(clock));

  registerProfileImageRoutes(app, {
    clock,
    limiterFactory,
    queue: dependencies.queue,
  });
  registerAccountDeletionRoutes(app, { clock });

  app.openapi(meRoute, meHandler);
  app.openapi(patchMeRoute, createPatchMeHandler(clock));
  app.openapi(sessionsListRoute, createSessionsListHandler(clock));
  app.openapi(sessionRevokeRoute, createSessionRevokeHandler(clock));
}

export { usersOperations } from "./users.operations";
