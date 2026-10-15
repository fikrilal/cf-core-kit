import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The family tree comparison. `tools/parity/family-map.json` records the family artifact each manifest row was
 * ported from, so the parity claim is traceable to a path rather than to memory. With `--family <path>` the map
 * is validated against the family checkout; without it (the default, and all CI has) the map is validated
 * against our own manifest, which is the half that can never be assumed.
 */
export const MAP_PATH = "tools/parity/family-map.json";
export const MANIFEST_PATH = "tools/parity/harness.json";
export const MIN_MAPPED_ROWS = 30;

export function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

export function validateMap(root, familyRoot, override) {
  const map = override ?? readJson(root, MAP_PATH);
  const manifest = readJson(root, MANIFEST_PATH);
  const problems = [];
  const ids = new Set(manifest.rows.map((row) => row.id));

  if (
    typeof map.recordedOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(map.recordedOn)
  ) {
    problems.push(`${MAP_PATH}: recordedOn must be a date`);
  }
  if (!Array.isArray(map.entries)) {
    problems.push(`${MAP_PATH}: entries must be an array`);

    return problems;
  }
  // A thin map is a finding, not an early exit: the entries it does have are still validated.
  if (map.entries.length < MIN_MAPPED_ROWS) {
    problems.push(
      `${MAP_PATH}: expected at least ${String(MIN_MAPPED_ROWS)} mapped rows, found ${String(map.entries.length)}`,
    );
  }

  const seen = new Set();

  for (const entry of map.entries) {
    if (!ids.has(entry.id)) {
      problems.push(`${MAP_PATH}: "${String(entry.id)}" is not a manifest row`);
    }
    if (seen.has(entry.id)) {
      problems.push(`${MAP_PATH}: "${String(entry.id)}" is mapped twice`);
    }
    seen.add(entry.id);

    if (entry.familyPath === null) {
      // A recorded deviation, not a gap: it needs a reason and nothing else.
      if (typeof entry.note !== "string" || entry.note.length < 20) {
        problems.push(
          `${MAP_PATH}: "${String(entry.id)}" has no familyPath, so it needs a note`,
        );
      }

      continue;
    }
    if (typeof entry.familyPath !== "string" || entry.familyPath === "") {
      problems.push(
        `${MAP_PATH}: "${String(entry.id)}" needs a familyPath or null`,
      );
      continue;
    }
    if (entry.kind !== "file" && entry.kind !== "dir") {
      problems.push(`${MAP_PATH}: "${String(entry.id)}" needs kind file|dir`);
    }

    if (familyRoot === undefined) continue;

    const absolute = join(familyRoot, entry.familyPath);

    if (!existsSync(absolute)) {
      problems.push(
        `${MAP_PATH}: the family has no ${entry.familyPath} (row ${String(entry.id)})`,
      );

      continue;
    }
    const isDirectory = statSync(absolute).isDirectory();

    if (entry.kind === "dir" && !isDirectory) {
      problems.push(
        `${MAP_PATH}: ${entry.familyPath} is a file, not a directory`,
      );
    }
    if (entry.kind === "file" && isDirectory) {
      problems.push(
        `${MAP_PATH}: ${entry.familyPath} is a directory, not a file`,
      );
    }
  }

  return problems;
}

function main() {
  const root = process.cwd();
  const familyIndex = process.argv.indexOf("--family");
  const familyRoot =
    familyIndex === -1 ? undefined : process.argv[familyIndex + 1];
  const problems = validateMap(root, familyRoot);
  const map = readJson(root, MAP_PATH);

  console.log(
    `[parity:tree] mapped rows ${String(map.entries.length)}; family checkout ${familyRoot === undefined ? "not compared (pass --family <path>)" : familyRoot}`,
  );

  if (problems.length > 0) {
    console.error("[parity:tree] violations:");
    for (const problem of problems) console.error(`  x ${problem}`);

    process.exitCode = 1;

    return;
  }

  console.log("[parity:tree] all checks passed");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
