import { decodeBase64Url } from "../../shared/base64url";
import type { AppConfig } from "../config/config";
import {
  exportPublicJwk,
  importEd25519PrivateKey,
  importEd25519PublicKey,
  importRsaPublicKey,
} from "../crypto/crypto";

export type SigningAlg = "EdDSA" | "RS256";

export type KeyJwk = JsonWebKey & Readonly<{ kid: string }>;

export type PublicKeyJwk = KeyJwk & Readonly<{ use: "sig"; alg: SigningAlg }>;

export type PublicKeyEntry = Readonly<{
  kid: string;
  alg: SigningAlg;
  key: CryptoKey;
  jwk: PublicKeyJwk;
}>;

export type KeyRing = Readonly<{
  signer:
    Readonly<{ kid: string; alg: SigningAlg; key: CryptoKey }> | undefined;
  publicKeys: readonly PublicKeyEntry[];
}>;

type SigningKeysConfig = Pick<
  AppConfig,
  "authSigningKeysJson" | "authSigningKeysJsonBase64"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJwk(value: unknown): value is KeyJwk {
  return (
    isRecord(value) &&
    typeof value.kty === "string" &&
    typeof value.kid === "string" &&
    value.kid !== ""
  );
}

function parseKeyItems(source: string): readonly KeyJwk[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("AUTH_SIGNING_KEYS_JSON is not valid JSON");
  }

  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.keys)
      ? parsed.keys
      : undefined;

  if (items === undefined) {
    throw new Error(
      "AUTH_SIGNING_KEYS_JSON must be an array or a { keys } object",
    );
  }

  return items.filter(isJwk);
}

function inferAlg(item: KeyJwk): SigningAlg | undefined {
  if (
    item.kty === "OKP" &&
    (item.crv === undefined || item.crv === "Ed25519")
  ) {
    return "EdDSA";
  }

  if (item.kty === "RSA") return "RS256";

  return undefined;
}

function toPublicJwk(item: KeyJwk): JsonWebKey {
  const publicJwk: JsonWebKey = { kty: item.kty };

  if (item.crv !== undefined) publicJwk.crv = item.crv;
  if (item.x !== undefined) publicJwk.x = item.x;
  if (item.n !== undefined) publicJwk.n = item.n;
  if (item.e !== undefined) publicJwk.e = item.e;

  return publicJwk;
}

async function importPublicKey(
  item: KeyJwk,
  alg: SigningAlg,
): Promise<CryptoKey> {
  const publicJwk = toPublicJwk(item);

  return alg === "EdDSA"
    ? importEd25519PublicKey(publicJwk)
    : importRsaPublicKey(publicJwk);
}

async function buildEntry(
  item: KeyJwk,
): Promise<
  | Readonly<{ entry: PublicKeyEntry; privateKey: CryptoKey | undefined }>
  | undefined
> {
  const alg = inferAlg(item);
  if (alg === undefined) return undefined;

  const key = await importPublicKey(item, alg);
  const publicJwk = await exportPublicJwk(key);
  const jwk: PublicKeyJwk = { ...publicJwk, kid: item.kid, use: "sig", alg };
  const privateKey =
    alg === "EdDSA" && typeof item.d === "string"
      ? await importEd25519PrivateKey(item)
      : undefined;

  return { entry: { kid: item.kid, alg, key, jwk }, privateKey };
}

export async function buildKeyRing(
  config: SigningKeysConfig,
): Promise<KeyRing> {
  const source =
    config.authSigningKeysJson ??
    (config.authSigningKeysJsonBase64 === undefined
      ? undefined
      : decodeBase64Url(config.authSigningKeysJsonBase64));

  if (source === undefined || source.trim() === "") {
    throw new Error("AUTH_SIGNING_KEYS_JSON is not configured");
  }

  const publicKeys: PublicKeyEntry[] = [];
  let signer: KeyRing["signer"];

  for (const item of parseKeyItems(source)) {
    if (publicKeys.some((entry) => entry.kid === item.kid)) continue;

    const built = await buildEntry(item);
    if (built === undefined) continue;

    publicKeys.push(built.entry);

    if (signer === undefined && built.privateKey !== undefined) {
      signer = {
        kid: built.entry.kid,
        alg: built.entry.alg,
        key: built.privateKey,
      };
    }
  }

  if (publicKeys.length === 0) {
    throw new Error("AUTH_SIGNING_KEYS_JSON did not contain any usable keys");
  }

  if (signer === undefined) {
    throw new Error(
      "AUTH_SIGNING_KEYS_JSON did not contain a private Ed25519 signing key",
    );
  }

  return { signer, publicKeys };
}

const keyRingCache = new Map<string, Promise<KeyRing>>();

export function getKeyRing(config: SigningKeysConfig): Promise<KeyRing> {
  const cacheKey =
    config.authSigningKeysJson ?? config.authSigningKeysJsonBase64 ?? "";

  const cached = keyRingCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pending = buildKeyRing(config);
  keyRingCache.set(cacheKey, pending);

  return pending;
}
