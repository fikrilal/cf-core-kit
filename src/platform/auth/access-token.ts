import { encodeBase64Url, encodeBytesBase64Url } from "../../shared/base64url";
import { randomBase64Url, signEd25519, verifyEd25519 } from "../crypto/crypto";
import { decodeJwt, readNumber, readString } from "./jwt";
import type { KeyRing } from "./keys";

export type AccessTokenPrincipal = Readonly<{
  userId: string;
  sessionId: string;
  emailVerified: boolean;
  roles: readonly string[];
}>;

export type IssueAccessTokenInput = Readonly<{
  keyRing: KeyRing;
  now: Date;
  ttlSeconds: number;
  userId: string;
  sessionId: string;
  emailVerified: boolean;
  roles: readonly string[];
  issuer?: string;
  audience?: string;
}>;

export type VerifyAccessTokenInput = Readonly<{
  token: string;
  keyRing: KeyRing;
  now: Date;
  issuer?: string;
  audience?: string;
}>;

const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_JTI_LENGTH = 128;

function audienceMatches(claim: unknown, expected: string): boolean {
  if (typeof claim === "string") return claim === expected;

  if (Array.isArray(claim)) return claim.some((entry) => entry === expected);

  return false;
}

function findVerificationKey(
  keyRing: KeyRing,
  header: Record<string, unknown>,
): CryptoKey | undefined {
  const kid = readString(header.kid);
  const alg = readString(header.alg);
  if (kid === undefined || alg === undefined) return undefined;

  const entry = keyRing.publicKeys.find((candidate) => candidate.kid === kid);
  if (entry?.alg !== alg) return undefined;

  return entry.key;
}

function timeClaimsValid(
  payload: Record<string, unknown>,
  nowSeconds: number,
): boolean {
  const exp = readNumber(payload.exp);
  const iat = readNumber(payload.iat);
  const nbf = readNumber(payload.nbf);
  if (exp === undefined || iat === undefined) return false;
  if (exp + CLOCK_SKEW_SECONDS <= nowSeconds) return false;
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) return false;
  if (iat > exp) return false;
  if (nbf !== undefined && nbf > nowSeconds + CLOCK_SKEW_SECONDS) return false;

  return true;
}

type CoreClaims = Readonly<{
  userId: string;
  sessionId: string;
  emailVerified: boolean;
}>;

function coreClaimsValid(
  payload: Record<string, unknown>,
  issuer: string | undefined,
  audience: string | undefined,
): CoreClaims | undefined {
  if (payload.typ !== "access") return undefined;

  const userId = readString(payload.sub);
  const sessionId = readString(payload.sid);
  const jti = readString(payload.jti);
  if (userId === undefined || sessionId === undefined) return undefined;
  if (jti === undefined || jti.length > MAX_JTI_LENGTH) return undefined;
  if (typeof payload.email_verified !== "boolean") return undefined;

  if (issuer !== undefined && payload.iss !== issuer) return undefined;
  if (audience !== undefined && !audienceMatches(payload.aud, audience)) {
    return undefined;
  }

  return { userId, sessionId, emailVerified: payload.email_verified };
}

function readRoles(value: unknown): readonly string[] | undefined {
  if (value === undefined) return [];

  if (!Array.isArray(value)) return undefined;

  const roles: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    if (!roles.includes(entry)) roles.push(entry);
  }

  return roles;
}

export async function issueAccessToken(
  input: IssueAccessTokenInput,
): Promise<string> {
  const signer = input.keyRing.signer;
  if (signer === undefined) throw new Error("no signing key available");

  const issuedAt = Math.floor(input.now.getTime() / 1000);
  const header = { alg: signer.alg, kid: signer.kid, typ: "JWT" };
  const payload = {
    sub: input.userId,
    sid: input.sessionId,
    email_verified: input.emailVerified,
    roles: [...input.roles],
    typ: "access",
    iat: issuedAt,
    exp: issuedAt + input.ttlSeconds,
    jti: randomBase64Url(16),
    ...(input.issuer === undefined ? {} : { iss: input.issuer }),
    ...(input.audience === undefined ? {} : { aud: input.audience }),
  };

  const data = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}`;
  const signature = await signEd25519(
    signer.key,
    new TextEncoder().encode(data),
  );

  return `${data}.${encodeBytesBase64Url(signature)}`;
}

export async function verifyAccessToken(
  input: VerifyAccessTokenInput,
): Promise<AccessTokenPrincipal | undefined> {
  const decoded = decodeJwt(input.token, MAX_TOKEN_LENGTH);
  if (decoded === undefined) return undefined;

  const verificationKey = findVerificationKey(input.keyRing, decoded.header);
  if (verificationKey === undefined) return undefined;

  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (!timeClaimsValid(decoded.payload, nowSeconds)) return undefined;

  const claims = coreClaimsValid(decoded.payload, input.issuer, input.audience);
  if (claims === undefined) return undefined;

  const roles = readRoles(decoded.payload.roles);
  if (roles === undefined) return undefined;

  const valid = await verifyEd25519(
    verificationKey,
    new TextEncoder().encode(decoded.signingInput),
    decoded.signature,
  );
  if (!valid) return undefined;

  return {
    userId: claims.userId,
    sessionId: claims.sessionId,
    emailVerified: claims.emailVerified,
    roles,
  };
}
