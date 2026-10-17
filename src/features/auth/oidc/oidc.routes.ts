import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";
import { z } from "zod";

import { requireAuth } from "../../../platform/auth/guard";
import { requirePrincipal } from "../../../platform/auth/principal";
import type { Clock } from "../../../platform/clock/clock";
import { configFrom } from "../../../platform/config/request";
import { databaseFrom } from "../../../platform/db/request";
import { idempotent } from "../../../platform/http/idempotency";
import type { OperationMetadata } from "../../../platform/http/openapi";
import { captureRawJson, rawJsonOf } from "../../../platform/http/raw-body";
import { dataPayload, noContent } from "../../../platform/http/envelope";
import type { AppEnv } from "../../../platform/http/types";
import { rejectUnknownKeys } from "../../../platform/http/validation";
import {
  authResultWithMeEnvelopeSchema,
  oidcConnectRequestSchema,
  oidcExchangeRequestSchema,
} from "../../../shared/contract/auth";
import { ErrorCode } from "../../../shared/error-codes";
import { connectOidc, exchangeOidc } from "./oidc.service";
import type { IdTokenVerifier } from "./oidc";

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

export const oidcOperations: readonly OperationMetadata[] = [
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
];

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
        provider: body.provider,
        idToken: body.idToken,
        device: { id: body.deviceId, name: body.deviceName },
        ip: context.req.header("CF-Connecting-IP"),
        userAgent: context.req.header("User-Agent"),
      },
    );

    return context.json(dataPayload(result), 200);
  };
}

function createConnectHandler(
  verifier: IdTokenVerifier,
  clock: Clock,
): RouteHandler<typeof connectRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["provider", "idToken"]);

    await connectOidc(
      {
        db: databaseFrom(context),
        config: configFrom(context),
        clock,
        verifier,
      },
      {
        provider: body.provider,
        idToken: body.idToken,
        userId: principal.userId,
      },
    );

    return noContent();
  };
}

export type OidcRouteDependencies = Readonly<{
  verifier: IdTokenVerifier;
  clock: Clock;
}>;

export function registerOidcRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: OidcRouteDependencies,
): void {
  app.use("/v1/auth/oidc/exchange", captureRawJson());
  app.use("/v1/auth/oidc/connect", captureRawJson());
  app.use("/v1/auth/oidc/connect", requireAuth(dependencies.clock));
  app.use(
    "/v1/auth/oidc/connect",
    idempotent({ scopeKey: "auth.oidc.connect" }),
  );

  app.openapi(
    exchangeRoute,
    createExchangeHandler(dependencies.verifier, dependencies.clock),
  );
  app.openapi(
    connectRoute,
    createConnectHandler(dependencies.verifier, dependencies.clock),
  );
}
