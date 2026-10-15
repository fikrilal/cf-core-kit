import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parse as parseYaml } from "yaml";

/**
 * The CI lanes are a contract: which jobs exist, which ones are conditional, who aggregates them, and that no
 * lane inlines what a profile already contains. Parsing the workflow (rather than scanning its text) means a
 * restructured job is caught even when the strings still look right.
 */
const WORKFLOW = readFileSync(
  join(process.cwd(), ".github", "workflows", "ci.yml"),
  "utf8",
);
const DEPENDABOT = readFileSync(
  join(process.cwd(), ".github", "dependabot.yml"),
  "utf8",
);
const TEMPLATE = readFileSync(
  join(process.cwd(), ".github", "pull_request_template.md"),
  "utf8",
);

const workflow = parseYaml(WORKFLOW);

function step(job, predicate) {
  const found = workflow.jobs[job]?.steps.find(predicate);

  if (found === undefined) throw new Error(`no such step in job ${job}`);

  return found;
}

function runSteps(job) {
  return workflow.jobs[job]?.steps
    .map((entry) => entry.run)
    .filter((entry) => entry !== undefined);
}

test("ci workflow: the lanes exist and are wired to each other", () => {
  assert.deepEqual(Object.keys(workflow.jobs).sort(), [
    "full",
    "governance",
    "required",
    "risk",
    "runtime",
  ]);

  // The classifier feeds the conditional lane, and the aggregate waits for all four.
  assert.deepEqual(workflow.jobs.risk.outputs, {
    effective_risk: "${{ steps.classify.outputs.effective_risk }}",
    runtime_required: "${{ steps.classify.outputs.runtime_required }}",
  });
  assert.equal(workflow.jobs.full.needs, "risk");
  assert.equal(workflow.jobs.runtime.needs, "risk");
  assert.equal(
    workflow.jobs.runtime.if,
    "needs.risk.outputs.runtime_required == 'true'",
  );
  assert.equal(
    workflow.jobs.governance.if,
    "github.event_name == 'pull_request'",
  );
  assert.equal(workflow.jobs.required.if, "always()");
  assert.deepEqual(workflow.jobs.required.needs, [
    "risk",
    "full",
    "runtime",
    "governance",
  ]);

  // The aggregate tolerates `skipped` for conditional lanes and nothing else.
  const aggregate = runSteps("required").join("\n");

  assert.match(aggregate, /success\|skipped/);
  assert.match(aggregate, /risk=\$\{\{ needs\.risk\.result \}\}/);
});

test("ci workflow: the classifier resolves a base revision and emits its outputs", () => {
  const classify = step(
    "risk",
    (entry) => entry.run?.includes("ci:classify") === true,
  );

  assert.equal(classify.name, "Classify the diff");
  assert.match(classify.run ?? "", /github\.event\.pull_request\.base\.sha/);
  assert.match(classify.run ?? "", /0{40}/);
  assert.match(classify.run ?? "", /git rev-parse HEAD\^/);
  assert.match(classify.run ?? "", />> "\$GITHUB_OUTPUT"/);
  // `$GITHUB_OUTPUT` rejects anything that is not `key=value`, so the step must silence npm's banner and
  // filter to the contract lines — the first CI run failed on exactly this.
  assert.match(
    classify.run ?? "",
    /npm run --silent ci:classify -- --base "\$BASE" --head/,
  );
  assert.match(
    classify.run ?? "",
    /grep -E '\^\(effective_risk\|runtime_required\)='/,
  );
});

test("ci workflow: the full lane runs the profile and the runtime lane is its own", () => {
  const full = runSteps("full").join("\n");
  const runtime = runSteps("runtime").join("\n");

  assert.match(full, /npm run cfkit -- verify --profile full/);
  assert.doesNotMatch(full, /--profile runtime|--profile smoke/);
  assert.match(runtime, /npm run cfkit -- verify --profile runtime/);
  assert.match(runtime, /npm run cfkit -- verify --profile smoke/);
  assert.match(runtime, /npm ci --include=dev/);
});

