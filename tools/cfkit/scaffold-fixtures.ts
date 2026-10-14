import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared fixtures for the scaffold suites. They live here rather than in one of the spec files so both suites
 * read the same repository facts.
 */
export const ROOT = process.cwd();

export function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

export function repoErrorCodes(): ReadonlySet<string> {
  const source = readRepoFile("src/shared/error-codes.ts");
  const codes = [...source.matchAll(/^\s*([A-Z][A-Z0-9_]+) = /gm)].map(
    (match) => match[1] ?? "",
  );

  return new Set(codes);
}

export function pendingCoverage(operationId: string): string {
  const parsed = JSON.parse(readRepoFile("tools/parity/coverage.json")) as {
    pending: string[];
    implemented: string[];
    [key: string]: unknown;
  };

  return JSON.stringify({
    ...parsed,
    pending: [
      ...parsed.pending.filter((entry) => entry !== operationId),
      operationId,
    ],
    implemented: parsed.implemented.filter((entry) => entry !== operationId),
  });
}

export function endpointInput(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "users.me.pushToken.revoke",
    snapshotYaml: readRepoFile("contracts/backend.openapi.yaml"),
    coverageJson: pendingCoverage("users.me.pushToken.revoke"),
    appSource: readRepoFile("src/app.ts"),
    emitterSource: readRepoFile("tools/contract/emit.entry.ts"),
    knownErrorCodes: repoErrorCodes(),
    knownTags: new Set(["Auth", "Users"]),
    featureExists: () => true,
    ...overrides,
  };
}
