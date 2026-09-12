import assert from "node:assert/strict";
import { test } from "node:test";

import { generateSigningKeySet, renderDevVars } from "./generate-keys.mjs";

test("generate-keys: produces a usable Ed25519 private JWK", async () => {
  const keySet = generateSigningKeySet();

  assert.equal(keySet.kty, "OKP");
  assert.equal(keySet.crv, "Ed25519");
  assert.equal(typeof keySet.kid, "string");
  assert.ok(keySet.kid.length > 0);
  assert.equal(typeof keySet.d, "string");
  assert.equal(typeof keySet.x, "string");

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    keySet,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: keySet.x },
    { name: "Ed25519" },
    true,
    ["verify"],
  );
  const data = new TextEncoder().encode("ping");
  const signature = await crypto.subtle.sign("Ed25519", privateKey, data);

  assert.equal(
    await crypto.subtle.verify("Ed25519", publicKey, signature, data),
    true,
  );
});

test("generate-keys: renders .dev.vars values that round-trip", () => {
  const keySet = generateSigningKeySet();
  const { json, base64 } = renderDevVars(keySet);

  assert.equal(Buffer.from(base64, "base64").toString("utf8"), json);

  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].kid, keySet.kid);
});
