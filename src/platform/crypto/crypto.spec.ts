import { describe, expect, it } from "vitest";

import { createRsaTestKey } from "../../../test/auth-fixtures";
import {
  exportPublicJwk,
  importEd25519PrivateKey,
  importEd25519PublicKey,
  importRsaPublicKey,
  randomBase64Url,
  sha256Base64Url,
  signEd25519,
  verifyEd25519,
  verifyRs256,
} from "./crypto";

const DATA = new TextEncoder().encode("payload");

describe("hashing and randomness", () => {
  it("hashes to base64url with a known vector", async () => {
    await expect(sha256Base64Url("")).resolves.toBe(
      "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
    );
  });

  it("generates url-safe random tokens", () => {
    const first = randomBase64Url(32);
    const second = randomBase64Url(32);

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("ed25519", () => {
  it("round-trips sign and verify", async () => {
    const generated = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"],
    );
    if (!("privateKey" in generated)) throw new Error("expected a key pair");

    const privateJwk = await crypto.subtle.exportKey(
      "jwk",
      generated.privateKey,
    );
    if (!("kty" in privateJwk)) throw new Error("expected a JWK");

    const exported = await exportPublicJwk(generated.publicKey);
    const x = exported.x;
    if (x === undefined) throw new Error("missing public key material");

    const privateKey = await importEd25519PrivateKey(privateJwk);
    const publicKey = await importEd25519PublicKey({
      kty: "OKP",
      crv: "Ed25519",
      x,
    });

    const signature = await signEd25519(privateKey, DATA);

    await expect(verifyEd25519(publicKey, DATA, signature)).resolves.toBe(true);
    await expect(
      verifyEd25519(publicKey, new TextEncoder().encode("tampered"), signature),
    ).resolves.toBe(false);
  });

  it("exports public JWKs without private material", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    if (!("publicKey" in pair)) throw new Error("expected a key pair");

    const jwk = await exportPublicJwk(pair.publicKey);

    expect(jwk.kty).toBe("OKP");
    expect(jwk.d).toBeUndefined();
  });
});

describe("rs256 verification", () => {
  it("verifies signatures from the matching private key only", async () => {
    const key = await createRsaTestKey();
    const publicKey = await importRsaPublicKey(key.publicJwk);
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        key.privateKey,
        DATA,
      ),
    );

    await expect(verifyRs256(publicKey, DATA, signature)).resolves.toBe(true);
    await expect(
      verifyRs256(publicKey, new TextEncoder().encode("tampered"), signature),
    ).resolves.toBe(false);
  });
});
