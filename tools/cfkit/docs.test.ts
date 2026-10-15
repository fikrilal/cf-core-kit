import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { USAGE } from "./cli-main.ts";

/**
 * The engineering set and its index must agree, in both directions: a document that exists but is unlisted is
 * invisible, and a listed document that does not exist is a lie. The same rule applies to the guardrails map:
 * every gate it names is a file, and the CLI reference documents the commands the CLI actually accepts.
 */
const ROOT = process.cwd();
const ENGINEERING = "docs/engineering";

function markdownFiles(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(join(ROOT, directory), {
    withFileTypes: true,
  })) {
    const path = `${directory}/${entry.name}`;

    if (entry.isDirectory()) found.push(...markdownFiles(path));
    else if (entry.name.endsWith(".md") && entry.name !== "README.md")
      found.push(path);
  }

  return found.sort();
}

test("engineering docs: the set and the index agree in both directions", () => {
  const index = readFileSync(join(ROOT, ENGINEERING, "README.md"), "utf8");
  const documents = markdownFiles(ENGINEERING);

  assert.ok(
    documents.length >= 12,
    `expected the full set, found ${String(documents.length)}`,
  );

  for (const path of documents) {
    const name = path.slice(ENGINEERING.length + 1);

    assert.ok(
      index.includes(name),
      `${name} exists but the index does not name it`,
    );
  }

  for (const match of index.matchAll(
    /`([\w./-]+\.md)` \((?:written|family)\)/g,
  )) {
    const name = match[1] ?? "";

    assert.ok(
      existsSync(join(ROOT, ENGINEERING, name)),
      `the index names ${name}, which does not exist`,
    );
  }

  // The out-of-scope notes are attributed rather than missing.
  assert.match(
    index,
    /admin\/\*` and `merchantOnboarding\/\*` are \*\*out of scope\*\* \(ADR-0013\)/,
  );
});

test("engineering docs: the CLI reference documents exactly the commands the CLI accepts", () => {
  const reference = readFileSync(join(ROOT, ENGINEERING, "cfkit.md"), "utf8");
  const usageCommands = USAGE.split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[a-z][a-z:]*[a-z](\s|$)/.test(line))
    .map((line) => line.split(" ")[0] ?? "")
    .filter((command) => !["Commands:", "Exit"].includes(command));

  assert.ok(usageCommands.length >= 12, "expected the command list");

  for (const command of usageCommands) {
    assert.ok(
      reference.includes(command),
      `USAGE lists "${command}", which cfkit.md does not document`,
    );
  }

  for (const absent of ["merge", "deploy", "force-push"]) {
    assert.ok(
      reference.includes(absent),
      `the reference must name the refusal set item "${absent}"`,
    );
  }
});

test("engineering docs: every guardrail row names a gate that exists", () => {
  const guardrails = readFileSync(
    join(ROOT, ENGINEERING, "guardrails.md"),
    "utf8",
  );
  const paths = [
    ...guardrails.matchAll(
      /`((?:src|scripts|tools|\.github)[\w./{}*,-]*\.\w+)`/g,
    ),
  ].map((match) => match[1] ?? "");
  const checked = paths.filter(
    (path) => !path.includes("{") && !path.includes("*"),
  );

  assert.ok(
    checked.length >= 8,
    `expected the gate files, found ${String(checked.length)}`,
  );

  for (const path of checked) {
    assert.ok(
      existsSync(join(ROOT, path)),
      `guardrails names ${path}, which does not exist`,
    );
  }

  // The ladder and the suppression policy are part of the map, not optional prose.
  assert.match(guardrails, /Same failure twice ⇒ automate it/);
  assert.match(guardrails, /SMELLS_BASELINE_APPROVED=true/);
  assert.match(guardrails, /`--no-verify` is not in the vocabulary/);
});
