import {
  decodeBytesBase64Url,
  encodeBytesBase64Url,
} from "../../shared/base64url";

export function decodeBase64UrlBytes(value: string): Uint8Array {
  return decodeBytesBase64Url(value);
}

export function encodeBase64UrlBytes(value: Uint8Array): string {
  return encodeBytesBase64Url(value);
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  return encodeBytesBase64Url(bytes);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );

  return encodeBytesBase64Url(new Uint8Array(digest));
}

export function importEd25519PrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, [
    "sign",
  ]);
}

export function importEd25519PublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, [
    "verify",
  ]);
}

export function importRsaPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"],
  );
}

export async function signEd25519(
  key: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign("Ed25519", key, data);

  return new Uint8Array(signature);
}

export function verifyEd25519(
  key: CryptoKey,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  return crypto.subtle.verify("Ed25519", key, signature, data);
}

export function verifyRs256(
  key: CryptoKey,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signature,
    data,
  );
}

export async function exportPublicJwk(key: CryptoKey): Promise<JsonWebKey> {
  const exported = await crypto.subtle.exportKey("jwk", key);

  if (!("kty" in exported)) throw new Error("exported key is not a JWK");

  return exported;
}
