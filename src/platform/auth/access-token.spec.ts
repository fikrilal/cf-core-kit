import { describe, expect, it } from "vitest";

import { TEST_SIGNING_KEYS_JSON } from "../../../test/auth-fixtures";
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
