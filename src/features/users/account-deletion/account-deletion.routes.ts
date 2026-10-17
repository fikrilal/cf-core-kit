import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";

import { requireAuth } from "../../../platform/auth/guard";
import { requirePrincipal } from "../../../platform/auth/principal";
import type { Clock } from "../../../platform/clock/clock";
import { databaseFrom } from "../../../platform/db/request";
import { noContent } from "../../../platform/http/envelope";
import { idempotent } from "../../../platform/http/idempotency";
import type { OperationMetadata } from "../../../platform/http/openapi";
import type { AppEnv } from "../../../platform/http/types";
import { AppError } from "../../../platform/errors/app-error";
import { ErrorCode } from "../../../shared/error-codes";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
} from "./account-deletion.repository";
import { requireLiveUser } from "../shared/guards";
import { z } from "zod";

const IDEMPOTENCY_KEY_PARAM = z.object({
  "Idempotency-Key": z.string().min(1).max(128).optional().meta({
    description:
      "Idempotency key for safe retries of write requests. Replays return `Idempotency-Replayed: true`.",
  }),
});

export const REQUEST_ACCOUNT_DELETION_PATH = "/v1/me/account-deletion/request";
export const CANCEL_ACCOUNT_DELETION_PATH = "/v1/me/account-deletion/cancel";

const requestAccountDeletionRoute = createRoute({
  method: "post",
  path: REQUEST_ACCOUNT_DELETION_PATH,
  operationId: "users.me.accountDeletion.request",
  tags: ["Users"],
  summary: "Request account deletion",
  description:
    "Schedules the authenticated account for deletion after the grace period. Idempotent; repeated calls keep the original schedule.",
  request: { headers: IDEMPOTENCY_KEY_PARAM },
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

const cancelAccountDeletionRoute = createRoute({
  method: "post",
  path: CANCEL_ACCOUNT_DELETION_PATH,
  operationId: "users.me.accountDeletion.cancel",
  tags: ["Users"],
  summary: "Cancel account deletion",
  description:
    "Cancels a scheduled account deletion. Idempotent; calls without a pending deletion are no-ops.",
  request: { headers: IDEMPOTENCY_KEY_PARAM },
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const accountDeletionOperations: readonly OperationMetadata[] = [
  {
    method: "post",
    path: REQUEST_ACCOUNT_DELETION_PATH,
    operationId: "users.me.accountDeletion.request",
    errorCodes: [
      ErrorCode.UNAUTHORIZED,
      ErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ErrorCode.CONFLICT,
      ErrorCode.USERS_CANNOT_DELETE_LAST_ADMIN,
      ErrorCode.INTERNAL,
    ],
  },
  {
    method: "post",
    path: CANCEL_ACCOUNT_DELETION_PATH,
    operationId: "users.me.accountDeletion.cancel",
    errorCodes: [
      ErrorCode.UNAUTHORIZED,
      ErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ErrorCode.INTERNAL,
    ],
  },
];

export type AccountDeletionRouteDependencies = Readonly<{
  clock: Clock;
}>;

function createRequestAccountDeletionHandler(
  dependencies: AccountDeletionRouteDependencies,
): RouteHandler<typeof requestAccountDeletionRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    await requireLiveUser(context, principal.userId);
    const result = await requestAccountDeletion(databaseFrom(context), {
      userId: principal.userId,
      sessionId: principal.sessionId,
      traceId: context.get("requestId"),
      now: dependencies.clock.now(),
    });

    switch (result.kind) {
      case "ok":
      case "already_requested":
        return noContent();
      case "not_found":
        throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
      case "last_admin":
        throw new AppError({
          status: 409,
          code: ErrorCode.USERS_CANNOT_DELETE_LAST_ADMIN,
          message: "Cannot delete the last admin",
        });
      default: {
        const unreachable: never = result;
        throw new Error(
          `Unexpected account deletion request: ${String(unreachable)}`,
        );
      }
    }
  };
}

function createCancelAccountDeletionHandler(
  dependencies: AccountDeletionRouteDependencies,
): RouteHandler<typeof cancelAccountDeletionRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    await requireLiveUser(context, principal.userId);
    const result = await cancelAccountDeletion(databaseFrom(context), {
      userId: principal.userId,
      sessionId: principal.sessionId,
      traceId: context.get("requestId"),
      now: dependencies.clock.now(),
    });

    switch (result.kind) {
      case "ok":
      case "not_requested":
        return noContent();
      case "not_found":
        throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
      default: {
        const unreachable: never = result;
        throw new Error(
          `Unexpected account deletion cancel: ${String(unreachable)}`,
        );
      }
    }
  };
}

export function registerAccountDeletionRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: AccountDeletionRouteDependencies,
): void {
  app.use(REQUEST_ACCOUNT_DELETION_PATH, requireAuth(dependencies.clock));
  app.use(
    REQUEST_ACCOUNT_DELETION_PATH,
    idempotent({ scopeKey: "users.me.accountDeletion.request" }),
  );
  app.use(CANCEL_ACCOUNT_DELETION_PATH, requireAuth(dependencies.clock));
  app.use(
    CANCEL_ACCOUNT_DELETION_PATH,
    idempotent({ scopeKey: "users.me.accountDeletion.cancel" }),
  );

  app.openapi(
    requestAccountDeletionRoute,
    createRequestAccountDeletionHandler(dependencies),
  );
  app.openapi(
    cancelAccountDeletionRoute,
    createCancelAccountDeletionHandler(dependencies),
  );
}
