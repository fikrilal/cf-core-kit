import { OpenAPIHono } from "@hono/zod-openapi";
import { stringify } from "yaml";

import { applyErrorCodeExtensions } from "../../src/platform/http/openapi";
import type { AppEnv } from "../../src/platform/http/types";
import {
  healthOperations,
  registerHealthRoutes,
} from "../../src/platform/health/health";

export type EmitOptions = Readonly<{ title: string; version: string }>;

export function renderOpenApiYaml(options: EmitOptions): string {
  const app = new OpenAPIHono<AppEnv>();

  registerHealthRoutes(app);

  const document: unknown = app.getOpenAPIDocument({
    openapi: "3.0.0",
    info: {
      title: options.title,
      description: "Generated API contract (code-first).",
      version: options.version,
      contact: {},
    },
    tags: [
      {
        name: "Health",
        description: "Service health and readiness endpoints.",
      },
    ],
    servers: [{ url: "/" }],
  });

  applyErrorCodeExtensions(document, healthOperations);

  return stringify(document, { indent: 2 });
}
