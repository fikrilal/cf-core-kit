import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const REPORT_PATH = ".cfkit/mutation/report.json";

/**
 * A seeded mutation catalogue, not a full mutation-testing tool. Every entry is a recorded,
 * behaviour-changing edit to a pure policy file, paired with the spec that is supposed to notice it.
 * A survivor means the assertion is weaker than the policy claims — which is the only question this
 * pilot answers. Stryker's runners do not match our Workers pool, so the pilot is deliberately a small
 * transparent harness instead of a different engine's config.
 */
export const MUTATIONS = [
  {
    id: "risk.raise-only-neutered",
    file: "tools/cfkit/risk-classifier.ts",
    spec: "tools/cfkit/risk-classifier.test.ts",
    find: "    if (RISK_ORDER[classified.level] > RISK_ORDER[risk]) {",
    replace: "    if (false) {",
    description: "effectiveRisk stops raising the declared risk",
  },
  {
    id: "risk.unknown-default-renamed",
    file: "tools/cfkit/risk-classifier.ts",
    spec: "tools/cfkit/risk-classifier.test.ts",
    find: 'export const UNKNOWN_RULE_ID = "medium.unknown";',
    replace: 'export const UNKNOWN_RULE_ID = "low.unknown";',
    description: "the unmatched-path default reports a different rule id",
  },
  {
    id: "risk.first-match-policy-reversed",
    file: "tools/cfkit/risk-classifier.ts",
    spec: "tools/cfkit/risk-classifier.test.ts",
    find: "  for (const candidate of RISK_RULES) {",
    replace: "  for (const candidate of [...RISK_RULES].reverse()) {",
    description: "last match wins instead of first match",
  },
  {
    id: "risk.runtime-reason-renamed",
    file: "tools/cfkit/risk-classifier.ts",
    spec: "tools/cfkit/risk-classifier.test.ts",
    find: '    id: "path.worker",',
    replace: '    id: "path.worker.renamed",',
    description: "a runtime reason is reported under a different id",
  },
  {
    id: "duration.advisory-neutered",
    file: "tools/cfkit/duration-policy.ts",
    spec: "tools/cfkit/cfkit.test.ts",
    find: "  if (durationMs <= budget.advisoryMs) return undefined;",
    replace: "  if (true) return undefined;",
    description: "durationAdvisory never reports an overrun",
  },
  {
    id: "duration.advisory-boundary-flipped",
    file: "tools/cfkit/duration-policy.ts",
    spec: "tools/cfkit/cfkit.test.ts",
    find: "  if (durationMs <= budget.advisoryMs) return undefined;",
    replace: "  if (durationMs < budget.advisoryMs) return undefined;",
    description: "the advisory boundary is off by one budget",
  },
  {
    id: "duration.observed-baseline-dropped",
    file: "tools/cfkit/duration-policy.ts",
    spec: "tools/cfkit/cfkit.test.ts",
    find: " (observed baseline ${String(budget.observedMs)}ms)",
    replace: "",
    description: "the advisory message loses the calibrated baseline",
  },
];

export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateMutations(mutations) {
  const problems = [];
  const ids = new Set();

  for (const mutation of mutations) {
    if (ids.has(mutation.id)) problems.push(`${mutation.id}: duplicate id`);
    ids.add(mutation.id);
    if (mutation.find === mutation.replace) {
      problems.push(`${mutation.id}: find and replace are identical`);
    }
    if (!existsSync(mutation.file)) {
      problems.push(
        `${mutation.id}: target file does not exist: ${mutation.file}`,
      );
      continue;
    }
    if (!existsSync(mutation.spec)) {
      problems.push(
        `${mutation.id}: spec file does not exist: ${mutation.spec}`,
      );
    }
    if (!readFileSync(mutation.file, "utf8").includes(mutation.find)) {
      problems.push(`${mutation.id}: anchor not found in ${mutation.file}`);
    }
  }

  return problems;
}

