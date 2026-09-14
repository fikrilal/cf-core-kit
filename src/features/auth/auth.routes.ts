import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";
import { z } from "zod";

import { systemClock, type Clock } from "../../platform/clock/clock";
import { configFrom } from "../../platform/config/request";
import { databaseFrom } from "../../platform/db/request";
import { requireAuth } from "../../platform/auth/guard";
import { getKeyRing } from "../../platform/auth/keys";
import {
  durableObjectLimiterFactory,
  type LimiterFactory,
} from "../../platform/rate-limit/require-rate-limit";
import {
  registerAuthRateLimits,
  type AuthRateLimits,
} from "./auth.rate-limits";
import { noContent } from "../../platform/http/envelope";
import { captureRawJson, rawJsonOf } from "../../platform/http/raw-body";
import { rejectUnknownKeys } from "../../platform/http/validation";
import { idempotent } from "../../platform/http/idempotency";
import type { OperationMetadata } from "../../platform/http/openapi";
import type { AppEnv } from "../../platform/http/types";
import { AppError } from "../../platform/errors/app-error";
import {
  authResultEnvelopeSchema,
  authResultWithMeEnvelopeSchema,
  jwksResponseSchema,
  logoutRequestSchema,
  oidcConnectRequestSchema,
  oidcExchangeRequestSchema,
  refreshRequestSchema,
} from "../../shared/contract/auth";
import { ErrorCode } from "../../shared/error-codes";
import { connectOidc, exchangeOidc } from "./oidc.service";
import { createDefaultIdTokenVerifier, type IdTokenVerifier } from "./oidc";
import { logoutSession, refreshSession } from "./session.service";

const IDEMPOTENCY_KEY_PARAM = z.object({
  "Idempotency-Key": z.string().min(1).max(128).optional().meta({
    description: "Idempotency key for safe retries of write requests.",
  }),
});

const exchangeRoute = createRoute({
  method: "post",
  path: "/v1/auth/oidc/exchange",
  operationId: "auth.oidc.exchange",
  tags: ["Auth"],
  summary: "Exchange OIDC id_token",
  description:
    "Verifies an OIDC id_token (e.g., Google) and issues first-party access + refresh tokens. Does not auto-link to an existing password account purely by email.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: oidcExchangeRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "",
      content: {
        "application/json": { schema: authResultWithMeEnvelopeSchema },
      },
    },
  },
});

const connectRoute = createRoute({
  method: "post",
  path: "/v1/auth/oidc/connect",
  operationId: "auth.oidc.connect",
  tags: ["Auth"],
  summary: "Connect OIDC identity (current user)",
  description:
    "Links an OIDC identity (e.g., Google) to the authenticated user. If the OIDC email matches the user email, the user email is marked verified.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: oidcConnectRequestSchema } },
    },
    headers: IDEMPOTENCY_KEY_PARAM,
  },
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

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

const jwksRoute = createRoute({
  method: "get",
  path: "/.well-known/jwks.json",
  operationId: "auth.jwks.get",
  tags: ["Auth"],
  summary: "JWKS",
  description: "Publishes public keys used to verify access tokens.",
  responses: {
    200: {
      description: "",
      content: { "application/json": { schema: jwksResponseSchema } },
    },
  },
});

export const authOperations: readonly OperationMetadata[] = [
  {
    method: "post",
    path: "/v1/auth/oidc/exchange",
    operationId: "auth.oidc.exchange",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.AUTH_OIDC_NOT_CONFIGURED,
      ErrorCode.AUTH_OIDC_TOKEN_INVALID,
      ErrorCode.AUTH_OIDC_EMAIL_NOT_VERIFIED,
      ErrorCode.AUTH_OIDC_LINK_REQUIRED,
      ErrorCode.AUTH_USER_SUSPENDED,
      ErrorCode.INTERNAL,
    ],
  },
  {
    method: "post",
    path: "/v1/auth/oidc/connect",
    operationId: "auth.oidc.connect",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ErrorCode.CONFLICT,
      ErrorCode.AUTH_OIDC_NOT_CONFIGURED,
      ErrorCode.AUTH_OIDC_TOKEN_INVALID,
      ErrorCode.AUTH_OIDC_EMAIL_NOT_VERIFIED,
      ErrorCode.AUTH_OIDC_IDENTITY_ALREADY_LINKED,
      ErrorCode.AUTH_OIDC_PROVIDER_ALREADY_LINKED,
      ErrorCode.INTERNAL,
    ],
  },
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
  {
    method: "get",
    path: "/.well-known/jwks.json",
    operationId: "auth.jwks.get",
    errorCodes: [ErrorCode.INTERNAL],
  },
];

export type AuthRouteDependencies = Readonly<{
  verifier?: IdTokenVerifier;
  clock?: Clock;
  rateLimiterFactory?: LimiterFactory;
  rateLimits?: Partial<AuthRateLimits>;
}>;

function createExchangeHandler(
  verifier: IdTokenVerifier,
  clock: Clock,
): RouteHandler<typeof exchangeRoute, AppEnv> {
  return async (context) => {
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), [
      "provider",
      "idToken",
      "deviceId",
      "deviceName",
    ]);
    const result = await exchangeOidc(
      {
        db: databaseFrom(context),
        config: configFrom(context),
        clock,
        verifier,
      },
      {
        idToken: body.idToken,
        device: { id: body.deviceId, name: body.deviceName },
        ip: context.req.header("CF-Connecting-IP"),
        userAgent: context.req.header("User-Agent"),
      },
    );

    return context.json({ data: result }, 200);
  };
}

function createConnectHandler(
  verifier: IdTokenVerifier,
  clock: Clock,
): RouteHandler<typeof connectRoute, AppEnv> {
  return async (context) => {
    const principal = context.get("principal");
    if (principal === undefined) {
      throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
    }

    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["provider", "idToken"]);

    await connectOidc(
      {
        db: databaseFrom(context),
        config: configFrom(context),
        clock,
        verifier,
      },
      { idToken: body.idToken, userId: principal.userId },
    );

    return noContent();
  };
}

function createJwksHandler(): RouteHandler<typeof jwksRoute, AppEnv> {
  return async (context) => {
    const keyRing = await getKeyRing(configFrom(context));
    const keys = keyRing.publicKeys.map((entry) => entry.jwk);

    return context.json({ keys }, 200);
  };
}

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

    return context.json({ data: result }, 200);
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

export function registerAuthRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: AuthRouteDependencies = {},
): void {
  const verifier = dependencies.verifier ?? createDefaultIdTokenVerifier();
  const clock = dependencies.clock ?? systemClock;
  const limiterFactory =
    dependencies.rateLimiterFactory ?? durableObjectLimiterFactory();
  registerAuthRateLimits(app, dependencies.rateLimits, limiterFactory);

  app.use("/v1/auth/oidc/exchange", captureRawJson());
  app.use("/v1/auth/oidc/connect", captureRawJson());
  app.use("/v1/auth/refresh", captureRawJson());
  app.use("/v1/auth/logout", captureRawJson());

  app.openapi(exchangeRoute, createExchangeHandler(verifier, clock));

  app.use("/v1/auth/oidc/connect", requireAuth(clock));
  app.use(
    "/v1/auth/oidc/connect",
    idempotent({ scopeKey: "auth.oidc.connect" }),
  );
  app.openapi(connectRoute, createConnectHandler(verifier, clock));
  app.openapi(refreshRoute, createRefreshHandler(clock));
  app.openapi(logoutRoute, createLogoutHandler(clock));
  app.openapi(jwksRoute, createJwksHandler());
}
