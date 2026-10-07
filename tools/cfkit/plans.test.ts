import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ACTIVE_METADATA_KEYS,
  ACTIVE_REQUIRED_SECTIONS,
  formatPlanReport,
  listPlans,
  parsePlan,
  planSummary,
  PLANS_DIRECTORY,
  PLAN_TEMPLATE_FILE,
  validatePlans,
} from "./plans.ts";

const ROOT = process.cwd();

function activePlan(overrides: Record<string, string> = {}): string {
  const headers: Record<string, string> = {
    Status: "active",
    Owner: "fikrilal",
    "Task ID": "sample-task",
    Risk: "low",
    "Maximum risk": "medium",
    Authority: "edit, verify",
    "Repair limit": "2",
    "Task timeout": "30m",
    Date: "2026-10-13",
    "Impact areas": "API/contract: no",
    "Allowed paths": "docs/exec-plans/active/sample-task.md",
    "Allowed actions": "edit, verify",
    ...overrides,
  };
  const body = Object.entries(headers)
    .filter(([, value]) => value !== "-drop-")
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

  return `# Sample plan

${body}

## Objective

Do the thing.

## Steps

- [x] First step

## Acceptance Criteria

1. The thing is done.

## Verification

\`\`\`bash
npm run verify
\`\`\`
`;
}

function plan(source: string, folder: "active" | "completed" = "active") {
  return parsePlan(
    `${PLANS_DIRECTORY}/${folder}/sample-task.md`,
    folder,
    source,
  );
}

test("plans: a complete active plan validates", () => {
  const plans = [plan(activePlan())];

  assert.deepEqual(validatePlans(plans), []);
  assert.deepEqual(planSummary(plans), { active: 1, queued: 0, completed: 0 });
  assert.match(formatPlanReport(plans), /active 1, queued 0, completed 0/);
});

test("plans: status must match the folder", () => {
  const mismatch = plan(activePlan({ Status: "completed" }));

  assert.deepEqual(validatePlans([mismatch]), [
    'docs/exec-plans/active/sample-task.md: - Status: "completed" does not match the folder (expected "active")',
  ]);

  const missing = parsePlan(
    `${PLANS_DIRECTORY}/completed/sample-task.md`,
    "completed",
    "# No headers\n\n## Objective\nx\n\n## Verification\nx\n",
  );

  assert.deepEqual(validatePlans([missing]), [
    'docs/exec-plans/completed/sample-task.md: missing required header "- Status:"',
  ]);
});

test("plans: completed plans must not carry unchecked steps", () => {
  const unchecked = plan(
    `# Done

- Status: completed
- Owner: fikrilal

## Objective

x

## Verification

x

## Steps

- [ ] Never ran
`,
    "completed",
  );

  const problems = validatePlans([unchecked]);

  assert.equal(problems.length, 1);
  assert.match(
    problems[0] ?? "",
    /must not carry unchecked steps \(\(?- \[ \] Never ran\)?/,
  );
});

test("plans: task ids are unique and well formed", () => {
  const first = plan(activePlan());
  const second = parsePlan(
    `${PLANS_DIRECTORY}/completed/sample-task.md`,
    "completed",
    `# Duplicate\n\n- Status: completed\n\n## Objective\nx\n\n## Verification\nx\n`,
  );

  assert.deepEqual(validatePlans([first, second]), [
    'docs/exec-plans/completed/sample-task.md: task id "sample-task" is already used by docs/exec-plans/active/sample-task.md',
  ]);

  const badId = parsePlan(
    `${PLANS_DIRECTORY}/completed/Bad_Id.md`,
    "completed",
    `# Bad\n\n- Status: completed\n\n## Objective\nx\n\n## Verification\nx\n`,
  );

  assert.match(
    validatePlans([badId])[0] ?? "",
    /must be 3-80 kebab-case characters/,
  );
});

test("plans: at most one active plan", () => {
  const first = plan(activePlan());
  const second = parsePlan(
    `${PLANS_DIRECTORY}/active/other-task.md`,
    "active",
    activePlan({ "Task ID": "other-task" }),
  );

  const problems = validatePlans([first, second]);

  assert.deepEqual(
    problems.filter((problem) => problem.includes("active/")),
    ["docs/exec-plans/active/: 2 plans are active; at most 1 may be"],
  );
});

test("plans: active plans need every metadata key", () => {
  for (const key of ACTIVE_METADATA_KEYS) {
    const source = activePlan({ [key]: "-drop-" });
    const problems = validatePlans([plan(source)]);

    assert.ok(
      problems.some((problem) => problem.includes(`"- ${key}:"`)),
      `${key} must be required`,
    );
  }
});

test("plans: metadata values are checked", () => {
  const cases: readonly [Record<string, string>, RegExp][] = [
    [{ Risk: "critical" }, /must be low\|medium\|high/],
    [{ "Maximum risk": "tiny" }, /must be low\|medium\|high/],
    [
      { Risk: "high", "Maximum risk": "low" },
      /Risk "high" exceeds Maximum risk "low"/,
    ],
    [{ "Repair limit": "many" }, /must be a non-negative integer/],
    [{ "Task timeout": "30x" }, /must be Ns\|Nm\|Nh/],
    [{ "Task timeout": "25h" }, /exceeds the 24h ceiling/],
    [{ Authority: "verify" }, /Authority must include "edit"/],
    [{ Authority: "edit, verify, deploy" }, /unknown authority "deploy"/],
  ];

  for (const [overrides, pattern] of cases) {
    const problems = validatePlans([plan(activePlan(overrides))]);

    assert.ok(
      problems.some((problem) => pattern.test(problem)),
      `${JSON.stringify(overrides)} must be rejected`,
    );
  }
});

test("plans: required sections are enforced by folder", () => {
  const withoutVerification = parsePlan(
    `${PLANS_DIRECTORY}/completed/sample-task.md`,
    "completed",
    "# Done\n\n- Status: completed\n\n## Objective\nx\n",
  );

  assert.deepEqual(validatePlans([withoutVerification]), [
    'docs/exec-plans/completed/sample-task.md: missing required section "## Verification" (see docs/exec-plans/_template.md)',
  ]);

  for (const section of ACTIVE_REQUIRED_SECTIONS) {
    const stripped = plan(activePlan().replace(section, "## Notes"));

    assert.ok(
      validatePlans([stripped]).some((problem) =>
        problem.includes(`missing required section "${section}"`),
      ),
      `${section} must be required of active plans`,
    );
  }
});

test("plans: unchecked follow-ups are recorded debt, not unfinished work", () => {
  const debt = parsePlan(
    `${PLANS_DIRECTORY}/completed/sample-task.md`,
    "completed",
    `# Done

- Status: completed
- Owner: fikrilal

## Objective

x

## Verification

x

## Follow-Ups

- [ ] Credentialed deploy lane
- [ ] Re-pin the family snapshot
`,
  );

  assert.deepEqual(validatePlans([debt]), []);
});

test("plans: the shipped corpus validates and the template carries every key", () => {
  const plans = listPlans(ROOT);

  assert.ok(plans.length >= 40, "the corpus must be real");
  assert.deepEqual(validatePlans(plans), []);

  const template = readFileSync(
    join(ROOT, PLANS_DIRECTORY, PLAN_TEMPLATE_FILE),
    "utf8",
  );

  for (const key of ACTIVE_METADATA_KEYS) {
    assert.ok(
      template.includes(`- ${key}:`),
      `the template must carry "- ${key}:"`,
    );
  }
});
