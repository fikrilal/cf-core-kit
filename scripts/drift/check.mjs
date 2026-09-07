import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const PLANNED_MARKER = "(planned)";

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".wrangler",
  ".commandcode",
]);
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const ADR_LINK_PATTERN = /\(\.\/([^)]+\.md)\)/g;

export function listTopLevelDirs(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !IGNORED_DIRS.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

export function listSrcChildDirs(root) {
  const src = join(root, "src");
  if (!existsSync(src)) return [];

  return readdirSync(src, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listMarkdownFiles(root) {
  const files = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name))
          continue;
        walk(join(dir, entry.name));
        continue;
      }

      if (entry.name.endsWith(".md")) files.push(join(dir, entry.name));
    }
  };

  walk(root);

  return files.map((path) => relative(root, path).split(sep).join("/")).sort();
}

export function readMarkdownSources(root) {
  return listMarkdownFiles(root).map((path) => ({
    path,
    content: readFileSync(join(root, path), "utf8"),
  }));
}

export function parseMapEntries(agentsContent) {
  const entries = [];
  const block = /## Architecture Map\s*```text\n([\s\S]*?)```/.exec(
    agentsContent,
  );
  if (block === null) return entries;

  for (const line of block[1].split("\n")) {
    const match = /^(\S+)\s+/.exec(line);
    if (match === null) continue;

    entries.push({ path: match[1], planned: line.includes(PLANNED_MARKER) });
  }

  return entries;
}

export function checkProjectMap(entries, sources) {
  const violations = [];
  const tokens = entries.map((entry) => entry.path);

  for (const entry of entries) {
    if (!entry.planned && !sources.exists(entry.path)) {
      violations.push({
        file: "AGENTS.md",
        rule: "map",
        detail: `map entry does not exist: ${entry.path}`,
      });
    }
  }

  for (const dir of sources.topLevelDirs) {
    if (!tokens.some((token) => token.startsWith(`${dir}/`))) {
      violations.push({
        file: "AGENTS.md",
        rule: "map",
        detail: `unmapped top-level directory: ${dir}/`,
      });
    }
  }

  for (const dir of sources.srcChildDirs) {
    const prefix = `src/${dir}`;
    if (
      !tokens.some(
        (token) => token === `${prefix}/` || token.startsWith(`${prefix}/`),
      )
    ) {
      violations.push({
        file: "AGENTS.md",
        rule: "map",
        detail: `unmapped src directory: ${prefix}/`,
      });
    }
  }

  return violations;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function checkMarkdownLinks(files, exists) {
  const violations = [];

  for (const file of files) {
    for (const match of file.content.matchAll(LINK_PATTERN)) {
      const raw = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) continue;

      const target = raw.split("#")[0].split("?")[0];
      if (target === "") continue;

      const resolved = join(dirname(file.path), safeDecode(target))
        .split(sep)
        .join("/");
      if (!exists(resolved)) {
        violations.push({
          file: file.path,
          rule: "links",
          detail: `broken link: ${raw}`,
        });
      }
    }
  }

  return violations;
}

export function checkAdrIndex(indexContent, adrFiles, exists) {
  const violations = [];
  const indexed = new Set();

  for (const match of indexContent.matchAll(ADR_LINK_PATTERN))
    indexed.add(match[1]);

  for (const name of adrFiles.filter((file) => /^\d{4}-/.test(file))) {
    if (!indexed.has(name)) {
      violations.push({
        file: "docs/adr/README.md",
        rule: "adr",
        detail: `ADR not indexed: ${name}`,
      });
    }
  }

  for (const name of indexed) {
    if (!exists(`docs/adr/${name}`)) {
      violations.push({
        file: "docs/adr/README.md",
        rule: "adr",
        detail: `index link does not resolve: ${name}`,
      });
    }
  }

  return violations;
}

export function readMainModule(root) {
  const config = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const main = /"main":\s*"([^"]+)"/.exec(config)?.[1] ?? "src/worker.ts";

  return main.replace(/\.ts$/, "");
}

export function normalizeTypesContent(content, replacements) {
  const stripped = content.replace(
    /^\/\/ Generated by Wrangler by running .*\n/m,
    "",
  );

  return replacements.reduce(
    (current, replacement) =>
      current.split(replacement.from).join(replacement.to),
    stripped,
  );
}

