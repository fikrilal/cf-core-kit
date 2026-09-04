import { Hono } from "hono";

import { notFoundResponse, problemResponse } from "./problem";
import { getRequestId, requestIdMiddleware } from "./request-id";
import type { AppEnv } from "./types";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(requestIdMiddleware);

  app.notFound((context) => notFoundResponse(getRequestId(context)));
  app.onError((error, context) =>
    problemResponse(error, getRequestId(context)),
  );

  return app;
}
