import { parse as parseYaml } from "yaml";

import {
  GENERATED_MARKER,
  camelFromPascal,
  coverageWithOperationMoved,
  featureFromOperationId,
  isRecord,
  operationSlug,
  pascalFromKebab,
  readCoverageManifest,
  type ScaffoldEdit,
  type ScaffoldPlan,
} from "./scaffold.ts";

export type EndpointSnapshot = Readonly<{
  method: string;
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  secured: boolean;
  errorCodes: readonly string[];
  responseStatuses: readonly string[];
  hasRequestBody: boolean;
  parameterLocations: readonly string[];
}>;

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function snapshotFromOperation(
  operation: Record<string, unknown>,
  method: string,
  path: string,
): EndpointSnapshot | undefined {
  const operationId = readString(operation.operationId);

  if (operationId === undefined) return undefined;

  const tag = Array.isArray(operation.tags)
    ? readString(operation.tags[0])
    : undefined;

  if (tag === undefined) {
    throw new Error(`Operation "${operationId}" has no tag in the snapshot`);
  }

  const parameters = Array.isArray(operation.parameters)
    ? operation.parameters.filter(isRecord)
    : [];

  return {
    method,
    path,
    operationId,
    tag,
    summary: readString(operation.summary) ?? "",
    description: readString(operation.description) ?? "",
    secured: Array.isArray(operation.security) && operation.security.length > 0,
    errorCodes: Array.isArray(operation["x-error-codes"])
      ? operation["x-error-codes"].filter(
          (code): code is string => typeof code === "string",
        )
      : [],
    responseStatuses: isRecord(operation.responses)
      ? Object.keys(operation.responses)
      : [],
    hasRequestBody: operation.requestBody !== undefined,
    parameterLocations: parameters.map(
      (parameter) => readString(parameter.in) ?? "unknown",
    ),
  };
}

export function findOperation(
  snapshotYaml: string,
  operationId: string,
): EndpointSnapshot {
  const document: unknown = parseYaml(snapshotYaml);

  if (!isRecord(document) || !isRecord(document.paths)) {
    throw new Error("pinned snapshot has no paths");
  }

  for (const [path, item] of Object.entries(document.paths)) {
    if (!isRecord(item)) continue;

    for (const [method, operation] of Object.entries(item)) {
      if (!isRecord(operation)) continue;

      const snapshot = snapshotFromOperation(operation, method, path);
      if (snapshot?.operationId === operationId) return snapshot;
    }
  }

  throw new Error(`Operation "${operationId}" is not in the pinned snapshot`);
}

export function routeFileContent(
  operation: EndpointSnapshot,
  pascal: string,
): string {
  const { secured } = operation;
  const securityImport = secured
    ? `import { requireAuth } from "../../platform/auth/guard";
import { systemClock, type Clock } from "../../platform/clock/clock";
`
    : "";
  const securityRoute = secured
    ? `  security: [{ "access-token": [] }],\n`
    : "";
  const dependencies = secured
    ? `  dependencies: Readonly<{ clock?: Clock }> = {},
): void {
  const clock = dependencies.clock ?? systemClock;

  app.use("${operation.path}", requireAuth(clock));
`
    : `): void {
`;

  return `${GENERATED_MARKER} (${operation.operationId}).
// TODO: replace the stub handler with real semantics.
import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";

${securityImport}import { noContent } from "../../platform/http/envelope";
import type { OperationMetadata } from "../../platform/http/openapi";
import type { AppEnv } from "../../platform/http/types";
import { ErrorCode } from "../../shared/error-codes";

const route = createRoute({
  method: "${operation.method}",
  path: "${operation.path}",
  operationId: "${operation.operationId}",
  tags: ["${operation.tag}"],
  summary: ${JSON.stringify(operation.summary)},
  description: ${JSON.stringify(operation.description)},
  responses: { 204: { description: "" } },
${securityRoute}});

export const ${camelFromPascal(pascal)}Operations: readonly OperationMetadata[] = [
  {
    method: "${operation.method}",
    path: "${operation.path}",
    operationId: "${operation.operationId}",
    errorCodes: [${operation.errorCodes.map((code) => `ErrorCode.${code}`).join(", ")}],
  },
];

const handler: RouteHandler<typeof route, AppEnv> = () => noContent();

export function register${pascal}Routes(
  app: OpenAPIHono<AppEnv>,
${dependencies}  app.openapi(route, handler);
}
`;
}

function securedSpec(operation: EndpointSnapshot): string {
  return `  it("requires a bearer token", async () => {
    const response = await send(
      buildApp(),
      "https://example.com${operation.path}",
      { method: "${operation.method.toUpperCase()}" },
      authEnv(),
    );

    expect(response.status).toBe(401);
  });

  it("answers 204 for an authenticated caller", async () => {
    // TODO: assert the real behavior once the handler exists.
    const response = await send(
      buildApp(),
      "https://example.com${operation.path}",
      {
        method: "${operation.method.toUpperCase()}",
        headers: { Authorization: \`Bearer \${await userAccessToken(crypto.randomUUID())}\` },
      },
      authEnv(),
    );

    expect(response.status).toBe(204);
  });`;
}

function publicSpec(operation: EndpointSnapshot): string {
  return `  it("answers 204", async () => {
    // TODO: assert the real behavior once the handler exists.
    const response = await send(
      buildApp(),
      "https://example.com${operation.path}",
      { method: "${operation.method.toUpperCase()}" },
      authEnv(),
    );

    expect(response.status).toBe(204);
  });`;
}

