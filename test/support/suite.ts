import { env } from "cloudflare:workers";
import { beforeAll, describe } from "vitest";

import { createDb, type Database } from "../../src/platform/db/db";
import { cleanAuthTables } from "../auth-fixtures";

/**
 * Bindings an integration suite cannot run without. The Workers pool provides them through
 * `wrangler.jsonc` + the miniflare options in `vitest.config.ts`; a bare Node runner does not, and
 * the failure must be immediate and legible rather than a wall of `undefined` errors.
 */
export const REQUIRED_INTEGRATION_BINDINGS = [
  "DB",
  "TEST_MIGRATIONS",
  "JOBS",
] as const;

export function missingBindings(
  runtimeEnv: Record<string, unknown> = env as unknown as Record<
    string,
    unknown
  >,
  names: readonly string[] = REQUIRED_INTEGRATION_BINDINGS,
): string[] {
  return names.filter((name) => runtimeEnv[name] === undefined);
}

export function assertIntegrationBindings(
  runtimeEnv: Record<string, unknown> = env as unknown as Record<
    string,
    unknown
  >,
): void {
  const missing = missingBindings(runtimeEnv);

  if (missing.length > 0) {
    throw new Error(
      `integration suite is missing ${missing.join(", ")}: run it through the Workers pool (npm run test:int), not a bare Node runner`,
    );
  }
}

export type IntegrationSuite = Readonly<{
  /** A fresh drizzle handle over the pool's D1 binding. */
  db: () => Database;
  /** Deletes the auth tables between tests, so suites do not hand-roll their own cleanup. */
  clean: () => Promise<void>;
}>;

/**
 * The integration-suite contract: bindings are asserted once per suite, and table cleanup goes
 * through the same helper everywhere. Tests keep their per-test isolation; this just removes the
 * chance that a suite forgets the contract.
 */
export function describeIntegration(
  name: string,
  register: (suite: IntegrationSuite) => void,
): void {
  describe(name, () => {
    beforeAll(() => {
      assertIntegrationBindings();
    });

    const suite: IntegrationSuite = {
      db: () => createDb(env.DB),
      clean: async () => {
        await cleanAuthTables(createDb(env.DB));
      },
    };

    register(suite);
  });
}
