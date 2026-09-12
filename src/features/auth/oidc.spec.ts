import { describe, expect, it } from "vitest";

import {
  createRsaTestKey,
  googleClaims,
  jwksFor,
  signIdToken,
  TEST_GOOGLE_CLIENT_ID,
  TEST_TOKEN_INSTANT,
  tokenInstantSeconds,
  type RsaTestKey,
} from "../../../test/auth-fixtures";
import { fixedClock } from "../../platform/clock/clock";
import {
  createGoogleIdTokenVerifier,
  createJwksCache,
  type GoogleClaims,
  type IdTokenVerifier,
  type JwksCache,
} from "./oidc";

let keyPromise: Promise<RsaTestKey> | undefined;

function testKey(): Promise<RsaTestKey> {
  keyPromise ??= createRsaTestKey();

  return keyPromise;
}

function staticJwks(key: RsaTestKey): JwksCache {
  return createJwksCache({ fetchKeys: () => Promise.resolve(jwksFor(key)) });
}

function verifierFor(jwks: JwksCache): IdTokenVerifier {
  return createGoogleIdTokenVerifier({
    jwks,
    clock: fixedClock(TEST_TOKEN_INSTANT),
  });
}

function expectClaims(
  result: Awaited<ReturnType<IdTokenVerifier>>,
): GoogleClaims {
  if (!result.ok) throw new Error("expected verification to succeed");

  return result.claims;
}

describe("Google ID token verification: acceptance", () => {
  it("verifies a valid token and maps the claims", async () => {
    const key = await testKey();
    const idToken = await signIdToken({
      key,
      claims: googleClaims({
        name: "Dante",
        given_name: "Dante",
        family_name: "Alighieri",
      }),
    });
    const verifier = verifierFor(staticJwks(key));

    const result = await verifier({
      idToken,
      clientIds: [TEST_GOOGLE_CLIENT_ID],
    });

    const claims = expectClaims(result);
    expect(claims.subject).toBe("google-subject-1");
    expect(claims.email).toBe("user@example.com");
    expect(claims.emailVerified).toBe(true);
    expect(claims.givenName).toBe("Dante");
    expect(claims.familyName).toBe("Alighieri");
  });

  it("accepts the bare accounts.google.com issuer", async () => {
    const key = await testKey();
    const idToken = await signIdToken({
      key,
      claims: googleClaims({ iss: "accounts.google.com" }),
    });
    const verifier = verifierFor(staticJwks(key));

    await expect(
      verifier({ idToken, clientIds: [TEST_GOOGLE_CLIENT_ID] }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("Google ID token verification: configuration and claim rules", () => {
  it("treats an empty client id list as not configured", async () => {
    const verifier = verifierFor(
      createJwksCache({ fetchKeys: () => Promise.resolve({ keys: [] }) }),
    );

    await expect(
      verifier({ idToken: "anything", clientIds: [] }),
    ).resolves.toEqual({ ok: false, reason: "not_configured" });
  });

  it("rejects wrong issuer and audience", async () => {
    const key = await testKey();
    const verifier = verifierFor(staticJwks(key));
    const run = (claims: Record<string, unknown>) =>
      signIdToken({ key, claims }).then((idToken) =>
        verifier({ idToken, clientIds: [TEST_GOOGLE_CLIENT_ID] }),
      );

    await expect(
      run(googleClaims({ iss: "https://evil.example" })),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(run(googleClaims({ aud: "other-client" }))).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects expired tokens", async () => {
    const key = await testKey();
    const verifier = verifierFor(staticJwks(key));
    const expired = await signIdToken({
      key,
      claims: googleClaims({ exp: tokenInstantSeconds() - 120 }),
    });

    await expect(
      verifier({ idToken: expired, clientIds: [TEST_GOOGLE_CLIENT_ID] }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("parses email_verified booleans and string literals", async () => {
    const key = await testKey();
    const verifier = verifierFor(staticJwks(key));

    const asString = await signIdToken({
      key,
      claims: googleClaims({ email_verified: "true" }),
    });
    const asFalse = await signIdToken({
      key,
      claims: googleClaims({ email_verified: false }),
    });

    await expect(
      verifier({ idToken: asString, clientIds: [TEST_GOOGLE_CLIENT_ID] }),
    ).resolves.toMatchObject({ ok: true, claims: { emailVerified: true } });
    await expect(
      verifier({ idToken: asFalse, clientIds: [TEST_GOOGLE_CLIENT_ID] }),
    ).resolves.toMatchObject({ ok: true, claims: { emailVerified: false } });
  });
});

describe("Google ID token verification: rotation and signatures", () => {
  it("refetches the JWKS once when the kid is unknown", async () => {
    const key = await testKey();
    const rotated = await createRsaTestKey("rotated-key");
    let fetches = 0;

    const verifier = verifierFor(
      createJwksCache({
        fetchKeys: () => {
          fetches += 1;

          return Promise.resolve(
            fetches === 1 ? jwksFor(key) : jwksFor(rotated),
          );
        },
      }),
    );

    const idToken = await signIdToken({ key: rotated, claims: googleClaims() });
    const result = await verifier({
      idToken,
      clientIds: [TEST_GOOGLE_CLIENT_ID],
    });

    expect(result.ok).toBe(true);
    expect(fetches).toBe(2);

    const unknownKid = await signIdToken({
      key: rotated,
      claims: googleClaims(),
      header: { kid: "never-seen" },
    });

    await expect(
      verifier({ idToken: unknownKid, clientIds: [TEST_GOOGLE_CLIENT_ID] }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(fetches).toBe(2);
  });

  it("rejects signatures from a different key with the same kid", async () => {
    const key = await testKey();
    const impostor = await createRsaTestKey(key.kid);
    const verifier = verifierFor(staticJwks(key));

    const idToken = await signIdToken({
      key: impostor,
      claims: googleClaims(),
    });

    await expect(
      verifier({ idToken, clientIds: [TEST_GOOGLE_CLIENT_ID] }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });
});
