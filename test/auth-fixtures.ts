import { env } from "cloudflare:workers";

import type {
  GoogleClaims,
  IdTokenVerification,
  IdTokenVerifier,
} from "../src/features/auth/oidc";
import type { LimiterFactory } from "../src/platform/rate-limit/require-rate-limit";
import {
  exportPublicJwk,
  randomBase64Url,
  sha256Base64Url,
} from "../src/platform/crypto/crypto";
import { issueAccessToken } from "../src/platform/auth/access-token";
import { buildKeyRing } from "../src/platform/auth/keys";
import type { Database } from "../src/platform/db/db";
import {
  emailVerificationTokens,
  oidcIdentities,
  refreshTokens,
  sessions,
  users,
  type UserStatus,
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
    | "AUTH_AUDIENCE"
    | "RESEND_API_KEY"
    | "EMAIL_FROM"
    | "EMAIL_REPLY_TO"
    | "PUBLIC_APP_URL",
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
  await db.delete(emailVerificationTokens);
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

export function recordsOf(
  body: Record<string, unknown>,
  key = "data",
): Record<string, unknown>[] {
  const value = body[key];
  if (!Array.isArray(value)) throw new Error(`expected an array at ${key}`);

  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return {};
    }

    const record: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(entry)) {
      record[entryKey] = entryValue;
    }

    return record;
  });
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

export type SeededSession = Readonly<{
  userId: string;
  sessionId: string;
  tokenId: string;
  refreshToken: string;
}>;

export type SeedSessionOptions = Readonly<{
  now?: Date;
  email?: string;
  status?: UserStatus;
  sessionExpiresAt?: Date;
  tokenExpiresAt?: Date;
  sessionRevokedAt?: Date;
  tokenRevokedAt?: Date;
}>;

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function seedSessionWithRefreshToken(
  db: Database,
  options: SeedSessionOptions = {},
): Promise<SeededSession> {
  const now = options.now ?? new Date();
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const refreshToken = randomBase64Url(32);
  const defaultExpiry = new Date(now.getTime() + DEFAULT_SESSION_TTL_MS);

  await db.insert(users).values({
    id: userId,
    email: options.email ?? `seed-${userId}@example.com`,
    emailVerifiedAt: now,
    ...(options.status === undefined ? {} : { status: options.status }),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    lastSeenAt: now,
    expiresAt: options.sessionExpiresAt ?? defaultExpiry,
    ...(options.sessionRevokedAt === undefined
      ? {}
      : { revokedAt: options.sessionRevokedAt }),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(refreshTokens).values({
    id: tokenId,
    sessionId,
    tokenHash: await sha256Base64Url(refreshToken),
    expiresAt: options.tokenExpiresAt ?? defaultExpiry,
    ...(options.tokenRevokedAt === undefined
      ? {}
      : { revokedAt: options.tokenRevokedAt }),
    createdAt: now,
    updatedAt: now,
  });

  return { userId, sessionId, tokenId, refreshToken };
}

export type GeneratedEd25519Key = Readonly<{
  privateJwk: JsonWebKey & { kid: string };
  publicJwk: JsonWebKey & { kid: string };
}>;

export async function generateEd25519Key(
  kid: string,
): Promise<GeneratedEd25519Key> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  if (!("privateKey" in pair)) throw new Error("expected an Ed25519 key pair");

  const exported = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!("kty" in exported)) throw new Error("expected a private JWK");

  return {
    privateJwk: { ...exported, kid },
    publicJwk: {
      kty: exported.kty,
      crv: exported.crv,
      x: exported.x,
      kid,
    },
  };
}

export function permissiveLimiterFactory(): LimiterFactory {
  return () => () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
}

export async function userAccessToken(
  userId: string,
  options: Readonly<{
    emailVerified?: boolean;
    roles?: readonly string[];
    sessionId?: string;
    now?: Date;
  }> = {},
): Promise<string> {
  const keyRing = await buildKeyRing({
    authSigningKeysJson: TEST_SIGNING_KEYS_JSON,
    authSigningKeysJsonBase64: undefined,
  });

  return issueAccessToken({
    keyRing,
    now: options.now ?? new Date(),
    ttlSeconds: 900,
    userId,
    sessionId: options.sessionId ?? crypto.randomUUID(),
    emailVerified: options.emailVerified ?? true,
    roles: options.roles ?? ["USER"],
  });
}
