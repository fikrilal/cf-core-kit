import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

import { renderEmittedYaml } from "./emit.mjs";

export const PROVENANCE_PATH = "contracts/provenance.json";
export const MANIFEST_PATH = "tools/parity/coverage.json";
export const EMITTED_PATH = "docs/openapi/openapi.yaml";

const ROOT_FIELDS = ["artifact", "sha256", "bytes", "pinnedAt"];
const SOURCE_FIELDS = ["repo", "branch", "commit", "path", "version"];
const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

function violation(detail, file = PROVENANCE_PATH) {
  return { file, rule: "provenance", detail };
}

function parityViolation(detail, file = MANIFEST_PATH) {
  return { file, rule: "parity", detail };
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function verifyProvenanceShape(provenance) {
  if (typeof provenance !== "object" || provenance === null) {
    return [violation("provenance is not an object")];
  }

  const violations = [];

  for (const field of ROOT_FIELDS) {
    if (provenance[field] === undefined)
      violations.push(violation(`missing field: ${field}`));
  }

  const source = provenance.source;
  if (typeof source !== "object" || source === null) {
    violations.push(violation("missing source block"));

    return violations;
  }

  for (const field of SOURCE_FIELDS) {
    if (typeof source[field] !== "string")
      violations.push(violation(`missing source.${field}`));
  }

  return violations;
}

export function verifyProvenance(provenance, artifact) {
  const violations = verifyProvenanceShape(provenance);
  if (violations.length > 0) return violations;

  if (artifact === undefined) {
    return [violation("pinned snapshot file is missing", provenance.artifact)];
  }

  const actualSha = sha256(artifact);
  if (actualSha !== provenance.sha256) {
    violations.push(
      violation(
        `sha256 mismatch: expected ${provenance.sha256}, actual ${actualSha}`,
        provenance.artifact,
      ),
    );
  }

  if (artifact.byteLength !== provenance.bytes) {
    violations.push(
      violation(
        `byte size mismatch: expected ${String(provenance.bytes)}, actual ${String(artifact.byteLength)}`,
        provenance.artifact,
      ),
    );
  }

  return violations;
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const COSMETIC_SCHEMA_KEYS = new Set(["description", "example"]);

function normalizeForCompare(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForCompare(item));
  }

  if (!isPlainRecord(value)) return value;

  const flattened =
    Array.isArray(value.allOf) &&
    value.allOf.length === 1 &&
    isPlainRecord(value.allOf[0])
      ? { ...value.allOf[0], ...omitKey(value, "allOf") }
      : value;

  const normalized = {};
  for (const [key, item] of Object.entries(flattened)) {
    if (COSMETIC_SCHEMA_KEYS.has(key)) continue;
    normalized[key] = normalizeForCompare(item);
  }

  return normalized;
}

