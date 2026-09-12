import { OpenAPIHono } from "@hono/zod-openapi";
import { stringify } from "yaml";

import {
  authOperations,
  registerAuthRoutes,
} from "../../src/features/auth/auth.routes";
import {
  applyErrorCodeExtensions,
  applySecuritySchemes,
} from "../../src/platform/http/openapi";
import type { AppEnv } from "../../src/platform/http/types";
import {
  healthOperations,
  registerHealthRoutes,
} from "../../src/platform/health/health";

export type EmitOptions = Readonly<{ title: string; version: string }>;

const TAG_REGISTRY = [
  { name: "Health", description: "Service health and readiness endpoints." },
  { name: "Auth", description: "Authentication and session endpoints." },
];

const SECURITY_SCHEMES = {
  "access-token": { type: "http", scheme: "bearer", bearerFormat: "JWT" },
};

export function renderOpenApiYaml(options: EmitOptions): string {
  const app = new OpenAPIHono<AppEnv>();

  registerHealthRoutes(app);
  registerAuthRoutes(app);

  const document: unknown = app.getOpenAPIDocument({
    openapi: "3.0.0",
    info: {
      title: options.title,
      description: "Generated API contract (code-first).",
      version: options.version,
      contact: {},
    },
    tags: TAG_REGISTRY,
    servers: [{ url: "/" }],
  });

  applySecuritySchemes(document, SECURITY_SCHEMES);
  applyErrorCodeExtensions(document, [...healthOperations, ...authOperations]);

  return stringify(document, { indent: 2 });
}