export function routeSpecContent(
  operation: EndpointSnapshot,
  slug: string,
  pascal: string,
): string {
  const fixtures = operation.secured
    ? `import { authEnv, userAccessToken } from "../../../test/auth-fixtures";`
    : `import { authEnv } from "../../../test/auth-fixtures";`;
  const tests = operation.secured
    ? securedSpec(operation)
    : publicSpec(operation);

  return `import { describe, expect, it } from "vitest";

import { send } from "../../../test/app-request";
${fixtures}
import { createApp } from "../../platform/http/app";
import { register${pascal}Routes } from "./${slug}.routes";

function buildApp() {
  const app = createApp();

  register${pascal}Routes(app);

  return app;
}

describe("${operation.operationId}", () => {
${tests}
});
`;
}

export type EndpointScaffoldInput = Readonly<{
  operationId: string;
  snapshotYaml: string;
  coverageJson: string;
  appSource: string;
  emitterSource: string;
  knownErrorCodes: ReadonlySet<string>;
  knownTags: ReadonlySet<string>;
  featureExists: (feature: string) => boolean;
}>;

function assertAnchor(source: string, anchor: string, what: string): void {
  const count = source
    .split("\n")
    .filter((line) => line.includes(anchor)).length;

  if (count !== 1) {
    throw new Error(
      `${what}: expected exactly one line containing "${anchor}" (found ${String(count)})`,
    );
  }
}

function assertSimple204(operation: EndpointSnapshot): void {
  const isSimple204 =
    operation.responseStatuses.length === 1 &&
    operation.responseStatuses[0] === "204" &&
    !operation.hasRequestBody &&
    operation.parameterLocations.length === 0;

  if (!isSimple204) {
    throw new Error(
      `Operation "${operation.operationId}" is not a simple 204 operation (single 204 response, no body, no parameters); declare its DTOs and route by hand`,
    );
  }
}

function assertCodesKnown(
  operation: EndpointSnapshot,
  known: ReadonlySet<string>,
): void {
  const missing = operation.errorCodes.filter((code) => !known.has(code));

  if (missing.length > 0) {
    throw new Error(
      `Missing error codes in src/shared/error-codes.ts: ${missing.join(", ")}; add them first (the snapshot already declares them)`,
    );
  }
}

function endpointEdits(
  plan: Readonly<{
    feature: string;
    slug: string;
    pascal: string;
    camel: string;
  }>,
): readonly ScaffoldEdit[] {
  const emitterImport = `from "../../src/features/${plan.feature}/${plan.slug}.routes";`;

  return [
    {
      path: "src/app.ts",
      anchor: 'import { commit, version } from "./version";',
      placement: "line-before",
      lines: [
        `import { register${plan.pascal}Routes } from "./features/${plan.feature}/${plan.slug}.routes";`,
      ],
    },
    {
      path: "src/app.ts",
      anchor: "registerUsersRoutes(app);",
      placement: "line-after",
      lines: [`  register${plan.pascal}Routes(app);`],
    },
    {
      path: "tools/contract/emit.entry.ts",
      anchor: 'from "../../src/features/users/users.routes";',
      placement: "line-after",
      lines: [
        `import { register${plan.pascal}Routes, ${plan.camel}Operations } ${emitterImport}`,
      ],
    },
    {
      path: "tools/contract/emit.entry.ts",
      anchor: "registerUsersRoutes(app);",
      placement: "line-after",
      lines: [`  register${plan.pascal}Routes(app);`],
    },
    {
      path: "tools/contract/emit.entry.ts",
      anchor: "...usersOperations,",
      placement: "line-after",
      lines: [`    ...${plan.camel}Operations,`],
    },
  ];
}

export function buildEndpointScaffold(
  input: EndpointScaffoldInput,
): ScaffoldPlan {
  const operation = findOperation(input.snapshotYaml, input.operationId);
  const feature = featureFromOperationId(input.operationId);

  if (!input.featureExists(feature)) {
    throw new Error(
      `Feature "${feature}" does not exist; run \`cfkit scaffold feature ${feature}\` first`,
    );
  }

  if (!input.knownTags.has(operation.tag)) {
    throw new Error(
      `Tag "${operation.tag}" is not in the emitter tag registry; add it to tools/contract/emit.entry.ts first`,
    );
  }

  const manifest = readCoverageManifest(input.coverageJson);

  void coverageWithOperationMoved(manifest, input.operationId);

  assertSimple204(operation);
  assertCodesKnown(operation, input.knownErrorCodes);

  const slug = operationSlug(input.operationId.split(".").slice(1).join("."));
  const pascal = pascalFromKebab(slug);
  const camel = camelFromPascal(pascal);
  const plan = { feature, slug, pascal, camel };
  const edits = endpointEdits(plan);

  for (const edit of edits) {
    assertAnchor(
      edit.path === "src/app.ts" ? input.appSource : input.emitterSource,
      edit.anchor,
      edit.path,
    );
  }

  return {
    kind: "endpoint",
    description: `${operation.operationId} (${operation.method.toUpperCase()} ${operation.path})`,
    files: [
      {
        path: `src/features/${feature}/${slug}.routes.ts`,
        content: routeFileContent(operation, pascal),
      },
      {
        path: `src/features/${feature}/${slug}.routes.spec.ts`,
        content: routeSpecContent(operation, slug, pascal),
      },
    ],
    edits,
    moveOperation: input.operationId,
    nextSteps: [
      `Replace the TODO markers in src/features/${feature}/${slug}.routes.ts and its spec`,
      `Coverage moved ${input.operationId} to implemented; run \`npm run verify:ci\``,
    ],
  };
}
