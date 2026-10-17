#!/usr/bin/env node
/**
 * cf-core-kit-clone — generate a new project from this kit.
 *
 * The strip list is data, not a pile of `rm` calls: every removal and every sanitiser is declared below, applied
 * in one pass, and printed before anything happens with `--dry-run`. The generated project gets a fresh git
 * history (one initial commit), zero-UUID infrastructure ids, and the kit token renamed to the new project.
 *
 * Usage: node bin/clone.mjs <dir> [--name my-project] [--ref main] [--source <path|url>] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export const KIT_TOKEN = "cf-core-kit";
export const ZERO_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const ZERO_ACCOUNT_ID = "00000000000000000000000000000000";

/** Directories dropped whole. */
export const STRIP_PATHS = [
  "_WIP",
  ".cfkit",
  "coverage",
  "dist",
  "node_modules",
  "docs/exec-plans/active",
];

/** Files kept when a directory is emptied. */
export const PLAN_KEEP = ["README.md", "_template.md"];

export function kebab(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The plan, as text: what would be removed and what would be rewritten. */
export function renderPlan(input) {
  const lines = [
    `[clone] ${KIT_TOKEN}@${input.ref} -> ${input.name} in ${input.target}`,
    `[clone] remove: ${STRIP_PATHS.join(", ")}`,
    `[clone] empty docs/exec-plans/completed (keep ${PLAN_KEEP.join(", ")})`,
    "[clone] reset .git and create one initial commit",
    `[clone] sanitise: package.json (name, description, repository), wrangler.jsonc (ids to zero, names to ${input.name})`,
    `[clone] rename: "${KIT_TOKEN}" -> "${input.name}" in docs, README and AGENTS.md`,
    "[clone] add a provenance banner to README.md",
  ];

  return lines.join("\n");
}

export function sanitisePackageJson(source, name) {
  const data = JSON.parse(source);
  data.name = name;
  data.version = "0.1.0";
  data.description = `Generated from ${KIT_TOKEN}`;
  delete data.repository;
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function sanitiseWrangler(source, name) {
  return source
    .replaceAll(/("database_id"\s*:\s*)"[^"]+"/g, `$1"${ZERO_DATABASE_ID}"`)
    .replaceAll(/("R2_ACCOUNT_ID"\s*:\s*)"[^"]+"/g, `$1"${ZERO_ACCOUNT_ID}"`)
    .replaceAll(KIT_TOKEN, name);
}

export function sanitiseDocs(source, name) {
  return source.replaceAll(KIT_TOKEN, name);
}

export function banner(name, sha) {
  return `> Generated from \`${KIT_TOKEN}@${sha.slice(0, 7)}\` by \`bin/clone.mjs\`. Everything below describes the base kit; project-specific records and infrastructure ids were stripped.\n\n`;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function strip(target) {
  for (const path of STRIP_PATHS)
    rmSync(join(target, path), { recursive: true, force: true });

  const completed = join(target, "docs/exec-plans/completed");
  if (existsSync(completed)) {
    for (const entry of readdirSync(completed)) {
      if (!PLAN_KEEP.includes(entry))
        rmSync(join(completed, entry), { recursive: true, force: true });
    }
  }
}

function apply(target, name, sha) {
  strip(target);

  const pkgPath = join(target, "package.json");
  writeFileSync(
    pkgPath,
    sanitisePackageJson(readFileSync(pkgPath, "utf8"), name),
  );

  const wranglerPath = join(target, "wrangler.jsonc");
  writeFileSync(
    wranglerPath,
    sanitiseWrangler(readFileSync(wranglerPath, "utf8"), name),
  );

  for (const file of [
    ...walk(join(target, "docs")),
    join(target, "README.md"),
    join(target, "AGENTS.md"),
  ]) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const next =
      file.endsWith("README.md") &&
      basename(file) === "README.md" &&
      file === join(target, "README.md")
        ? banner(name, sha) + sanitiseDocs(source, name)
        : sanitiseDocs(source, name);
    if (next !== source) writeFileSync(file, next);
  }

  rmSync(join(target, ".git"), { recursive: true, force: true });
  git(["init", "-q", "-b", "main"], target);
  git(["add", "-A"], target);
  git(
    [
      "commit",
      "-q",
      "-m",
      `chore: initialise ${name} from ${KIT_TOKEN}@${sha.slice(0, 7)}`,
    ],
    target,
  );
}

function main(argv) {
  const target = argv.find((arg) => !arg.startsWith("--"));
  if (target === undefined) {
    console.error(
      "usage: clone.mjs <dir> [--name my-project] [--ref main] [--source <path|url>] [--dry-run]",
    );
    return 2;
  }

  const flag = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : (argv[index + 1] ?? fallback);
  };
  const name = kebab(flag("--name", basename(resolve(target))));
  const ref = flag("--ref", "main");
  const source = flag("--source", process.cwd());
  const dryRun = argv.includes("--dry-run");
  const sha = git(["rev-parse", ref], source);

  console.log(renderPlan({ name, ref, target: resolve(target) }));
  if (dryRun) {
    console.log("[clone] dry run: nothing was written");
    return 0;
  }

  const scratch = mkdtempSync(join(tmpdir(), "cfkit-clone-"));
  try {
    git(
      ["clone", "-q", "--depth", "1", "--branch", ref, source, scratch],
      source,
    );
    if (existsSync(resolve(target)))
      rmSync(resolve(target), { recursive: true, force: true });
    cpSync(scratch, resolve(target), { recursive: true });
    apply(resolve(target), name, sha);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(
    `[clone] created ${resolve(target)} (fresh history, ids zeroed, ${KIT_TOKEN} -> ${name})`,
  );
  console.log(
    "[clone] next: npm install && npm run verify; then create D1/queues/bucket and set secrets (README runbook)",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exitCode = main(process.argv.slice(2));
