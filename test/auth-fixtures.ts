import { env } from "cloudflare:workers";

import type {
  GoogleClaims,
  IdTokenVerification,
  IdTokenVerifier,
} from "../src/features/auth/oidc";
import { exportPublicJwk } from "../src/platform/crypto/crypto";
import type { Database } from "../src/platform/db/db";
import {
  oidcIdentities,
  refreshTokens,
  sessions,
  users,
} from "../src/platform/db/schema";
import { encodeBase64Url, encodeBytesBase64Url } from "../src/shared/base64url";
import type { RuntimeEnv } from "./app-request";

const TEST_ED25519_PRIVATE_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  d: "RRIj8bg_uz83k2IcGTBCZAnLkl1k9somQdreqNkgSWg",
  x: "c-9lG83nhpYsMflhjdoxpv8XmFrJpz4Mwm47EsftkRM",
};

export const TEST_SIGNING_KID = "test-key-1";

const SIGNING_JWK = { ...TEST_ED25519_PRIVATE_JWK, kid: TEST_SIGNING_KID };

export const TEST_SIGNING_KEYS_JSON = JSON.stringify([SIGNING_JWK]);
export const TEST_GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";

export type AuthEnvOverrides = Partial<
  Record<
    | "AUTH_ACCESS_TOKEN_TTL_SECONDS"
    | "AUTH_REFRESH_TOKEN_TTL_SECONDS"
    | "AUTH_SIGNING_KEYS_JSON"
    | "AUTH_SIGNING_KEYS_JSON_BASE64"
    | "AUTH_OIDC_GOOGLE_CLIENT_IDS"
    | "AUTH_ISSUER"
    | "AUTH_AUDIENCE",
    string
  >
>;

export function authEnv(overrides: AuthEnvOverrides = {}): RuntimeEnv {
  return {
    ...env,
    AUTH_SIGNING_KEYS_JSON: TEST_SIGNING_KEYS_JSON,
    AUTH_OIDC_GOOGLE_CLIENT_IDS: TEST_GOOGLE_CLIENT_ID,
    ...overrides,
  };
}

export type RsaTestKey = Readonly<{
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  kid: string;
}>;

export async function createRsaTestKey(
  kid = "test-rsa-key-1",
): Promise<RsaTestKey> {
  const generated = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  if (!("privateKey" in generated)) {
    throw new Error("expected an RSA key pair");
  }

  const publicJwk = await exportPublicJwk(generated.publicKey);

  return { privateKey: generated.privateKey, publicJwk, kid };
}

export function jwksFor(key: RsaTestKey): { keys: unknown[] } {
  return {
    keys: [{ ...key.publicJwk, kid: key.kid, alg: "RS256", use: "sig" }],
  };
}

export type IdTokenOptions = Readonly<{
  key: RsaTestKey;
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
}>;

export const TEST_TOKEN_INSTANT = new Date("2026-06-01T00:00:00.000Z");

export function tokenInstantSeconds(): number {
  return Math.floor(TEST_TOKEN_INSTANT.getTime() / 1000);
}

export function googleClaims(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const iat = tokenInstantSeconds();

  return {
    iss: "https://accounts.google.com",
    aud: TEST_GOOGLE_CLIENT_ID,
    sub: "google-subject-1",
    email: "user@example.com",
    email_verified: true,
    iat,
    exp: iat + 600,
    ...overrides,
  };
}

export async function signIdToken(options: IdTokenOptions): Promise<string> {
  const header = {
    alg: "RS256",
    kid: options.key.kid,
    typ: "JWT",
    ...options.header,
  };
  const payload = options.claims ?? googleClaims();
  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    options.key.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${encodeBytesBase64Url(new Uint8Array(signature))}`;
}

export async function cleanAuthTables(db: Database): Promise<void> {
  await db.delete(refreshTokens);
  await db.delete(sessions);
  await db.delete(oidcIdentities);
  await db.delete(users);
}

export const TEST_GOOGLE_SUBJECT = "google-subject-1";
export const TEST_USER_EMAIL = "user@example.com";

export function fakeVerifier(
  overrides: Partial<GoogleClaims> = {},
): IdTokenVerifier {
  const verification: IdTokenVerification = {
    ok: true,
    claims: {
      subject: TEST_GOOGLE_SUBJECT,
      email: TEST_USER_EMAIL,
      emailVerified: true,
      name: "Test User",
      givenName: "Test",
      familyName: "User",
      ...overrides,
    },
  };

  return () => Promise.resolve(verification);
}

export async function jsonRecord(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("expected an object body");
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    result[key] = value;
  }

  return result;
}

export function pick(
  record: Record<string, unknown>,
  ...path: readonly string[]
): unknown {
  let current: unknown = record;

  for (const key of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      throw new Error(`missing path segment: ${key}`);
    }

    const asRecord: Record<string, unknown> = {};
    for (const [entryKey, value] of Object.entries(current)) {
      asRecord[entryKey] = value;
    }

    current = asRecord[key];
  }

  return current;
}

export function pickString(
  record: Record<string, unknown>,
  ...path: readonly string[]
): string {
  const value = pick(record, ...path);
  if (typeof value !== "string")
    throw new Error(`expected a string at ${path.join(".")}`);

  return value;
}
