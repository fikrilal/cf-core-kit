import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const PROBE_TIMEOUT_MS = 240_000;

const DUPLICATION_PROBE = `
function probeDuplicationNormalize(input: string): string {
  const trimmed = input.trim();
  const lowered = trimmed.toLowerCase();
  const replaced = lowered.replaceAll(" ", "-");
  const parts = replaced.split("-");
  const kept = parts.filter((part) => part !== "");
  const joined = kept.join("_");
  const finalValue = joined.slice(0, 64);
  return finalValue;
}
`;

/**
 * Each entry plants a known violation, runs the **wired** npm script (never a private reimplementation),
 * asserts the gate's own failure marker, and restores the tree byte-identically. A gate that stops biting
 * fails this harness — which is the point: a gate that cannot fail is not a gate (ADR-0011).
 */
export const GATE_PROBES = [
  {
    gate: "budget:check",
    marker: "[budget] violations:",
    description: "a feature module touching a raw queue binding",
    plant: [
      {
        file: "src/features/auth/shared/repository.ts",
        mode: "append",
        content:
          "\nexport const probeGateQueueBinding = (env: { JOBS: unknown }) =>\n  env.JOBS;\n",
      },
    ],
  },
  {
    gate: "secrets:check",
    marker: "[secrets] findings:",
    description: "a private-key header inside a tracked source file",
    plant: [
      {
        file: "src/platform/crypto/crypto.ts",
        mode: "append",
        content:
          '\n// gate probe: a PEM header must never reach the repository\nconst probeGatePem = "-----BEGIN RSA PRIVATE KEY-----";\nvoid probeGatePem;\n',
      },
    ],
  },
  {
    gate: "drift:check",
    marker: "[drift] violations:",
    description: "a markdown link pointing at a file that does not exist",
    plant: [
      {
        file: "docs/README.md",
        mode: "append",
        content: "\n[gate probe](docs/does-not-exist-gate-probe.md)\n",
      },
    ],
  },
  {
    gate: "contract:check",
    marker: "[contract] violations:",
    description:
      "a committed contract that no longer matches what the routes emit",
    plant: [
      {
        file: "docs/openapi/openapi.yaml",
        mode: "replace",
        find: "info:\n",
        replace: "info:\n  x-gate-probe: true\n",
      },
    ],
  },
  {
    gate: "config:check",
    marker: "[config] violations:",
    description: "a wrangler var that is not a config key",
    plant: [
      {
        file: "wrangler.jsonc",
        mode: "replace",
        find: '"APP_ENV"',
        replace: '"PROBE_GATE_GHOST": "probe",\n      "APP_ENV"',
      },
    ],
  },
  {
    gate: "harness:parity",
    marker: "[harness-parity] violations:",
    description: "a present manifest row citing evidence that does not exist",
    plant: [
      {
        file: "tools/parity/harness.json",
        mode: "json",
        mutate: (data) => {
          const row = data.rows.find(
            (entry) => entry.id === "gates.honesty-meta",
          );

          row.status = "present";
          row.evidencePath = "scripts/gates/does-not-exist.mjs";
        },
      },
    ],
  },
  {
    gate: "smells:check",
    marker: "[smells] new findings:",
    description: "a job module the registry never imports",
    plant: [
      {
        file: "src/features/probe-gate/orphan.jobs.ts",
        mode: "create",
        content:
          'import { z } from "zod";\n\nimport { defineJob } from "../../platform/queue/registry";\n\nexport const orphanProbe = defineJob({\n  name: "probe.orphan",\n  payloadSchema: z.object({}),\n  handle: async () => undefined,\n});\n',
      },
    ],
  },
  {
    gate: "duplication:check",
    marker: "[duplication] actionable clones",
    description: "a twelve-line helper copied into two tracked files",
    plant: [
      {
        file: "src/shared/contract/auth.ts",
        mode: "append",
        content: DUPLICATION_PROBE,
      },
      {
        file: "src/shared/contract/users.ts",
        mode: "append",
        content: DUPLICATION_PROBE,
      },
    ],
  },
];

