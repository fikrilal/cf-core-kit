import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseWranglerJsonc } from "../budget/check.mjs";

export const REQUIRED_VARS = ["APP_ENV"];
export const SECRET_PLACEHOLDERS = ["NAME"];

const SCHEMA_KEYS_PATTERN = /^\s{4}([A-Z][A-Z0-9_]*):/gm;
const CONFIG_KEY_PATTERN = /"([A-Z][A-Z0-9_]+)"/g;
const SECRET_PATTERN = /wrangler secret put ([A-Z][A-Z0-9_]*)/g;

function matchAll(source, pattern) {
  const values = [];

  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) values.push(match[1]);
  }

  return values;
}

export function schemaKeysFrom(configSource) {
  return [...new Set(matchAll(configSource, SCHEMA_KEYS_PATTERN))].sort();
}

export function configKeyUnionFrom(configSource) {
  const start = configSource.indexOf("type ConfigKey =");
  const end = configSource.indexOf(";", start);

  if (start === -1 || end === -1) return [];

  return [
    ...new Set(matchAll(configSource.slice(start, end), CONFIG_KEY_PATTERN)),
  ].sort();
}

function scopeVars(parsed) {
  const scopes = { root: parsed?.vars };

  for (const [name, env] of Object.entries(parsed?.env ?? {})) {
    scopes[`env.${name}`] = env?.vars;
  }

  return scopes;
}

export function checkConfig(input) {
  const violations = [];
  const parsed = parseWranglerJsonc(input.wranglerContent);
  const schemaKeys = schemaKeysFrom(input.configSource);
  const configKeys = configKeyUnionFrom(input.configSource);
  const schemaSet = new Set(schemaKeys);
  const scopes = scopeVars(parsed);
  const scopeNames = Object.keys(scopes);

  if (schemaKeys.length === 0) {
    violations.push(
      "config schema exposes no keys; the parser found nothing to check",
    );
  }

  // The input type and the schema must describe the same key set.
  for (const key of schemaKeys) {
    if (!configKeys.includes(key)) {
      violations.push(
        `ConfigKey is missing "${key}" (present in the zod schema)`,
      );
    }
  }
  for (const key of configKeys) {
    if (!schemaSet.has(key)) {
      violations.push(
        `ConfigKey lists "${key}" which the zod schema does not define`,
      );
    }
  }

  // Every declared var must be a config key, and every required var must be present.
  const rootKeys = Object.keys(scopes.root ?? {}).sort();
  for (const scope of scopeNames) {
    const vars = scopes[scope] ?? {};
    const keys = Object.keys(vars).sort();

    for (const key of keys) {
      if (!schemaSet.has(key)) {
        violations.push(`${scope}: "${key}" is not a config key`);
      }
    }

    for (const required of REQUIRED_VARS) {
      if (!keys.includes(required)) {
        violations.push(`${scope}: required var "${required}" is missing`);
      }
    }

    const missing = rootKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !rootKeys.includes(key));

    if (missing.length > 0 || extra.length > 0) {
      violations.push(
        `${scope}: vars differ from the root scope (missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"})`,
      );
    }
  }

  // Documented secrets must exist in the config schema.
  for (const name of matchAll(input.readmeContent, SECRET_PATTERN)) {
    if (SECRET_PLACEHOLDERS.includes(name)) continue;
    if (!schemaSet.has(name)) {
      violations.push(
        `README documents secret "${name}" which is not a config key`,
      );
    }
  }

  return violations;
}

function main() {
  const root = process.cwd();
  const violations = checkConfig({
    wranglerContent: readFileSync(join(root, "wrangler.jsonc"), "utf8"),
    configSource: readFileSync(
      join(root, "src/platform/config/config.ts"),
      "utf8",
    ),
    readmeContent: readFileSync(join(root, "README.md"), "utf8"),
  });

  if (violations.length > 0) {
    console.error("[config] violations:");

    for (const violation of violations) console.error(`  x ${violation}`);

    return 1;
  }

  console.log(
    "[config] wrangler vars, config schema and documented secrets agree",
  );

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
