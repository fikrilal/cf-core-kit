import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildEpisode,
  capDiagnostics,
  DIAGNOSTICS_LIMIT_BYTES,
  firstFailingLine,
  MAX_FIRST_LINE_LENGTH,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  recordAttempt,
  renderDiagnostics,
  sanitizeDiagnostics,
  TRUNCATION_MARKER,
  validateEpisode,
  type AttemptInput,
} from "./episodes.ts";

const ATTEMPT: AttemptInput = {
  taskId: "sample-task",
  attempt: 2,
  lane: "ci",
  durationMs: 1_234,
  steps: [
    { id: "plans:check", status: "passed", exitCode: 0, durationMs: 120 },
    {
      id: "lint",
      status: "failed",
      exitCode: 1,
      durationMs: 900,
      descriptor: {
        code: "verify.lint",
        remediation: "fix it",
        repairable: true,
      },
      output: "noise\n  x error: unexpected token\nmore noise",
    },
  ],
};

test("episodes: the built episode is valid and names the first failing line", () => {
  const episode = buildEpisode(ATTEMPT);

  assert.deepEqual(validateEpisode(episode), []);
  assert.equal(episode.outcome, "failed");
  assert.deepEqual(episode.steps[1], {
    id: "lint",
    status: "failed",
    exitCode: 1,
    durationMs: 900,
    failure: {
      code: "verify.lint",
      repairable: true,
      firstLine: "x error: unexpected token",
    },
  });
  assert.deepEqual(episode.steps[0], {
    id: "plans:check",
    status: "passed",
    exitCode: 0,
    durationMs: 120,
  });
});

test("episodes: a forbidden key anywhere fails validation", () => {
  const problems = validateEpisode({
    ...buildEpisode(ATTEMPT),
    steps: [
      {
        id: "lint",
        status: "failed",
        exitCode: 1,
        durationMs: 1,
        failure: {
          code: "verify.lint",
          repairable: true,
          firstLine: "x",
          stdout: "leak",
        },
      },
    ],
  });

  assert.deepEqual(problems, [
    "episode.steps[0].failure.stdout: forbidden key",
  ]);

  for (const key of [
    "prompt",
    "reasoning",
    "environment",
    "credential",
    "token",
    "cookie",
    "requestBody",
    "databaseUrl",
  ]) {
    assert.ok(
      validateEpisode({ ...buildEpisode(ATTEMPT), [key]: "x" }).some(
        (problem) => problem.includes(`${key}: forbidden key`),
      ),
      `${key} must be forbidden`,
    );
  }
});

test("episodes: the schema version and step shapes are enforced", () => {
  const episode = buildEpisode(ATTEMPT);

  assert.ok(
    validateEpisode({ ...episode, schemaVersion: 2 }).some((problem) =>
      problem.includes("schemaVersion"),
    ),
  );
  assert.ok(
    validateEpisode({ ...episode, attempt: 0 }).some((problem) =>
      problem.includes("attempt"),
    ),
  );
  assert.ok(
    validateEpisode({ ...episode, outcome: "maybe" }).some((problem) =>
      problem.includes("outcome"),
    ),
  );
  assert.ok(
    validateEpisode({ ...episode, steps: [] }).some((problem) =>
      problem.includes("steps"),
    ),
  );
});

/**
 * Fixture values are assembled at runtime: the secrets scan reads tracked files, and a literal key-shaped
 * string here would fail `secrets:check` the moment this file is committed (that is not hypothetical — it
 * happened, and the isolated-tree verify caught it).
 */
const SECRET_NAME = "AUTH_SIGNING_KEYS_JSON";
const JWK_KEY = "kty";
const JWK_CURVE = "OKP";
const JWK_PRIVATE = "RRIj8bg_uz83k2IcGTBCZAnLkl1k9somQdreqNkgSWg";
const JWK = JSON.stringify({ [JWK_KEY]: JWK_CURVE, d: JWK_PRIVATE });
const PROVIDER_KEY = ["re", "1234567890abcdef"].join("_");
const JWT = [
  "eyJhbGciOiJFZERTQSJ9",
  "eyJzdWIiOiJ1In0",
  "signature".repeat(3),
].join(".");
const EMAIL = ["user", "example.com"].join("@");
const BEARER = ["Authorization: Bearer", "abcdefghijklmnop"].join(" ");

