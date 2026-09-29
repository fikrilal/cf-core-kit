import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STATUSES = new Set(["present", "declared-only", "missing"]);
const ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateManifest(manifest, options) {
  const { root, scriptNames } = options;
  const violations = [];

  if (!isRecord(manifest)) return ["manifest must be an object"];
  if (manifest.schemaVersion !== 1) {
    violations.push("schemaVersion must be 1");
  }

  if (!Array.isArray(manifest.rows)) {
    violations.push("rows must be an array");

    return violations;
  }
  if (manifest.rows.length === 0) violations.push("rows must not be empty");

  const seen = new Set();

  for (const [index, row] of manifest.rows.entries()) {
    if (!isRecord(row)) {
      violations.push(`row ${String(index)} must be an object`);
      continue;
    }

    const id = typeof row.id === "string" ? row.id : `row ${String(index)}`;

    if (typeof row.id !== "string" || !ID_PATTERN.test(row.id)) {
      violations.push(`${id}: id must be a dotted kebab-case id`);
      continue;
    }
    if (seen.has(row.id)) violations.push(`${row.id}: duplicate id`);
    seen.add(row.id);

    for (const field of ["area", "family", "target"]) {
      if (typeof row[field] !== "string" || row[field] === "") {
        violations.push(`${row.id}: missing ${field}`);
      }
    }
    if (!Number.isInteger(row.plan) || row.plan < 1 || row.plan > 99) {
      violations.push(`${row.id}: plan must be an integer between 1 and 99`);
    }
    if (row.note !== undefined && typeof row.note !== "string") {
      violations.push(`${row.id}: note must be a string`);
    }
    if (typeof row.status !== "string" || !STATUSES.has(row.status)) {
      violations.push(`${row.id}: unknown status "${String(row.status)}"`);
      continue;
    }

    if (
      row.evidencePath !== undefined &&
      typeof row.evidencePath !== "string"
    ) {
      violations.push(`${row.id}: evidencePath must be a string`);
    }
    if (
      row.evidenceCommand !== undefined &&
      typeof row.evidenceCommand !== "string"
    ) {
      violations.push(`${row.id}: evidenceCommand must be a string`);
    }

    const hasEvidence =
      (row.evidencePath !== undefined &&
        typeof row.evidencePath === "string") ||
      (row.evidenceCommand !== undefined &&
        typeof row.evidenceCommand === "string");

    if (row.status === "present") {
      if (!hasEvidence) {
        violations.push(
          `${row.id}: present rows need evidencePath or evidenceCommand`,
        );
      }
      if (
        typeof row.evidencePath === "string" &&
        !existsSync(join(root, row.evidencePath))
      ) {
        violations.push(
          `${row.id}: evidencePath does not exist: ${row.evidencePath}`,
        );
      }
      if (
        typeof row.evidenceCommand === "string" &&
        !scriptNames.has(row.evidenceCommand)
      ) {
        violations.push(
          `${row.id}: evidenceCommand is not a package.json script: ${row.evidenceCommand}`,
        );
      }
    } else if (hasEvidence) {
      violations.push(`${row.id}: ${row.status} rows must not claim evidence`);
    }
  }

  return violations;
}

function main() {
  const root = process.cwd();
  const manifest = JSON.parse(
    readFileSync(join(root, "tools/parity/harness.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const scriptNames = new Set(Object.keys(packageJson.scripts ?? {}));
  const violations = validateManifest(manifest, { root, scriptNames });

  if (violations.length > 0) {
    console.error("[harness-parity] violations:");

    for (const violation of violations) console.error(`  x ${violation}`);

    return 1;
  }

  const counts = { present: 0, "declared-only": 0, missing: 0 };

  for (const row of manifest.rows) counts[row.status] += 1;

  console.log(
    `[harness-parity] rows: present ${String(counts.present)}, declared-only ${String(counts["declared-only"])}, missing ${String(counts.missing)}`,
  );
  console.log("[harness-parity] all checks passed");

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
