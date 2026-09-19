import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkBundleSize,
  checkCronCount,
  checkCryptoAllowlist,
  checkEnvConfinement,
  checkKvAccess,
  checkQueueBindingConfinement,
  checkQueueConfig,
  checkStorageSignerConfinement,
  DEAD_LETTER_QUEUE_PREFIX,
  JOB_QUEUE_PREFIX,
} from "./check.mjs";

const file = (path, content) => ({ path, content });

const queueBlock = (appEnv) => ({
  producers: [{ binding: "JOBS", queue: `${JOB_QUEUE_PREFIX}-${appEnv}` }],
  consumers: [
    {
      queue: `${JOB_QUEUE_PREFIX}-${appEnv}`,
      max_batch_size: 10,
      max_batch_timeout: 5,
      max_retries: 3,
      retry_delay: 30,
      dead_letter_queue: `${DEAD_LETTER_QUEUE_PREFIX}-${appEnv}`,
    },
    {
      queue: `${DEAD_LETTER_QUEUE_PREFIX}-${appEnv}`,
      max_batch_size: 10,
      max_batch_timeout: 5,
      max_retries: 3,
    },
  ],
});

const wrangler = (value) => JSON.stringify(value, null, 2);

const fullConfig = () => ({
  queues: queueBlock("dev"),
  env: {
    dev: { queues: queueBlock("dev") },
    staging: { queues: queueBlock("staging") },
    prod: { queues: queueBlock("prod") },
  },
});

test("crypto allowlist: node:crypto is rejected anywhere", () => {
  const violations = checkCryptoAllowlist([
    file("src/features/a.ts", 'import { randomBytes } from "node:crypto";'),
  ]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "crypto");
});

test("crypto allowlist: crypto.subtle is confined to the platform", () => {
  assert.equal(
    checkCryptoAllowlist([file("src/platform/a.ts", "crypto.subtle.digest;")])
      .length,
    0,
  );
  assert.equal(
    checkCryptoAllowlist([file("src/features/a.ts", "crypto.subtle.digest;")])
      .length,
    1,
  );
});

test("env confinement: context.env is allowed only in the platform and app.ts", () => {
  assert.equal(
    checkEnvConfinement([file("src/platform/config/a.ts", "context.env")])
      .length,
    0,
  );
  assert.equal(
    checkEnvConfinement([file("src/app.ts", "context.env")]).length,
    0,
  );
  assert.equal(
    checkEnvConfinement([file("src/features/a.ts", "context.env")]).length,
    1,
  );
});

test("kv access: any usage requires an allowlist entry", () => {
  assert.equal(
    checkKvAccess([file("src/platform/storage/a.ts", "context.env.KV")]).length,
    1,
  );
  assert.equal(
    checkKvAccess([file("src/platform/storage/a.ts", "context.env.KV")], {
      allowlist: ["src/platform/storage/a.ts"],
    }).length,
    0,
  );
});

test("cron count: parses jsonc and enforces the budget", () => {
  const ok = '{ "triggers": { "crons": ["0 * * * *"], } }';
  const tooMany = '{ "triggers": { "crons": ["0 * * * *", "30 * * * *"] } }';

  assert.equal(checkCronCount(ok).length, 0);
  assert.equal(checkCronCount(tooMany).length, 1);
  assert.equal(checkCronCount('{ "vars": {} }').length, 0);
  assert.equal(checkCronCount("not-json").length, 1);
});

test("bundle size: parses the dry-run output and enforces the budget", () => {
  const output = "Total Upload: 834.51 KiB / gzip: 136.44 KiB";

  assert.equal(checkBundleSize(output).sizeKib, 834.51);
  assert.equal(
    checkBundleSize(output, { budgetKib: 512 }).violations.length,
    1,
  );
  assert.equal(checkBundleSize("no size here").violations.length, 1);
});

test("cron count: environment scopes are enforced separately", () => {
  assert.equal(
    checkCronCount(
      wrangler({
        triggers: { crons: ["0 * * * *"] },
        env: {
          dev: { triggers: { crons: ["0 * * * *"] } },
          staging: { triggers: { crons: ["0 * * * *"] } },
        },
      }),
    ).length,
    0,
  );

  const violations = checkCronCount(
    wrangler({
      triggers: { crons: ["0 * * * *"] },
      env: { staging: { triggers: { crons: ["0 * * * *", "30 * * * *"] } } },
    }),
  );

  assert.equal(violations.length, 1);
  assert.ok(violations[0].detail.startsWith("env.staging:"));
});

