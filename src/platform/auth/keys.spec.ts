import { describe, expect, it } from "vitest";

import {
  TEST_SIGNING_KID,
  TEST_SIGNING_KEYS_JSON,
} from "../../../test/auth-fixtures";
import { encodeBase64Url } from "../../shared/base64url";
import { buildKeyRing, getKeyRing } from "./keys";

function config(json: string | undefined, base64?: string) {
  return {
    authSigningKeysJson: json,
    authSigningKeysJsonBase64: base64 ?? undefined,
  };
}

function singleJwkJson(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(TEST_SIGNING_KEYS_JSON);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("unexpected fixture shape");
  }

  const item: unknown = parsed[0];
  if (typeof item !== "object" || item === null) {
    throw new Error("unexpected fixture item");
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    result[key] = value;
  }

  return result;
}

function withoutPrivateMaterial(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === "d") continue;
    result[key] = value;
  }

  return result;
}

describe("buildKeyRing", () => {
  it("builds a signer and public keys from the array form", async () => {
    const ring = await buildKeyRing(config(TEST_SIGNING_KEYS_JSON));

    expect(ring.signer?.kid).toBe(TEST_SIGNING_KID);
    expect(ring.signer?.alg).toBe("EdDSA");
    expect(ring.publicKeys).toHaveLength(1);
    expect(ring.publicKeys[0]?.jwk.kid).toBe(TEST_SIGNING_KID);
    expect(ring.publicKeys[0]?.jwk.use).toBe("sig");
    expect(ring.publicKeys[0]?.jwk.alg).toBe("EdDSA");
    expect(ring.publicKeys[0]?.jwk.d).toBeUndefined();
  });

  it("accepts the { keys } object form and the base64 form", async () => {
    const json = JSON.stringify({ keys: [singleJwkJson()] });

    await expect(buildKeyRing(config(json))).resolves.toBeDefined();
    await expect(
      buildKeyRing(config(undefined, encodeBase64Url(json))),
    ).resolves.toBeDefined();
  });

  it("rejects configurations without usable keys", async () => {
    await expect(buildKeyRing(config("[]"))).rejects.toThrow(/usable keys/);
    await expect(buildKeyRing(config(undefined))).rejects.toThrow(
      /not configured/,
    );
    await expect(buildKeyRing(config("not json"))).rejects.toThrow(
      /valid JSON/,
    );
  });

  it("publishes public-only keys but requires a private signer", async () => {
    const publicOnly = JSON.stringify([
      { ...withoutPrivateMaterial(singleJwkJson()), kid: "public-only" },
    ]);

    await expect(buildKeyRing(config(publicOnly))).rejects.toThrow(
      /private Ed25519 signing key/,
    );
  });

  it("skips items without a kid", async () => {
    const noKid = singleJwkJson();
    delete noKid.kid;

    await expect(buildKeyRing(config(JSON.stringify([noKid])))).rejects.toThrow(
      /usable keys/,
    );
  });

  it("memoizes key rings per configuration", () => {
    const first = getKeyRing(config(TEST_SIGNING_KEYS_JSON));
    const second = getKeyRing(config(TEST_SIGNING_KEYS_JSON));

    expect(first).toBe(second);
  });
});