export function probeTypes(root) {
  const tempDir = mkdtempSync(join(tmpdir(), "cfkit-types-"));
  const generatedPath = join(tempDir, "worker-configuration.d.ts");

  try {
    execFileSync("npx", ["--no-install", "wrangler", "types", generatedPath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });

    return {
      drifted: false,
      error: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim(),
    };
  }

  try {
    const replacements = [
      {
        from: relative(tempDir, join(root, readMainModule(root)))
          .split(sep)
          .join("/"),
        to: `./${readMainModule(root)}`,
      },
    ];
    const generated = normalizeTypesContent(
      readFileSync(generatedPath, "utf8"),
      replacements,
    );
    const committed = normalizeTypesContent(
      readFileSync(join(root, "worker-configuration.d.ts"), "utf8"),
      replacements,
    );

    return { drifted: generated !== committed, error: undefined };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function checkTypesDrift(result) {
  if (result.error !== undefined && result.error !== "") {
    return [
      {
        file: "worker-configuration.d.ts",
        rule: "types",
        detail: `probe failed: ${result.error}`,
      },
    ];
  }

  if (!result.drifted) return [];

  return [
    {
      file: "worker-configuration.d.ts",
      rule: "types",
      detail: "generated types are out of date; run npm run types",
    },
  ];
}

export function parseDrizzleConfig(content) {
  const dialect = /dialect:\s*"([^"]+)"/.exec(content)?.[1];
  const schema = /schema:\s*"([^"]+)"/.exec(content)?.[1];
  const out = /out:\s*"([^"]+)"/.exec(content)?.[1];

  if (dialect === undefined || schema === undefined || out === undefined)
    return undefined;

  return { dialect, schema, out };
}

export function listSqlFiles(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function probeMigrations(root, config) {
  const tempDir = mkdtempSync(join(tmpdir(), "cfkit-drift-"));
  const outArg = relative(root, tempDir).split(sep).join("/");

  try {
    cpSync(join(root, config.out), tempDir, { recursive: true });
    const before = listSqlFiles(tempDir);

    try {
      execFileSync(
        "npx",
        [
          "--no-install",
          "drizzle-kit",
          "generate",
          "--dialect",
          config.dialect,
          "--schema",
          config.schema,
          "--out",
          outArg,
          "--name",
          "drift_probe",
        ],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      return {
        before,
        after: before,
        error: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim(),
      };
    }

    return { before, after: listSqlFiles(tempDir) };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function checkMigrationsDrift(result) {
  if (result.error !== undefined && result.error !== "") {
    return [
      {
        file: "db/migrations",
        rule: "migrations",
        detail: `probe failed: ${result.error}`,
      },
    ];
  }

  const newFiles = result.after.filter((name) => !result.before.includes(name));
  if (newFiles.length === 0) return [];

  return [
    {
      file: "db/migrations",
      rule: "migrations",
      detail: `schema changed without a migration (${newFiles.join(", ")} would be generated); run npm run db:generate`,
    },
  ];
}

export function runChecks(root) {
  const exists = (path) => existsSync(join(root, path));
  const violations = [];
  const details = {};

  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  violations.push(
    ...checkProjectMap(parseMapEntries(agents), {
      topLevelDirs: listTopLevelDirs(root),
      srcChildDirs: listSrcChildDirs(root),
      exists,
    }),
  );

  const markdown = readMarkdownSources(root);
  details.markdownFiles = markdown.length;
  violations.push(...checkMarkdownLinks(markdown, exists));

  const adrDir = join(root, "docs", "adr");
  violations.push(
    ...checkAdrIndex(
      readFileSync(join(adrDir, "README.md"), "utf8"),
      readdirSync(adrDir),
      exists,
    ),
  );

  const types = probeTypes(root);
  details.types =
    types.error !== undefined && types.error !== ""
      ? "probe failed"
      : types.drifted
        ? "out of date"
        : "up to date";
  violations.push(...checkTypesDrift(types));

  const config = parseDrizzleConfig(
    readFileSync(join(root, "drizzle.config.ts"), "utf8"),
  );
  if (config === undefined) {
    violations.push({
      file: "drizzle.config.ts",
      rule: "migrations",
      detail: "could not read dialect/schema/out (keep them literal strings)",
    });
  } else {
    const probe = probeMigrations(root, config);
    details.migrations =
      probe.error !== undefined || probe.after.length > probe.before.length
        ? "drift or probe failure"
        : "no pending generation";
    violations.push(...checkMigrationsDrift(probe));
  }

  return { details, violations };
}

function main() {
  const result = runChecks(process.cwd());

  console.log(
    `[drift] markdown files: ${String(result.details.markdownFiles ?? 0)}`,
  );
  console.log(`[drift] types: ${String(result.details.types ?? "unknown")}`);
  console.log(
    `[drift] migrations: ${String(result.details.migrations ?? "unknown")}`,
  );

  if (result.violations.length === 0) {
    console.log("[drift] all checks passed");
    return;
  }

  console.error("[drift] violations:");
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
