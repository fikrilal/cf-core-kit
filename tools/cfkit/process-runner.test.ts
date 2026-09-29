import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_CAPTURE_BYTES,
  runProcess,
  TIMEOUT_EXIT_CODE,
} from "./process-runner.ts";

test("process-runner: captures streams and the exit code", async () => {
  const capture = await runProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3);",
    ],
    passthrough: false,
  });

  assert.equal(capture.exitCode, 3);
  assert.equal(capture.timedOut, false);
  assert.equal(capture.signal, null);
  assert.ok(capture.stdout.includes("out"));
  assert.ok(capture.stderr.includes("err"));
  assert.equal(capture.stdoutTruncated, false);
  assert.equal(capture.stderrTruncated, false);
  assert.ok(capture.durationMs >= 0);
});

test("process-runner: tail-truncates beyond the capture cap", async () => {
  const capture = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('A'.repeat(4000) + 'TAIL');"],
    passthrough: false,
    maxCaptureBytes: 1000,
  });

  assert.equal(capture.stdoutTruncated, true);
  assert.equal(capture.stdout.length, 1000);
  assert.ok(capture.stdout.endsWith("TAIL"), "the tail must be kept");
});

test("process-runner: kills the child and reports timeouts", async () => {
  const capture = await runProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => undefined, 5000);"],
    passthrough: false,
    timeoutMs: 200,
  });

  assert.equal(capture.timedOut, true);
  assert.equal(capture.exitCode, TIMEOUT_EXIT_CODE);
});

test("process-runner: ships a 64 KiB default capture cap", () => {
  assert.equal(DEFAULT_CAPTURE_BYTES, 64 * 1024);
});