function omitKey(record, key) {
  const result = {};
  for (const [entryKey, item] of Object.entries(record)) {
    if (entryKey === key) continue;
    result[entryKey] = item;
  }

  return result;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function lookupPointer(document, pointer) {
  const segments = pointer
    .replace(/^#\//, "")
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current = document;
  for (const segment of segments) {
    if (!isPlainRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }

  return current;
}

export function resolveRefs(value, document, depth = 0) {
  if (depth > 64) return value;

  if (Array.isArray(value)) {
    return value.map((item) => resolveRefs(item, document, depth + 1));
  }

  if (!isPlainRecord(value)) return value;

  if (typeof value.$ref === "string") {
    const target = lookupPointer(document, value.$ref);

    return target === undefined
      ? value
      : resolveRefs(target, document, depth + 1);
  }

  const resolved = {};
  for (const [key, item] of Object.entries(value)) {
    resolved[key] = resolveRefs(item, document, depth + 1);
  }

  return resolved;
}

export function collectOperations(document) {
  const operations = [];
  const paths = document?.paths;

  if (!isPlainRecord(paths)) return operations;

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isPlainRecord(pathItem)) continue;

    for (const method of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;

      const operation = pathItem[method];
      if (
        isPlainRecord(operation) &&
        typeof operation.operationId === "string"
      ) {
        operations.push({
          path,
          method,
          operationId: operation.operationId,
          operation,
        });
      }
    }
  }

  return operations;
}

export function matchPattern(pattern, operationId) {
  if (pattern.endsWith("*"))
    return operationId.startsWith(pattern.slice(0, -1));

  return pattern === operationId;
}

export function checkClassification(snapshotIds, manifest) {
  const violations = [];
  const buckets = [
    ["implemented", manifest?.implemented],
    ["pending", manifest?.pending],
    [
      "descoped",
      Array.isArray(manifest?.descoped)
        ? manifest.descoped.flatMap((entry) => entry.operations ?? [])
        : undefined,
    ],
  ];
  const seen = new Map();

  for (const [name, patterns] of buckets) {
    if (!Array.isArray(patterns)) {
      violations.push(
        parityViolation(
          `manifest.${name} must be a list of operation ids or patterns`,
        ),
      );
      continue;
    }

    for (const pattern of patterns) {
      const matches = snapshotIds.filter((id) => matchPattern(pattern, id));
      if (matches.length === 0) {
        violations.push(
          parityViolation(
            `pattern matches no snapshot operation: ${name}: ${pattern}`,
          ),
        );
      }

      for (const id of matches) {
        if (seen.has(id)) {
          violations.push(
            parityViolation(
              `operation classified twice: ${id} (${seen.get(id)} and ${name})`,
            ),
          );
        } else {
          seen.set(id, name);
        }
      }
    }
  }

  for (const id of snapshotIds) {
    if (!seen.has(id))
      violations.push(parityViolation(`operation not classified: ${id}`));
  }

  for (const entry of manifest?.descoped ?? []) {
    for (const field of ["reason", "revisit", "adr"]) {
      if (typeof entry[field] !== "string" || entry[field] === "") {
        violations.push(parityViolation(`descoped entry is missing ${field}`));
      }
    }
  }

  return violations;
}

export function compareOperationShapes(context) {
  const {
    snapshotOperation,
    emittedOperation,
    snapshotDocument,
    emittedDocument,
  } = context;
  const violations = [];
  const hint = `${snapshotOperation.method.toUpperCase()} ${snapshotOperation.path}`;

  if (snapshotOperation.operationId !== emittedOperation.operationId) {
    violations.push(parityViolation(`operationId mismatch at ${hint}`));
  }

  const snapshotTags = [...(snapshotOperation.operation.tags ?? [])].sort();
  const emittedTags = [...(emittedOperation.operation.tags ?? [])].sort();
  if (stableStringify(snapshotTags) !== stableStringify(emittedTags)) {
    violations.push(
      parityViolation(
        `tags differ at ${hint}: [${snapshotTags}] vs [${emittedTags}]`,
      ),
    );
  }

  const snapshotCodes = [
    ...(snapshotOperation.operation["x-error-codes"] ?? []),
  ].sort();
  const emittedCodes = [
    ...(emittedOperation.operation["x-error-codes"] ?? []),
  ].sort();
  if (stableStringify(snapshotCodes) !== stableStringify(emittedCodes)) {
    violations.push(
      parityViolation(
        `x-error-codes differ at ${hint}: [${snapshotCodes}] vs [${emittedCodes}]`,
      ),
    );
  }

  const snapshotParameters = normalizeForCompare(
    snapshotOperation.operation.parameters ?? [],
  );
  const emittedParameters = normalizeForCompare(
    emittedOperation.operation.parameters ?? [],
  );
  if (
    stableStringify(snapshotParameters) !== stableStringify(emittedParameters)
  ) {
    violations.push(parityViolation(`parameters differ at ${hint}`));
  }

  const snapshotResponses = snapshotOperation.operation.responses ?? {};
  const emittedResponses = emittedOperation.operation.responses ?? {};
  const snapshotStatuses = Object.keys(snapshotResponses).sort();
  const emittedStatuses = Object.keys(emittedResponses).sort();

  if (stableStringify(snapshotStatuses) !== stableStringify(emittedStatuses)) {
    violations.push(
      parityViolation(
        `response statuses differ at ${hint}: [${snapshotStatuses}] vs [${emittedStatuses}]`,
      ),
    );
  }

  for (const status of snapshotStatuses) {
    if (!(status in emittedResponses)) continue;

    const snapshotContent = normalizeForCompare(
      resolveRefs(snapshotResponses[status]?.content, snapshotDocument),
    );
    const emittedContent = normalizeForCompare(
      resolveRefs(emittedResponses[status]?.content, emittedDocument),
    );

    if (stableStringify(snapshotContent) !== stableStringify(emittedContent)) {
      violations.push(
        parityViolation(`response schema drift at ${hint}, status ${status}`),
      );
    }
  }

  return violations;
}

export function checkParity(context) {
  const { snapshotDocument, emittedDocument, manifest } = context;
  const violations = [];
  const snapshotOperations = collectOperations(snapshotDocument);
  const emittedOperations = collectOperations(emittedDocument);

  violations.push(
    ...checkClassification(
      snapshotOperations.map((operation) => operation.operationId),
      manifest,
    ),
  );

  const implemented = Array.isArray(manifest?.implemented)
    ? manifest.implemented
    : [];

  for (const operationId of implemented) {
    const snapshotOperation = snapshotOperations.find(
      (candidate) => candidate.operationId === operationId,
    );
    const emittedOperation = emittedOperations.find(
      (candidate) => candidate.operationId === operationId,
    );

    if (emittedOperation === undefined) {
      violations.push(
        parityViolation(
          `implemented operation missing from emitted snapshot: ${operationId}`,
        ),
      );
      continue;
    }

    if (snapshotOperation === undefined) continue;

    violations.push(
      ...compareOperationShapes({
        snapshotOperation,
        emittedOperation,
        snapshotDocument,
        emittedDocument,
      }),
    );
  }

  for (const operation of emittedOperations) {
    if (!implemented.includes(operation.operationId)) {
      violations.push(
        parityViolation(
          `emitted operation is not declared implemented: ${operation.operationId}`,
        ),
      );
    }
  }

  return violations;
}

export function checkErrorCodeVocabulary(snapshotDocument, errorCodesSource) {
  const declared = new Set();

  for (const operation of collectOperations(snapshotDocument)) {
    const codes = operation.operation["x-error-codes"];
    if (!Array.isArray(codes)) continue;

    for (const code of codes) {
      if (typeof code === "string") declared.add(code);
    }
  }

  const violations = [];
  const file = "src/shared/error-codes.ts";

  for (const match of errorCodesSource.matchAll(/=\s*"([A-Z0-9_]+)"/g)) {
    const value = match[1];
    if (value !== undefined && !declared.has(value)) {
      violations.push(
        parityViolation(
          `error code not in the pinned snapshot vocabulary: ${value}`,
          file,
        ),
      );
    }
  }

  return violations;
}

export function checkEmitDrift(result) {
  if (result.error !== undefined && result.error !== "") {
    return [
      {
        file: EMITTED_PATH,
        rule: "emit",
        detail: `emit failed: ${result.error}`,
      },
    ];
  }

  if (result.committed === undefined) {
    return [
      {
        file: EMITTED_PATH,
        rule: "emit",
        detail: "committed snapshot is missing; run npm run contract:emit",
      },
    ];
  }

  if (result.emitted !== result.committed) {
    return [
      {
        file: EMITTED_PATH,
        rule: "emit",
        detail:
          "committed snapshot is stale relative to route definitions; run npm run contract:emit",
      },
    ];
  }

  return [];
}

export async function runChecks(root) {
  const provenancePath = join(root, PROVENANCE_PATH);
  let provenance;

  try {
    provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  } catch (error) {
    return {
      violations: [violation(`could not read provenance: ${String(error)}`)],
      details: {},
    };
  }

  const artifactPath =
    typeof provenance?.artifact === "string"
      ? join(root, provenance.artifact)
      : undefined;
  const artifact =
    artifactPath !== undefined && existsSync(artifactPath)
      ? readFileSync(artifactPath)
      : undefined;

  const emittedPath = join(root, EMITTED_PATH);
  const committed = existsSync(emittedPath)
    ? readFileSync(emittedPath, "utf8")
    : undefined;
  let emitted;
  let emitError;

  try {
    emitted = await renderEmittedYaml(root);
  } catch (error) {
    emitError = String(error);
  }

  const violations = [
    ...verifyProvenance(provenance, artifact),
    ...checkEmitDrift({ emitted, committed, error: emitError }),
  ];

  let parity = "skipped (emit failed)";

  if (emitted !== undefined) {
    try {
      const snapshotDocument = parse(
        readFileSync(join(root, "contracts", "backend.openapi.yaml"), "utf8"),
      );
      const emittedDocument = parse(emitted);
      const manifest = JSON.parse(
        readFileSync(join(root, MANIFEST_PATH), "utf8"),
      );

      if (manifest?.source?.sha256 !== provenance.sha256) {
        violations.push(
          parityViolation(
            "manifest source sha256 does not match provenance; re-pin the manifest with the snapshot",
          ),
        );
      }

      const parityViolations = checkParity({
        snapshotDocument,
        emittedDocument,
        manifest,
      });
      const vocabularyViolations = checkErrorCodeVocabulary(
        snapshotDocument,
        readFileSync(join(root, "src", "shared", "error-codes.ts"), "utf8"),
      );
      violations.push(...parityViolations, ...vocabularyViolations);
      parity =
        parityViolations.length === 0 && vocabularyViolations.length === 0
          ? "ok"
          : "violations";
    } catch (error) {
      violations.push(parityViolation(`parity check failed: ${String(error)}`));
      parity = "failed";
    }
  }

  return {
    violations,
    details: {
      commit: provenance?.source?.commit,
      sha256: artifact === undefined ? "missing" : sha256(artifact),
      emit:
        emitError !== undefined
          ? "emit failed"
          : emitted === committed
            ? "up to date"
            : "stale",
      parity,
    },
  };
}

async function main() {
  const result = await runChecks(process.cwd());
  const commit =
    typeof result.details.commit === "string"
      ? result.details.commit.slice(0, 12)
      : "unknown";

  console.log(
    `[contract] pinned backend snapshot at ${commit} (${String(result.details.sha256).slice(0, 12)})`,
  );
  console.log(`[contract] emitted snapshot: ${String(result.details.emit)}`);
  console.log(`[contract] parity: ${String(result.details.parity)}`);

  if (result.violations.length === 0) {
    console.log("[contract] all checks passed");

    return;
  }

  console.error("[contract] violations:");
  for (const entry of result.violations) {
    console.error(`  x [${entry.rule}] ${entry.file}: ${entry.detail}`);
  }

  process.exit(1);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await main();
}
