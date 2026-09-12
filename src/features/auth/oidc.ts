import type { Clock } from "../../platform/clock/clock";
import { systemClock } from "../../platform/clock/clock";
import { importRsaPublicKey, verifyRs256 } from "../../platform/crypto/crypto";
import {
  decodeJwt,
  isRecord,
  readNumber,
  readString,
} from "../../platform/auth/jwt";

export type GoogleClaims = Readonly<{
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
  givenName: string | undefined;
  familyName: string | undefined;
}>;

export type IdTokenVerification =
  | Readonly<{ ok: true; claims: GoogleClaims }>
  | Readonly<{ ok: false; reason: "not_configured" | "invalid" }>;

export type IdTokenInput = Readonly<{
  idToken: string;
  clientIds: readonly string[];
}>;

export type IdTokenVerifier = (
  input: IdTokenInput,
) => Promise<IdTokenVerification>;

export type OidcKey = JsonWebKey & Readonly<{ kid: string }>;

export type JwksCache = Readonly<{
  get: (kid: string | undefined) => Promise<readonly OidcKey[]>;
}>;

const GOOGLE_ISSUERS: readonly string[] = [
  "https://accounts.google.com",
  "accounts.google.com",
];
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const CLOCK_SKEW_SECONDS = 60;
const MAX_ID_TOKEN_LENGTH = 16_384;
const DEFAULT_JWKS_TTL_MS = 10 * 60 * 1000;
const FORCED_REFETCH_COOLDOWN_MS = 30_000;

function isOidcKey(value: unknown): value is OidcKey {
  return (
    isRecord(value) &&
    value.kty === "RSA" &&
    typeof value.kid === "string" &&
    value.kid !== ""
  );
}

function parseJwks(value: unknown): readonly OidcKey[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) return [];

  return value.keys.filter(isOidcKey);
}

export type JwksCacheOptions = Readonly<{
  fetchKeys: () => Promise<unknown>;
  ttlMs?: number;
  clock?: Clock;
}>;

export function createJwksCache(options: JwksCacheOptions): JwksCache {
  const ttlMs = options.ttlMs ?? DEFAULT_JWKS_TTL_MS;
  const clock = options.clock ?? systemClock;
  let cached: { keys: readonly OidcKey[]; expiresAt: number } | undefined;
  let inflight: Promise<readonly OidcKey[]> | undefined;
  let lastForcedFetchAt = 0;

  const load = (): Promise<readonly OidcKey[]> => {
    inflight ??= options
      .fetchKeys()
      .then((value) => {
        const keys = parseJwks(value);
        cached = { keys, expiresAt: clock.now().getTime() + ttlMs };
        inflight = undefined;

        return keys;
      })
      .catch((error: unknown) => {
        inflight = undefined;

        throw error;
      });

    return inflight;
  };

  const loadForced = (): Promise<readonly OidcKey[]> => {
    const nowMs = clock.now().getTime();
    if (
      cached !== undefined &&
      nowMs - lastForcedFetchAt < FORCED_REFETCH_COOLDOWN_MS
    ) {
      return Promise.resolve(cached.keys);
    }

    lastForcedFetchAt = nowMs;

    return load();
  };

  const hasKid = (keys: readonly OidcKey[], kid: string | undefined): boolean =>
    kid === undefined || keys.some((key) => key.kid === kid);

  return {
    get: (kid) => {
      if (cached !== undefined && clock.now().getTime() < cached.expiresAt) {
        if (hasKid(cached.keys, kid)) return Promise.resolve(cached.keys);

        return loadForced();
      }

      return load().then((keys) => (hasKid(keys, kid) ? keys : loadForced()));
    },
  };
}

export function createGoogleJwksCache(
  fetchFn: typeof fetch = fetch,
  clock: Clock = systemClock,
): JwksCache {
  return createJwksCache({
    fetchKeys: async () => {
      const response = await fetchFn(GOOGLE_JWKS_URL, {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `Google JWKS fetch failed with status ${String(response.status)}`,
        );
      }

      return response.json();
    },
    clock,
  });
}

function readEmailVerified(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;

  return undefined;
}

function audienceMatches(
  claim: unknown,
  clientIds: readonly string[],
): boolean {
  if (typeof claim === "string") return clientIds.includes(claim);

  if (Array.isArray(claim)) {
    return claim.some(
      (entry) => typeof entry === "string" && clientIds.includes(entry),
    );
  }

  return false;
}

function validateClaims(
  payload: Record<string, unknown>,
  clientIds: readonly string[],
  nowSeconds: number,
): GoogleClaims | undefined {
  const issuer = readString(payload.iss);
  if (issuer === undefined || !GOOGLE_ISSUERS.includes(issuer))
    return undefined;
  if (!audienceMatches(payload.aud, clientIds)) return undefined;

  const exp = readNumber(payload.exp);
  const iat = readNumber(payload.iat);
  if (exp === undefined || iat === undefined) return undefined;
  if (exp + CLOCK_SKEW_SECONDS <= nowSeconds) return undefined;
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) return undefined;

  const subject = readString(payload.sub);
  const email = readString(payload.email);
  const emailVerified = readEmailVerified(payload.email_verified);
  if (subject === undefined || email === undefined) return undefined;
  if (emailVerified === undefined) return undefined;

  return {
    subject,
    email,
    emailVerified,
    name: readString(payload.name),
    givenName: readString(payload.given_name),
    familyName: readString(payload.family_name),
  };
}

export type GoogleVerifierOptions = Readonly<{
  jwks: JwksCache;
  clock?: Clock;
}>;

export function createGoogleIdTokenVerifier(
  options: GoogleVerifierOptions,
): IdTokenVerifier {
  const clock = options.clock ?? systemClock;

  return async ({ idToken, clientIds }) => {
    if (clientIds.length === 0) return { ok: false, reason: "not_configured" };

    const decoded = decodeJwt(idToken, MAX_ID_TOKEN_LENGTH);
    if (decoded === undefined) return { ok: false, reason: "invalid" };
    if (decoded.header.alg !== "RS256") return { ok: false, reason: "invalid" };

    const kid = readString(decoded.header.kid);
    const keys = await options.jwks.get(kid);
    const key = keys.find((candidate) => candidate.kid === kid);
    if (key === undefined) return { ok: false, reason: "invalid" };

    const cryptoKey = await importRsaPublicKey(key);
    const valid = await verifyRs256(
      cryptoKey,
      new TextEncoder().encode(decoded.signingInput),
      decoded.signature,
    );
    if (!valid) return { ok: false, reason: "invalid" };

    const claims = validateClaims(
      decoded.payload,
      clientIds,
      Math.floor(clock.now().getTime() / 1000),
    );
    if (claims === undefined) return { ok: false, reason: "invalid" };

    return { ok: true, claims };
  };
}

export function createDefaultIdTokenVerifier(): IdTokenVerifier {
  return createGoogleIdTokenVerifier({ jwks: createGoogleJwksCache() });
}
