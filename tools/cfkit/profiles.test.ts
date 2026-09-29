import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UNKNOWN_STEP_DESCRIPTOR,
  failureDescriptor,
} from "./failure-taxonomy.ts";
import {
  expandProfile,
  resolveProfile,
  VERIFY_PROFILES,
  type VerifyProfileName,
} from "./profiles.ts";

const NAMES: readonly VerifyProfileName[] = [
  "fast",
  "full",
  "runtime",
  "smoke",
  "ci",
];

test("profiles: every registry entry is well formed", () => {
  for (const [key, profile] of Object.entries(VERIFY_PROFILES)) {
    assert.equal(profile.name, key);

    for (const composed of profile.composes) {
      assert.ok(
        composed in VERIFY_PROFILES,
        `${key} composes unknown ${composed}`,
      );
    }

    if (profile.composes.length > 0) {
      assert.equal(
        profile.steps.length,
        0,
        `${key} mixes steps and composition; aliases must not copy step lists`,
      );
    }
  }

  assert.equal(resolveProfile("fast")?.name, "fast");
  assert.equal(resolveProfile("nope"), undefined);
});

test("profiles: ci expands to full + runtime + smoke in order", () => {
  const ci = expandProfile("ci").map((step) => step.id);
  const expected = [
    ...expandProfile("full"),
    ...expandProfile("runtime"),
    ...expandProfile("smoke"),
  ].map((step) => step.id);

  assert.deepEqual(ci, expected);
});

test("profiles: no profile repeats a step id", () => {
  for (const name of NAMES) {
    const ids = expandProfile(name).map((step) => step.id);

    assert.equal(new Set(ids).size, ids.length, `${name} repeats a step id`);
  }
});

test("profiles: every step id has a registered failure taxonomy entry", () => {
  for (const name of NAMES) {
    for (const step of expandProfile(name)) {
      const descriptor = failureDescriptor(step.id);

      assert.notEqual(
        descriptor.code,
        UNKNOWN_STEP_DESCRIPTOR.code,
        `${step.id} has no taxonomy entry`,
      );
      assert.equal(
        descriptor.repairable,
        true,
        `${step.id} should be repairable`,
      );
    }
  }
});