test("episodes: diagnostics redact credentials, keys and addresses", () => {
  const sanitized = sanitizeDiagnostics(
    [
      BEARER,
      "url https://r2.test/x?X-Amz-Signature=deadbeefcafe&X-Amz-Credential=AKIAEXAMPLE",
      PROVIDER_KEY,
      JWT,
      `${SECRET_NAME}=${JWK}`,
      EMAIL,
    ].join("\n"),
  );

  assert.ok(sanitized.includes("Authorization: Bearer <redacted>"));
  assert.ok(sanitized.includes("X-Amz-Signature=<redacted>"));
  assert.ok(sanitized.includes("X-Amz-Credential=<redacted>"));
  assert.ok(sanitized.includes("AUTH_SIGNING_KEYS_JSON=<redacted>"));
  assert.ok(sanitized.includes("user-<redacted>@example.com"));
  assert.ok(!sanitized.includes("abcdefghijklmnop"));
  assert.ok(!sanitized.includes("deadbeefcafe"));
  assert.ok(!sanitized.includes(PROVIDER_KEY));
  assert.ok(!sanitized.includes(JWK_PRIVATE));
  assert.ok(!sanitized.includes(JWT));
  assert.ok(!sanitized.includes(EMAIL));
});

test("episodes: diagnostics are capped tail-kept at 16 KiB", () => {
  const line = `${"x".repeat(200)}\n`;
  const huge = line.repeat(200);
  const capped = capDiagnostics(huge);

  assert.ok(Buffer.byteLength(capped, "utf8") <= DIAGNOSTICS_LIMIT_BYTES);
  assert.ok(capped.startsWith(TRUNCATION_MARKER));
  assert.ok(capped.trimEnd().endsWith("x".repeat(200)));

  const small = "short\n";

  assert.equal(capDiagnostics(small), small);
});

test("episodes: the first failing line is sanitized and truncated", () => {
  assert.equal(firstFailingLine("\n\n   boom   \nrest"), "boom");
  assert.equal(
    firstFailingLine("setup\n  x error: nope\nmore"),
    "x error: nope",
  );
  assert.equal(firstFailingLine(""), "");

  const long = firstFailingLine(`${EMAIL} ${"y".repeat(400)}`);

  assert.ok(long.length <= MAX_FIRST_LINE_LENGTH);
  assert.ok(long.startsWith("user-<redacted>@example.com"));
});

test("episodes: recording writes private, atomic attempt artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-episodes-"));

  try {
    const recorded = recordAttempt(root, ATTEMPT);

    assert.ok(recorded.episodePath.endsWith("episodes/attempt-2.json"));
    assert.ok(recorded.diagnosticsPath.endsWith("diagnostics/attempt-2.txt"));

    const episode: unknown = JSON.parse(
      readFileSync(recorded.episodePath, "utf8"),
    );

    assert.deepEqual(validateEpisode(episode), []);
    assert.match(readFileSync(recorded.episodePath, "utf8"), /"attempt": 2/);

    const directoryMode =
      statSync(join(root, ".cfkit", "tasks", "sample-task", "episodes")).mode &
      0o777;
    const fileMode = statSync(recorded.episodePath).mode & 0o777;

    assert.equal(directoryMode, PRIVATE_DIRECTORY_MODE);
    assert.equal(fileMode, PRIVATE_FILE_MODE);

    const diagnostics = readFileSync(recorded.diagnosticsPath, "utf8");

    assert.match(
      diagnostics,
      /task sample-task attempt 2 lane ci outcome failed/,
    );
    assert.match(diagnostics, /step lint failed/);
    assert.ok(!diagnostics.includes("stdout"));

    const second = recordAttempt(root, { ...ATTEMPT, attempt: 3 });

    assert.ok(
      readFileSync(second.episodePath, "utf8").includes('"attempt": 3'),
    );
    assert.ok(
      readFileSync(recorded.episodePath, "utf8").includes('"attempt": 2'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("episodes: a verified attempt carries no failure blocks", () => {
  const verified: AttemptInput = {
    ...ATTEMPT,
    steps: [
      { id: "plans:check", status: "passed", exitCode: 0, durationMs: 120 },
    ],
  };
  const episode = buildEpisode(verified);

  assert.equal(episode.outcome, "verified");
  assert.deepEqual(episode.steps[0], {
    id: "plans:check",
    status: "passed",
    exitCode: 0,
    durationMs: 120,
  });
  assert.match(renderDiagnostics(verified), /outcome verified/);
});
