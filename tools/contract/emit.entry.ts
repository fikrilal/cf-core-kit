import { OpenAPIHono } from "@hono/zod-openapi";
import { stringify } from "yaml";

import {
  authOperations,
  registerAuthRoutes,
} from "../../src/features/auth/auth.routes";
import {
  registerUsersRoutes,
  usersOperations,
} from "../../src/features/users/users.routes";
import {
  applyErrorCodeExtensions,
  applyOperationParameters,
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
  { name: "Users", description: "User profile endpoints." },
];

const SECURITY_SCHEMES = {
  "access-token": { type: "http", scheme: "bearer", bearerFormat: "JWT" },
};

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (typeof value !== "object" || value === null) return value;

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortRecord(record[key]);
  }

  return sorted;
}

function canonicalizeDocument(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return document;

  const source = document as Record<string, unknown>;
  const paths = source.paths;
  const components = source.components;
  const schemas =
    typeof components === "object" && components !== null
      ? (components as Record<string, unknown>).schemas
      : undefined;

  return {
    ...source,
    ...(paths === undefined ? {} : { paths: sortRecord(paths) }),
    ...(schemas === undefined ||
    typeof components !== "object" ||
    components === null
      ? {}
      : {
          components: {
            ...(components as Record<string, unknown>),
            schemas: sortRecord(schemas),
          },
        }),
  };
}

export function renderOpenApiYaml(options: EmitOptions): string {
  const app = new OpenAPIHono<AppEnv>();

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerUsersRoutes(app);

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

  const operations = [
    ...healthOperations,
    ...authOperations,
    ...usersOperations,
  ];

  applySecuritySchemes(document, SECURITY_SCHEMES);
  applyOperationParameters(document, operations);
  applyErrorCodeExtensions(document, operations);

  // Canonical ordering: the emitted artifact must be a function of the contract,
  // not of feature registration order, so internal refactors never churn it.
  const canonical = canonicalizeDocument(document);

  return stringify(canonical, { indent: 2 });
}
