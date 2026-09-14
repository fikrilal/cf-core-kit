import { describe, expect, it } from "vitest";

import {
  createRsaTestKey,
  generateEd25519Key,
  TEST_SIGNING_KEYS_JSON,
} from "../../../test/auth-fixtures";
import { encodeBase64Url, encodeBytesBase64Url } from "../../shared/base64url";
import { signEd25519 } from "../crypto/crypto";
import { issueAccessToken, verifyAccessToken } from "./access-token";
import { buildKeyRing, type KeyRing } from "./keys";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const BASE_INPUT = {
  now: NOW,
  ttlSeconds: 900,
  userId: "user-1",
  sessionId: "session-1",
  emailVerified: true,
  roles: ["USER"],
} as const;

let ringPromise: Promise<KeyRing> | undefined;

function keyRing(): Promise<KeyRing> {
  ringPromise ??= buildKeyRing({
    authSigningKeysJson: TEST_SIGNING_KEYS_JSON,
    authSigningKeysJsonBase64: undefined,
  });

  return ringPromise;
}

async function signToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const ring = await keyRing();
  const signer = ring.signer;
  if (signer === undefined) throw new Error("missing signer");

  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}`;
  const signature = await signEd25519(
    signer.key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${encodeBytesBase64Url(signature)}`;
}

function baseHeader(): Record<string, unknown> {
  return { alg: "EdDSA", kid: "test-key-1", typ: "JWT" };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  const iat = Math.floor(NOW.getTime() / 1000);

  return {
    sub: "user-1",
    sid: "session-1",
    email_verified: true,
    roles: ["USER"],
    typ: "access",
    iat,
    exp: iat + 900,
    jti: "jti-1",
    ...overrides,
  };
}

describe("access token round trip", () => {
  it("issues and verifies a token with the expected claims", async () => {
    const ring = await keyRing();
    const token = await issueAccessToken({
      keyRing: ring,
      ...BASE_INPUT,
      issuer: "cf-core-kit",
      audience: "cf-clients",
    });

    const principal = await verifyAccessToken({
      token,
      keyRing: ring,
      now: new Date(NOW.getTime() + 100_000),
      issuer: "cf-core-kit",
      audience: "cf-clients",
    });

    expect(principal).toEqual({
      userId: "user-1",
      sessionId: "session-1",
      emailVerified: true,
      roles: ["USER"],
    });
  });

  it("writes PII-free claims and dedupes roles on verification", async () => {
    const ring = await keyRing();
    const token = await issueAccessToken({
      keyRing: ring,
      ...BASE_INPUT,
      roles: ["USER", "USER"],
    });
    const payloadSegment = token.split(".")[1] ?? "";
    const decoded: unknown = JSON.parse(
      atob(payloadSegment.replaceAll("-", "+").replaceAll("_", "/")),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      throw new Error("expected a payload object");
    }

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(decoded)) {
      payload[key] = value;
    }

    expect(payload.sub).toBe("user-1");
    expect(payload.typ).toBe("access");
    expect(payload.roles).toEqual(["USER", "USER"]);
    expect("email" in payload).toBe(false);
    expect(typeof payload.jti).toBe("string");

    const principal = await verifyAccessToken({
      token,
      keyRing: ring,
      now: NOW,
    });

    expect(principal?.roles).toEqual(["USER"]);
  });
});

