import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALLOWLIST,
  ALLOWLIST_PATHS,
  scanRepository,
  scanText,
} from "./secrets-scan.mjs";

// fixtures are built at runtime so this file itself never carries a literal secret
const FAKE_AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
const FAKE_JWK = `{"kty":"OKP","crv":"Ed25519","x":"public","d":"${"c2VjcmV0".repeat(4)}","kid":"k1"}`;
const FAKE_ASSIGNMENT = `R2_SECRET_ACCESS_KEY=${"aB3xY9".repeat(4)}`;
const FAKE_PRIVATE_KEY = "-----BEGIN " + "PRIVATE KEY-----";

test("each rule fires on a realistic fixture", () => {
  assert.deepEqual(scanText("a.ts", FAKE_PRIVATE_KEY), [
    { path: "a.ts", rule: "private-key" },
  ]);
  assert.deepEqual(scanText("b.ts", `const key = "${FAKE_AWS_KEY}";`), [
    { path: "b.ts", rule: "aws-access-key" },
  ]);
  assert.deepEqual(scanText("c.json", FAKE_JWK), [
    { path: "c.json", rule: "jwk-private" },
  ]);
  assert.deepEqual(scanText(".env.example", FAKE_ASSIGNMENT), [
    { path: ".env.example", rule: "secret-assignment" },
  ]);
});

test("a pretty-printed private JWK is caught across lines", () => {
  const prettyJwk = [
    "{",
    '  "kty": "OKP",',
    '  "crv": "Ed25519",',
    `  "d": "${"c2VjcmV0".repeat(5)}",`,
    '  "kid": "k1"',
    "}",
  ].join("\n");

  assert.deepEqual(scanText("keys.json", prettyJwk), [
    { path: "keys.json", rule: "jwk-private" },
  ]);
});

test("secret assignments from constants are not findings", () => {
  assert.deepEqual(
    scanText("fixtures.ts", "AUTH_SIGNING_KEYS_JSON: TEST_SIGNING_KEYS_JSON,"),
    [],
  );
});

test("clean content and the generator template pass", () => {
  assert.deepEqual(scanText("clean.ts", "export const value = 42;"), []);
  assert.deepEqual(
    scanText("keys.mjs", "console.log(`AUTH_SIGNING_KEYS_JSON=${JSON}`);"),
    [],
  );
  assert.deepEqual(
    scanText("readme.md", "wrangler secret put R2_SECRET_ACCESS_KEY"),
    [],
  );
});

test("allowlisted public examples are skipped with their line", () => {
  const example = ALLOWLIST[0];

  assert.ok(example !== undefined);
  assert.deepEqual(
    scanText("presign.spec.ts", `const secret = "${example}";`),
    [],
  );
});

test("every path allowlist entry carries a reason", () => {
  assert.ok(ALLOWLIST_PATHS.length > 0);

  for (const entry of ALLOWLIST_PATHS) {
    assert.ok(entry.reason.length > 0, entry.path);
  }
});

test("the repository itself scans clean", () => {
  assert.deepEqual(scanRepository(process.cwd()), []);
});