export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function applyPlants(root, ops) {
  const journal = [];

  for (const op of ops) {
    const path = join(root, op.file);
    const original = existsSync(path) ? readFileSync(path) : undefined;

    journal.push({
      file: op.file,
      path,
      original,
      hash: original === undefined ? undefined : hashBytes(original),
    });

    if (op.mode === "create") {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, op.content);

      continue;
    }

    const bytes = original ?? Buffer.from("");
    const source = bytes.toString("utf8");
    let mutated;

    if (op.mode === "append") {
      mutated = `${source}${op.content}`;
    } else if (op.mode === "replace") {
      if (!source.includes(op.find)) {
        throw new Error(
          `gate probe target ${op.file} does not contain ${op.find}`,
        );
      }

      mutated = source.replace(op.find, op.replace);
    } else if (op.mode === "json") {
      const data = JSON.parse(source);

      op.mutate(data);
      mutated = `${JSON.stringify(data, null, 2)}\n`;
    } else {
      throw new Error(`unknown plant mode ${String(op.mode)}`);
    }

    writeFileSync(path, mutated);
  }

  return journal;
}

/** A created file must not leave its new parent directories behind (they show up in boundary scans). */
function pruneEmptyParents(root, path) {
  let current = dirname(path);

  while (current !== root && current.startsWith(`${root}/`)) {
    if (readdirSync(current).length > 0) return;

    rmdirSync(current);
    current = dirname(current);
  }
}

export function restorePlants(journal, root) {
  const problems = [];

  for (const entry of journal) {
    if (entry.original === undefined) {
      if (existsSync(entry.path))
        rmSync(entry.path, { recursive: true, force: true });
      if (existsSync(entry.path))
        problems.push(`${entry.file} was not removed`);
      if (root !== undefined) pruneEmptyParents(root, entry.path);

      continue;
    }

    writeFileSync(entry.path, entry.original);

    const restored = readFileSync(entry.path);

    if (hashBytes(restored) !== entry.hash) {
      problems.push(`${entry.file} did not restore byte-identically`);
    }
  }

  return problems;
}

export function runGateProbe(input) {
  const result = spawnSync(input.command, input.args ?? [], {
    cwd: input.cwd,
    encoding: "utf8",
    timeout: input.timeoutMs ?? PROBE_TIMEOUT_MS,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    return {
      ok: false,
      output,
      reason: "the gate passed with a violation planted",
    };
  }
  if (!output.includes(input.marker)) {
    return {
      ok: false,
      output,
      reason: `the gate failed without its marker ${input.marker}`,
    };
  }

  return { ok: true, output, reason: "failed with the expected marker" };
}

export function probeGate(root, probe) {
  const journal = applyPlants(root, probe.plant);
  let result;
  let problems;

  try {
    result = runGateProbe({
      command: "npm",
      args: ["run", "--silent", probe.gate],
      cwd: root,
      marker: probe.marker,
    });
  } finally {
    problems = restorePlants(journal, root);
  }

  if (problems.length > 0) {
    throw new Error(`restore failed: ${problems.join("; ")}`);
  }

  return result;
}

function main() {
  const root = process.cwd();
  const failures = [];

  for (const probe of GATE_PROBES) {
    process.stdout.write(`[gates] ${probe.gate} <- ${probe.description} ... `);

    try {
      const result = probeGate(root, probe);

      if (result.ok) {
        console.log("ok (marker seen, tree restored)");

        continue;
      }

      console.log(`FAILED (${result.reason})`);
      failures.push(`${probe.gate}: ${result.reason}`);
      console.error(result.output.split("\n").slice(-8).join("\n"));
    } catch (error) {
      console.log(
        `FAILED (${String(error instanceof Error ? error.message : error)})`,
      );
      failures.push(probe.gate);
    }
  }

  console.log(
    `[gates] ${String(GATE_PROBES.length - failures.length)}/${String(GATE_PROBES.length)} gates bite`,
  );

  if (failures.length > 0) {
    console.error("[gates] gates that stopped biting:");
    for (const failure of failures) console.error(`  x ${failure}`);

    process.exitCode = 1;

    return;
  }

  console.log("[gates] all checks passed");
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) main();