test("queue config: well-formed scopes pass and are pinned to the naming helpers", () => {
  assert.equal(
    checkQueueConfig(
      wrangler({
        queues: queueBlock("dev"),
        env: {
          dev: { queues: queueBlock("dev") },
          staging: { queues: queueBlock("staging") },
          prod: { queues: queueBlock("prod") },
        },
      }),
    ).length,
    0,
  );

  const source = readFileSync(
    join(import.meta.dirname, "../../src/platform/queue/names.ts"),
    "utf8",
  );
  assert.match(
    source,
    new RegExp(`JOB_QUEUE_PREFIX = "${JOB_QUEUE_PREFIX}"`),
    "the check prefix must match the platform helper",
  );
  assert.match(
    source,
    new RegExp(`DEAD_LETTER_QUEUE_PREFIX = "${DEAD_LETTER_QUEUE_PREFIX}"`),
    "the check prefix must match the platform helper",
  );
});

test("queue config: wrong names, missing DLQ, and extra consumers fail", () => {
  const wrongName = fullConfig();
  wrongName.env.dev.queues.producers[0].queue = `${JOB_QUEUE_PREFIX}-staging`;
  assert.ok(
    checkQueueConfig(wrangler(wrongName)).some((violation) =>
      violation.detail.includes("producer binding"),
    ),
  );

  const noDlq = fullConfig();
  delete noDlq.env.dev.queues.consumers[0].dead_letter_queue;
  assert.ok(
    checkQueueConfig(wrangler(noDlq)).some((violation) =>
      violation.detail.includes("dead_letter_queue"),
    ),
  );

  const extra = fullConfig();
  extra.env.dev.queues.consumers.push({
    queue: "another-queue",
    max_batch_size: 10,
    max_batch_timeout: 5,
    max_retries: 3,
    dead_letter_queue: `${DEAD_LETTER_QUEUE_PREFIX}-dev`,
  });
  assert.ok(
    checkQueueConfig(wrangler(extra)).some((violation) =>
      violation.detail.includes("consumers configured"),
    ),
  );
});

test("queue config: a scope that omits its queues block is flagged", () => {
  const violations = checkQueueConfig(wrangler({ queues: queueBlock("dev") }));

  for (const scope of ["env.dev", "env.staging", "env.prod"]) {
    assert.ok(
      violations.some((violation) =>
        violation.detail.startsWith(`${scope}: missing queues block`),
      ),
      `expected ${scope} to be flagged`,
    );
  }
});

test("queue config: retry, batch-size, and timeout bounds are enforced", () => {
  const overRetries = fullConfig();
  overRetries.env.dev.queues.consumers[0].max_retries = 6;
  assert.ok(
    checkQueueConfig(wrangler(overRetries)).some((violation) =>
      violation.detail.includes("max_retries"),
    ),
  );

  const overBatch = fullConfig();
  overBatch.env.dev.queues.consumers[0].max_batch_size = 11;
  assert.ok(
    checkQueueConfig(wrangler(overBatch)).some((violation) =>
      violation.detail.includes("max_batch_size"),
    ),
  );

  const overTimeout = fullConfig();
  overTimeout.env.dev.queues.consumers[0].max_batch_timeout = 11;
  assert.ok(
    checkQueueConfig(wrangler(overTimeout)).some((violation) =>
      violation.detail.includes("max_batch_timeout"),
    ),
  );
});

test("queue binding: env.JOBS is confined to the platform and composition roots", () => {
  assert.equal(
    checkQueueBindingConfinement([file("src/platform/queue/p.ts", "env.JOBS;")])
      .length,
    0,
  );
  assert.equal(
    checkQueueBindingConfinement([file("src/worker.ts", "env.JOBS;")]).length,
    0,
  );

  const violations = checkQueueBindingConfinement([
    file("src/features/auth/a.ts", "await env.JOBS.send({});"),
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "queue");
});

test("storage signer: aws4fetch is confined to the platform module", () => {
  assert.equal(
    checkStorageSignerConfinement([
      file(
        "src/platform/storage/presign.ts",
        'import { AwsClient } from "aws4fetch";',
      ),
    ]).length,
    0,
  );

  const violations = checkStorageSignerConfinement([
    file("src/features/a.ts", 'import { AwsClient } from "aws4fetch";'),
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "storage");
});
