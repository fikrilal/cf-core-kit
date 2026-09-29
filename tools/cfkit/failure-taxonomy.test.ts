import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UNKNOWN_STEP_DESCRIPTOR,
  failureDescriptor,
  knownStepIds,
} from "./failure-taxonomy.ts";

const CODE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

test("taxonomy: unknown steps escalate as unrepairable", () => {
  const descriptor = failureDescriptor("no.such.step");

  assert.deepEqual(descriptor, UNKNOWN_STEP_DESCRIPTOR);
  assert.equal(descriptor.repairable, false);
  assert.equal(descriptor.code, "harness.unknown-step");
});

test("taxonomy: every known step has a stable code and a real remediation", () => {
  const ids = knownStepIds();

  assert.ok(
    ids.length >= 16,
    `expected at least 16 step ids, got ${String(ids.length)}`,
  );
  assert.equal(new Set(ids).size, ids.length);

  for (const id of ids) {
    const descriptor = failureDescriptor(id);

    assert.match(descriptor.code, CODE_PATTERN, `${id} code`);
    assert.ok(
      descriptor.remediation.length >= 20,
      `${id} remediation is too short to be useful`,
    );
    assert.equal(typeof descriptor.repairable, "boolean");
  }
});

test("taxonomy: representative mappings", () => {
  assert.equal(failureDescriptor("format:check").code, "verify.format");
  assert.equal(failureDescriptor("runtime.smoke").code, "runtime.verification");
  assert.equal(failureDescriptor("scaffold.smoke").code, "verify.scaffold");
  assert.equal(failureDescriptor("harness:parity").code, "verify.parity");
});
