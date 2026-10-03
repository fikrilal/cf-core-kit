import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkConfig, configKeyUnionFrom, schemaKeysFrom } from "./check.mjs";

function realInput() {
  return {
    wranglerContent: readFileSync("wrangler.jsonc", "utf8"),
    configSource: readFileSync("src/platform/config/config.ts", "utf8"),
    readmeContent: readFileSync("README.md", "utf8"),
  };
}

test("config: the repository's own surfaces agree", () => {
  assert.deepEqual(checkConfig(realInput()), []);
});

test("config: the schema and the ConfigKey union describe the same keys", () => {
  const input = realInput();
  const schemaKeys = schemaKeysFrom(input.configSource);

  assert.deepEqual(configKeyUnionFrom(input.configSource), schemaKeys);
});

test("config: an unknown var fails", () => {
  const input = realInput();
  const violations = checkConfig({
    ...input,
    wranglerContent: input.wranglerContent.replace(
      '"LOG_LEVEL": "info"',
      '"LOG_LEVELISH": "info"',
    ),
  });

  assert.ok(
    violations.some((entry) =>
      entry.includes('"LOG_LEVELISH" is not a config key'),
    ),
  );
});

test("config: a scope that diverges from the root scope fails", () => {
  const input = realInput();
  const violations = checkConfig({
    ...input,
    wranglerContent: input.wranglerContent.replace(
      '"R2_BUCKET": "cf-core-kit-prod"',
      '"R2_BUCKET_OTHER": "cf-core-kit-prod"',
    ),
  });

  assert.ok(
    violations.some((entry) =>
      entry.includes("vars differ from the root scope"),
    ),
  );
});

test("config: a missing required var fails", () => {
  const input = realInput();
  const violations = checkConfig({
    ...input,
    wranglerContent: input.wranglerContent.replaceAll(
      '"APP_ENV"',
      '"APP_ENVIRONMENT"',
    ),
  });

  assert.ok(
    violations.some((entry) =>
      entry.includes('required var "APP_ENV" is missing'),
    ) ||
      violations.some((entry) =>
        entry.includes('"APP_ENVIRONMENT" is not a config key'),
      ),
  );
});

test("config: ConfigKey drift fails in both directions", () => {
  const input = realInput();
  const missing = checkConfig({
    ...input,
    configSource: input.configSource.replace(/^\s*\| "R2_BUCKET"$/m, ""),
  });

  assert.ok(
    missing.some((entry) => entry.includes('ConfigKey is missing "R2_BUCKET"')),
  );

  const extra = checkConfig({
    ...input,
    configSource: input.configSource.replace(
      "type ConfigKey =",
      'type ConfigKey = | "NOT_A_REAL_KEY"',
    ),
  });

  assert.ok(
    extra.some((entry) =>
      entry.includes(
        'ConfigKey lists "NOT_A_REAL_KEY" which the zod schema does not define',
      ),
    ),
  );
});

test("config: an undocumented secret fails, the placeholder is ignored", () => {
  const input = realInput();
  const violations = checkConfig({
    ...input,
    readmeContent: `${input.readmeContent}\nnpx wrangler secret put GHOST_SECRET\nnpx wrangler secret put NAME\n`,
  });

  assert.ok(
    violations.some((entry) => entry.includes('secret "GHOST_SECRET"')),
  );
  assert.equal(
    violations.some((entry) => entry.includes('secret "NAME"')),
    false,
  );
});