test("ci workflow: no lane inlines a profile's internals", () => {
  for (const job of Object.keys(workflow.jobs)) {
    for (const command of runSteps(job)) {
      assert.doesNotMatch(
        command,
        /\b(eslint|vitest|prettier|tsc|jscpd|spectral|wrangler)\b/,
        `${job} inlines a profile step: ${command}`,
      );
    }
  }
});

test("ci workflow: governance covers dependencies, secrets and the production audit", () => {
  assert.equal(
    step("governance", (entry) =>
      entry.uses?.startsWith("actions/dependency-review-action"),
    ).with?.["fail-on-severity"],
    "high",
  );
  assert.equal(
    step("governance", (entry) =>
      entry.uses?.startsWith("gitleaks/gitleaks-action"),
    ).env?.GITHUB_TOKEN,
    "${{ secrets.GITHUB_TOKEN }}",
  );
  assert.match(runSteps("governance").join("\n"), /npm run secrets:check/);
  assert.match(runSteps("governance").join("\n"), /npm run audit:prod/);
  assert.ok((workflow.jobs.governance.steps ?? []).length >= 6);
});

test("ci workflow: every action is pinned to a 40-hex commit with its tag in a comment", () => {
  const uses = WORKFLOW.split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .filter((line) => line.startsWith("uses:"));

  assert.ok(
    uses.length >= 5,
    "expected the checkout, setup-node and governance actions",
  );

  for (const line of uses) {
    assert.match(
      line,
      /^uses: [\w-]+\/[\w-]+@[0-9a-f]{40} # v[\w.-]+$/,
      `unpinned action: ${line}`,
    );
  }
});

test("ci workflow: least-privilege permissions and no persisted credentials", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.doesNotMatch(WORKFLOW, /permissions:[\s\S]*?write/m);

  const checkouts = WORKFLOW.split("\n").filter((line) =>
    line.includes("actions/checkout@"),
  );

  assert.equal(checkouts.length, 4);

  for (const job of Object.keys(workflow.jobs)) {
    const checkout = workflow.jobs[job].steps.find((entry) =>
      entry.uses?.includes("actions/checkout"),
    );

    if (checkout === undefined) continue;

    assert.equal(
      checkout.with?.["persist-credentials"],
      false,
      `${job} must not persist credentials`,
    );
  }

  // The classifier and the history scan both need the full history.
  assert.equal(
    step("risk", (entry) => entry.uses?.includes("actions/checkout")).with?.[
      "fetch-depth"
    ],
    0,
  );
  assert.equal(
    step("governance", (entry) => entry.uses?.includes("actions/checkout"))
      .with?.["fetch-depth"],
    0,
  );
});

test("ci workflow: runs the profiles with dev dependencies and keeps the concurrency guard", () => {
  for (const job of ["risk", "full", "runtime", "governance"]) {
    assert.match(runSteps(job).join("\n"), /npm ci --include=dev/);
  }

  assert.match(WORKFLOW, /^concurrency:$/m);
  assert.match(WORKFLOW, /cancel-in-progress: true/);
});

test("ci governance: dependabot keeps npm and the action pins fresh", () => {
  const dependabot = parseYaml(DEPENDABOT);

  assert.deepEqual(
    dependabot.updates.map((entry) => entry["package-ecosystem"]),
    ["npm", "github-actions"],
  );

  for (const entry of dependabot.updates) {
    assert.equal(entry.schedule.interval, "weekly");
  }
});

test("ci workflow: the pull request template asks for what a reviewer needs", () => {
  for (const heading of [
    "Risk class",
    "Impact areas",
    "Contract and parity impact",
    "Runtime evidence",
    "Checks not run, and why",
  ]) {
    assert.match(TEMPLATE, new RegExp(`^## ${heading}$`, "m"));
  }

  for (const area of [
    "API / contract",
    "DB / migrations",
    "Auth / session",
    "Queue / jobs",
    "Config / secrets",
    "Observability",
    "Budget / free-tier footprint",
    "Harness / CI",
  ]) {
    assert.ok(TEMPLATE.includes(area), `the template must ask about ${area}`);
  }
});