/** Applies one mutation, returns the original bytes for an exact restore. */
export function applyMutation(mutation) {
  const original = readFileSync(mutation.file);
  const source = original.toString("utf8");

  if (!source.includes(mutation.find)) {
    throw new Error(`${mutation.id}: anchor not found in ${mutation.file}`);
  }

  writeFileSync(mutation.file, source.replace(mutation.find, mutation.replace));

  return { file: mutation.file, original, hash: hashBytes(original) };
}

export function restoreMutation(entry) {
  writeFileSync(entry.file, entry.original);

  if (hashBytes(readFileSync(entry.file)) !== entry.hash) {
    throw new Error(`${entry.file} did not restore byte-identically`);
  }
}

/**
 * Detected means the spec failed with the mutation applied. A spec that still passes is a survivor,
 * and survivors are the finding — they name an assertion that does not exist yet.
 */
export function runMutation(mutation, options = {}) {
  const command = options.command ?? "node";
  const entry = applyMutation(mutation);

  try {
    const args =
      options.argsFor === undefined
        ? ["--test", mutation.spec]
        : options.argsFor(mutation.spec);
    const result = spawnSync(command, args, {
      cwd: options.root ?? process.cwd(),
      encoding: "utf8",
      timeout: options.timeoutMs ?? 240_000,
    });

    return {
      id: mutation.id,
      file: mutation.file,
      spec: mutation.spec,
      description: mutation.description,
      detected: result.status !== 0,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  } finally {
    restoreMutation(entry);
  }
}

export function runPilot(options = {}) {
  const root = options.root ?? process.cwd();
  const mutations = options.mutations ?? MUTATIONS;
  const problems = validateMutations(mutations);

  if (problems.length > 0) {
    return { results: [], problems, killed: 0, survived: [] };
  }

  const results = mutations.map((mutation) =>
    runMutation(mutation, {
      root,
      ...(options.command === undefined ? {} : { command: options.command }),
      ...(options.argsFor === undefined ? {} : { argsFor: options.argsFor }),
    }),
  );
  const survived = results
    .filter((result) => !result.detected)
    .map((result) => result.id);

  return {
    results,
    problems: [],
    killed: results.length - survived.length,
    survived,
  };
}

export function renderReport(pilot) {
  return `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      catalogue: MUTATIONS.length,
      killed: pilot.killed,
      survived: pilot.survived,
      results: pilot.results.map((result) => ({
        id: result.id,
        file: result.file,
        spec: result.spec,
        description: result.description,
        detected: result.detected,
      })),
    },
    null,
    2,
  )}\n`;
}

function writeReport(root, pilot) {
  const path = join(root, REPORT_PATH);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderReport(pilot));
  console.log(`[mutation] report written to ${REPORT_PATH}`);
}

function main() {
  const root = process.cwd();
  const listOnly = process.argv.includes("--list");
  const pilot = runPilot({ root });

  if (pilot.problems.length > 0) {
    console.error("[mutation] catalogue problems:");
    for (const problem of pilot.problems) console.error(`  x ${problem}`);

    process.exitCode = 1;

    return;
  }

  if (listOnly) {
    for (const mutation of MUTATIONS) {
      console.log(
        `[mutation] ${mutation.id} (${mutation.file}): ${mutation.description}`,
      );
    }

    return;
  }

  for (const result of pilot.results) {
    console.log(
      `[mutation] ${result.detected ? "killed" : "SURVIVED"} ${result.id} (${result.spec})`,
    );
  }

  console.log(
    `[mutation] ${String(pilot.killed)}/${String(MUTATIONS.length)} seeded mutations detected`,
  );
  writeReport(root, pilot);

  if (pilot.survived.length > 0) {
    console.error("[mutation] survivors (an assertion is missing):");
    for (const id of pilot.survived) console.error(`  x ${id}`);

    process.exitCode = 1;

    return;
  }

  console.log("[mutation] all checks passed");
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) main();
