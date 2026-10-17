import { OpenAPIHono } from "@hono/zod-openapi";

import { openApiValidationHook } from "./openapi";
import { notFoundResponse, problemResponse } from "./problem";
import { getRequestId, requestIdMiddleware } from "./request-id";
import { logRequestError } from "./request-logging";
import type { AppEnv } from "./types";

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

  // Request id, not-found, and onError live here. src/app.ts registers
  // request logging after this returns. Auth, idempotency, and raw-body
  // capture stay on the route. Registration order is the pipeline order.
  app.use(requestIdMiddleware);

  app.notFound((context) => notFoundResponse(getRequestId(context)));
  app.onError((error, context) => {
    logRequestError(context, error);

    return problemResponse(error, getRequestId(context));
  });

  return app;
}
