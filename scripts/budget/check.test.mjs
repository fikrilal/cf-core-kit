import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkBundleSize,
  checkCronCount,
  checkCryptoAllowlist,
  checkEnvConfinement,
  checkKvAccess,
} from "./check.mjs";

const file = (path, content) => ({ path, content });

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
