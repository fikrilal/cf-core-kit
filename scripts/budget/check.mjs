import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const BUNDLE_BUDGET_KIB = 2048;
export const MAX_CRON_TRIGGERS = 1;
export const SUBTLE_ALLOWED_PREFIXES = ["src/platform/"];
export const ENV_ALLOWED_PREFIXES = ["src/platform/"];
export const ENV_ALLOWED_PATHS = ["src/app.ts"];
export const KV_ALLOWLIST = [];

const NODE_CRYPTO_PATTERN =
  /\bfrom\s+["']node:crypto["']|require\(\s*["']node:crypto["']\s*\)/;
const SUBTLE_PATTERN = /crypto\.subtle/;
const CONTEXT_ENV_PATTERN = /context\.env/;
const KV_PATTERN = /env\.KV\b|KVNamespace/;

export function listProductionSources(root) {
  const sources = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts"))
        continue;

      sources.push({
        path: relative(root, full).split(sep).join("/"),
        content: readFileSync(full, "utf8"),
      });
    }
  };

  walk(join(root, "src"));

  return sources;
}

function isAllowed(path, prefixes, paths = []) {
  return (
    paths.includes(path) || prefixes.some((prefix) => path.startsWith(prefix))
  );
}

export function checkCryptoAllowlist(files, options = {}) {
  const allowedPrefixes =
    options.subtleAllowedPrefixes ?? SUBTLE_ALLOWED_PREFIXES;
  const violations = [];

  for (const file of files) {
    if (NODE_CRYPTO_PATTERN.test(file.content)) {
      violations.push({
        file: file.path,
        rule: "crypto",
        detail: "node:crypto is not allowed; use WebCrypto",
      });
    }

    if (
      SUBTLE_PATTERN.test(file.content) &&
      !isAllowed(file.path, allowedPrefixes)
    ) {
      violations.push({
        file: file.path,
        rule: "crypto",
        detail: "crypto.subtle is only allowed inside src/platform/",
      });
    }
  }

  return violations;
}

export function checkEnvConfinement(files, options = {}) {
  const allowedPrefixes = options.allowedPrefixes ?? ENV_ALLOWED_PREFIXES;
  const allowedPaths = options.allowedPaths ?? ENV_ALLOWED_PATHS;
  const violations = [];

  for (const file of files) {
    if (
      CONTEXT_ENV_PATTERN.test(file.content) &&
      !isAllowed(file.path, allowedPrefixes, allowedPaths)
    ) {
      violations.push({
        file: file.path,
        rule: "env",
        detail: "context.env is only allowed in src/platform/ and src/app.ts",
      });
    }
  }

  return violations;
}

export function checkKvAccess(files, options = {}) {
  const allowlist = options.allowlist ?? KV_ALLOWLIST;
  const violations = [];

  for (const file of files) {
    if (KV_PATTERN.test(file.content) && !allowlist.includes(file.path)) {
      violations.push({
        file: file.path,
        rule: "kv",
        detail: "KV access requires an allowlist entry (read-only territory)",
      });
    }
  }

  return violations;
}

export function parseCronTriggers(wranglerContent) {
  const stripped = wranglerContent
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
  const parsed = JSON.parse(stripped);
  const crons = parsed?.triggers?.crons ?? [];

  return Array.isArray(crons) ? crons : [];
}

export function checkCronCount(wranglerContent, options = {}) {
  const maxCrons = options.maxCrons ?? MAX_CRON_TRIGGERS;
  let crons;

  try {
    crons = parseCronTriggers(wranglerContent);
  } catch (error) {
    return [
      {
        file: "wrangler.jsonc",
        rule: "crons",
        detail: `could not parse: ${String(error)}`,
      },
    ];
  }

  if (crons.length > maxCrons) {
    return [
      {
        file: "wrangler.jsonc",
        rule: "crons",
        detail: `${String(crons.length)} cron triggers configured; budget is ${String(maxCrons)}`,
      },
    ];
  }

  return [];
}

export function checkBundleSize(output, options = {}) {
  const budgetKib = options.budgetKib ?? BUNDLE_BUDGET_KIB;
  const match = /Total Upload:\s*([\d.]+)\s*KiB/.exec(output);

  if (!match) {
    return {
      sizeKib: undefined,
      violations: [
        {
          file: "bundle",
          rule: "bundle",
          detail: "could not read Total Upload from the dry-run output",
        },
      ],
    };
  }

  const sizeKib = Number(match[1]);

  if (!Number.isFinite(sizeKib) || sizeKib > budgetKib) {
    return {
      sizeKib,
      violations: [
        {
          file: "bundle",
          rule: "bundle",
          detail: `${String(sizeKib)} KiB exceeds the ${String(budgetKib)} KiB budget`,
        },
      ],
    };
  }

  return { sizeKib, violations: [] };
}

export function runDryRun(root) {
  try {
    return execFileSync(
      "npx",
      ["--no-install", "wrangler", "deploy", "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";

    return `${stdout}\n${stderr}`;
  }
}

export function runChecks(root) {
  const files = listProductionSources(root);
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const bundle = checkBundleSize(runDryRun(root));

  return {
    files: files.length,
    bundle,
    violations: [
      ...checkCryptoAllowlist(files),
      ...checkEnvConfinement(files),
      ...checkKvAccess(files),
      ...checkCronCount(wrangler),
      ...bundle.violations,
    ],
  };
}

function main() {
  const result = runChecks(process.cwd());

  console.log(`[budget] scanned ${String(result.files)} production sources`);
  console.log(
    `[budget] bundle: ${result.bundle.sizeKib === undefined ? "unknown" : `${String(result.bundle.sizeKib)} KiB`} / ${String(BUNDLE_BUDGET_KIB)} KiB budget`,
  );

  if (result.violations.length === 0) {
    console.log("[budget] all checks passed");
    return;
  }

  console.error("[budget] violations:");
  for (const violation of result.violations) {
    console.error(
      `  x [${violation.rule}] ${violation.file}: ${violation.detail}`,
    );
  }

  process.exit(1);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}
