import type { OpenAPIHono } from "@hono/zod-openapi";

import { systemClock, type Clock } from "../../platform/clock/clock";
import type { AppEnv } from "../../platform/http/types";
import {
  durableObjectLimiterFactory,
  type LimiterFactory,
} from "../../platform/rate-limit/require-rate-limit";
import { registerAccountDeletionRoutes } from "./account-deletion/account-deletion.routes";
import { registerMeRoutes } from "./me/me.routes";
import { registerProfileImageRoutes } from "./profile-image/profile-image.routes";

export type UsersRouteDependencies = Readonly<{
  clock?: Clock;
  rateLimiterFactory?: LimiterFactory;
  queue?: Queue;
}>;

export function registerUsersRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: UsersRouteDependencies = {},
): void {
  const clock = dependencies.clock ?? systemClock;
  const limiterFactory =
    dependencies.rateLimiterFactory ?? durableObjectLimiterFactory();

  registerMeRoutes(app, { clock });
  registerProfileImageRoutes(app, {
    clock,
    limiterFactory,
    queue: dependencies.queue,
  });
  registerAccountDeletionRoutes(app, { clock });
}

export { usersOperations } from "./users.operations";