describe("access token rejection matrix", () => {
  it("rejects expired and skewed time claims", async () => {
    const ring = await keyRing();
    const token = await signToken(baseHeader(), basePayload());

    await expect(
      verifyAccessToken({ token, keyRing: ring, now: NOW }),
    ).resolves.toBeDefined();
    await expect(
      verifyAccessToken({
        token,
        keyRing: ring,
        now: new Date(NOW.getTime() + 961_000),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a future iat beyond the skew", async () => {
    const ring = await keyRing();
    const iat = Math.floor(NOW.getTime() / 1000) + 120;
    const token = await signToken(
      baseHeader(),
      basePayload({ iat, exp: iat + 900 }),
    );

    await expect(
      verifyAccessToken({ token, keyRing: ring, now: NOW }),
    ).resolves.toBeUndefined();
  });

  it("rejects wrong typ, unknown kid, and alg mismatch", async () => {
    const ring = await keyRing();

    const wrongTyp = await signToken(
      baseHeader(),
      basePayload({ typ: "refresh" }),
    );
    const unknownKid = await signToken(
      { ...baseHeader(), kid: "other-key" },
      basePayload(),
    );
    const wrongAlg = await signToken(
      { ...baseHeader(), alg: "RS256" },
      basePayload(),
    );

    for (const token of [wrongTyp, unknownKid, wrongAlg]) {
      await expect(
        verifyAccessToken({ token, keyRing: ring, now: NOW }),
      ).resolves.toBeUndefined();
    }
  });
});

describe("access token structural rules", () => {
  it("rejects missing claims, oversized tokens, and tampering", async () => {
    const ring = await keyRing();

    const noJti = await signToken(
      baseHeader(),
      basePayload({ jti: undefined }),
    );
    const emptySub = await signToken(baseHeader(), basePayload({ sub: "" }));
    const oversized = "a".repeat(16_500);

    const valid = await signToken(baseHeader(), basePayload());
    const tampered = `${valid.slice(0, -2)}xx`;

    for (const token of [noJti, emptySub, oversized, tampered, "not-a-jwt"]) {
      await expect(
        verifyAccessToken({ token, keyRing: ring, now: NOW }),
      ).resolves.toBeUndefined();
    }
  });

  it("enforces issuer and audience only when configured", async () => {
    const ring = await keyRing();
    const token = await signToken(
      baseHeader(),
      basePayload({ iss: "issuer-a", aud: ["audience-a", "audience-b"] }),
    );

    await expect(
      verifyAccessToken({ token, keyRing: ring, now: NOW }),
    ).resolves.toBeDefined();
    await expect(
      verifyAccessToken({
        token,
        keyRing: ring,
        now: NOW,
        issuer: "issuer-b",
        audience: "audience-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyAccessToken({
        token,
        keyRing: ring,
        now: NOW,
        issuer: "issuer-a",
        audience: "audience-b",
      }),
    ).resolves.toBeDefined();
  });
});

describe("access token key rotation", () => {
  it("verifies pre-rotation tokens and signs with the current key", async () => {
    const previous = await generateEd25519Key("previous-key");
    const current = await generateEd25519Key("current-key");

    const previousRing = await buildKeyRing({
      authSigningKeysJson: JSON.stringify([previous.privateJwk]),
      authSigningKeysJsonBase64: undefined,
    });
    const currentOnlyRing = await buildKeyRing({
      authSigningKeysJson: JSON.stringify([current.privateJwk]),
      authSigningKeysJsonBase64: undefined,
    });
    const rotatedRing = await buildKeyRing({
      authSigningKeysJson: JSON.stringify([
        current.privateJwk,
        previous.publicJwk,
      ]),
      authSigningKeysJsonBase64: undefined,
    });

    const oldToken = await issueAccessToken({
      keyRing: previousRing,
      ...BASE_INPUT,
    });
    const newToken = await issueAccessToken({
      keyRing: rotatedRing,
      ...BASE_INPUT,
    });

    await expect(
      verifyAccessToken({ token: oldToken, keyRing: rotatedRing, now: NOW }),
    ).resolves.toBeDefined();
    await expect(
      verifyAccessToken({
        token: oldToken,
        keyRing: currentOnlyRing,
        now: NOW,
      }),
    ).resolves.toBeUndefined();

    await expect(
      verifyAccessToken({ token: newToken, keyRing: rotatedRing, now: NOW }),
    ).resolves.toBeDefined();
    await expect(
      verifyAccessToken({
        token: newToken,
        keyRing: previousRing,
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("access token hardening", () => {
  it("rejects RSA-alg tokens on a mixed ring without throwing", async () => {
    const ed25519 = await generateEd25519Key("ed-key");
    const rsa = await createRsaTestKey("rsa-key");

    const mixedRing = await buildKeyRing({
      authSigningKeysJson: JSON.stringify([
        ed25519.privateJwk,
        { ...rsa.publicJwk, kid: rsa.kid },
      ]),
      authSigningKeysJsonBase64: undefined,
    });

    const rsaAlgToken = await signToken(
      { alg: "RS256", kid: "rsa-key", typ: "JWT" },
      basePayload(),
    );

    await expect(
      verifyAccessToken({ token: rsaAlgToken, keyRing: mixedRing, now: NOW }),
    ).resolves.toBeUndefined();
  });

  it("rejects future nbf, oversized jti, and empty sid", async () => {
    const ring = await keyRing();
    const notBefore = await signToken(
      baseHeader(),
      basePayload({ nbf: Math.floor(NOW.getTime() / 1000) + 3_600 }),
    );
    const longJti = await signToken(
      baseHeader(),
      basePayload({ jti: "j".repeat(129) }),
    );
    const emptySid = await signToken(baseHeader(), basePayload({ sid: "" }));

    for (const token of [notBefore, longJti, emptySid]) {
      await expect(
        verifyAccessToken({ token, keyRing: ring, now: NOW }),
      ).resolves.toBeUndefined();
    }
  });

  it("treats a missing roles claim as an empty role set", async () => {
    const ring = await keyRing();
    const token = await signToken(
      baseHeader(),
      basePayload({ roles: undefined }),
    );

    const principal = await verifyAccessToken({
      token,
      keyRing: ring,
      now: NOW,
    });

    expect(principal?.roles).toEqual([]);
  });
});
