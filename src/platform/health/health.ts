import { createRoute, OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import type { OperationMetadata } from "../http/openapi";
import type { AppEnv } from "../http/types";

export type HealthDependencies = Readonly<{
  databaseReady: (context: Context<AppEnv>) => Promise<boolean>;
}>;

export async function evaluateReadiness(
  check: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}

async function defaultDatabaseReady(
  context: Context<AppEnv>,
): Promise<boolean> {
  return evaluateReadiness(() => context.env.DB.prepare("SELECT 1").first());
}

const statusSchema = z.object({ status: z.string().meta({ example: "ok" }) });

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "health.get",
  tags: ["Health"],
  summary: "Liveness check",
  description: "Indicates whether the process is alive.",
  responses: {
    200: {
      description: "Liveness check.",
      content: { "application/json": { schema: statusSchema } },
    },
  },
});

const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  operationId: "ready.get",
  tags: ["Health"],
  summary: "Readiness check",
  description: "Indicates whether the service is ready to receive traffic.",
  responses: {
    200: {
      description: "Readiness check.",
      content: { "application/json": { schema: statusSchema } },
    },
  },
});

export const healthOperations: readonly OperationMetadata[] = [
  {
    method: "get",
    path: "/health",
    operationId: "health.get",
    errorCodes: [ErrorCode.INTERNAL],
  },
  {
    method: "get",
    path: "/ready",
    operationId: "ready.get",
    errorCodes: [ErrorCode.INTERNAL],
  },
];

const healthHandler: RouteHandler<typeof healthRoute, AppEnv> = (context) =>
  context.json({ status: "ok" }, 200);

export function registerHealthRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: HealthDependencies = { databaseReady: defaultDatabaseReady },
): void {
  const readyHandler: RouteHandler<typeof readyRoute, AppEnv> = async (
    context,
  ) => {
    const ready = await dependencies.databaseReady(context);

    if (ready) return context.json({ status: "ok" }, 200);

    throw new AppError({
      status: 503,
      code: ErrorCode.INTERNAL,
      message: "Readiness checks failed",
      issues: [{ field: "db", message: "D1 not ready" }],
    });
  };

  app.openapi(healthRoute, healthHandler);
  app.openapi(readyRoute, readyHandler);
}
