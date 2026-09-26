import type { OpenAPIHono } from "@hono/zod-openapi";

import type { Clock } from "../../platform/clock/clock";
import { systemClock } from "../../platform/clock/clock";
import type { EmailPort } from "../../platform/email/email";
import type { OperationMetadata } from "../../platform/http/openapi";
import type { AppEnv } from "../../platform/http/types";
import { disabledPushPort, type PushPort } from "../../platform/push/push";
import {
  durableObjectLimiterFactory,
  type LimiterFactory,
} from "../../platform/rate-limit/require-rate-limit";
import {
  emailVerificationOperations,
  registerEmailVerificationRoutes,
} from "./email-verification/email-verification.routes";
import {
  createDefaultIdTokenVerifier,
  type IdTokenVerifier,
} from "./oidc/oidc";
import { oidcOperations, registerOidcRoutes } from "./oidc/oidc.routes";
import {
  pushTokenOperations,
  registerPushTokenRoutes,
} from "./push-tokens/push-token.routes";
import { jwksOperations, registerJwksRoutes } from "./sessions/jwks.routes";
import {
  registerSessionRoutes,
  sessionOperations,
} from "./sessions/session.routes";
import {
  registerSessionsRoutes,
  sessionsOperations,
} from "./sessions/sessions.routes";
import {
  registerAuthRateLimits,
  type AuthRateLimits,
} from "./shared/auth.rate-limits";

export const authOperations: readonly OperationMetadata[] = [
  ...oidcOperations,
  ...sessionOperations,
  ...jwksOperations,
  ...emailVerificationOperations,
  ...pushTokenOperations,
  ...sessionsOperations,
];

export type AuthRouteDependencies = Readonly<{
  verifier?: IdTokenVerifier;
  clock?: Clock;
  rateLimiterFactory?: LimiterFactory;
  rateLimits?: Partial<AuthRateLimits>;
  email?: EmailPort;
  queue?: Queue;
  push?: PushPort;
}>;

export function registerAuthRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: AuthRouteDependencies = {},
): void {
  const verifier = dependencies.verifier ?? createDefaultIdTokenVerifier();
  const clock = dependencies.clock ?? systemClock;
  const limiterFactory =
    dependencies.rateLimiterFactory ?? durableObjectLimiterFactory();

  registerAuthRateLimits(app, dependencies.rateLimits, limiterFactory);

  registerOidcRoutes(app, { verifier, clock });
  registerSessionRoutes(app, { clock });
  registerJwksRoutes(app);
  registerEmailVerificationRoutes(app, {
    clock,
    limiterFactory,
    email: dependencies.email,
    queue: dependencies.queue,
  });
  registerPushTokenRoutes(app, {
    clock,
    push: dependencies.push ?? disabledPushPort(),
  });
  registerSessionsRoutes(app, { clock });
}
