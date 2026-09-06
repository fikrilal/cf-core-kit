import type { Context, Hono } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
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

export function registerHealthRoutes(
  app: Hono<AppEnv>,
  dependencies: HealthDependencies = { databaseReady: defaultDatabaseReady },
): void {
  app.get("/health", () => Response.json({ status: "ok" }));

  app.get("/ready", async (context) => {
    const ready = await dependencies.databaseReady(context);

    if (ready) return Response.json({ status: "ok" });

    throw new AppError({
      status: 503,
      code: ErrorCode.INTERNAL,
      message: "Readiness checks failed",
      issues: [{ field: "db", message: "D1 not ready" }],
    });
  });
}
