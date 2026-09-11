import { OpenAPIHono } from "@hono/zod-openapi";

import { notFoundResponse, problemResponse } from "./problem";
import { getRequestId, requestIdMiddleware } from "./request-id";
import { logRequestError } from "./request-logging";
import type { AppEnv } from "./types";

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.use(requestIdMiddleware);

  app.notFound((context) => notFoundResponse(getRequestId(context)));
  app.onError((error, context) => {
    logRequestError(context, error);

    return problemResponse(error, getRequestId(context));
  });

  return app;
}
