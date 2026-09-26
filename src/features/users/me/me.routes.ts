import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";

import { requireAuth } from "../../../platform/auth/guard";
import { requirePrincipal } from "../../../platform/auth/principal";
import { systemClock, type Clock } from "../../../platform/clock/clock";
import { databaseFrom } from "../../../platform/db/request";
import { AppError } from "../../../platform/errors/app-error";
import { idempotent } from "../../../platform/http/idempotency";
import type { OperationMetadata } from "../../../platform/http/openapi";
import { captureRawJson, rawJsonOf } from "../../../platform/http/raw-body";
import type { AppEnv } from "../../../platform/http/types";
import { fieldOf, rejectUnknownKeys } from "../../../platform/http/validation";
import { ErrorCode } from "../../../shared/error-codes";
import {
  meEnvelopeSchema,
  patchMeRequestSchema,
  type PatchMeProfile,
} from "../../../shared/contract/users";
import { loadMe, updateMeProfile, type ProfilePatch } from "./me";
import { toMePayload } from "./payload";

const IDEMPOTENCY_KEY_PARAM = z.object({
  "Idempotency-Key": z.string().min(1).max(128).optional().meta({
    description:
      "Idempotency key for safe retries of write requests. Replays return `Idempotency-Replayed: true`.",
  }),
});

const PROFILE_FIELDS = ["displayName", "givenName", "familyName"] as const;

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

export const meOperations: readonly OperationMetadata[] = [
  {
    method: "get",
    path: "/v1/me",
    operationId: "users.me.get",
    errorCodes: [ErrorCode.UNAUTHORIZED, ErrorCode.INTERNAL],
  },
  {
    method: "patch",
    path: "/v1/me",
    operationId: "users.me.patch",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ErrorCode.CONFLICT,
      ErrorCode.INTERNAL,
    ],
  },
];

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
  const principal = requirePrincipal(context);
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
    const principal = requirePrincipal(context);
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

export type MeRouteDependencies = Readonly<{ clock?: Clock }>;

export function registerMeRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: MeRouteDependencies = {},
): void {
  const clock = dependencies.clock ?? systemClock;

  app.use("/v1/me", captureRawJson());
  app.use("/v1/me", requireAuth(clock));
  app.use(
    "/v1/me",
    onlyMethod("PATCH", idempotent({ scopeKey: "users.me.patch" })),
  );

  app.openapi(meRoute, meHandler);
  app.openapi(patchMeRoute, createPatchMeHandler(clock));
}
