import { decodeBase64Url, decodeBytesBase64Url } from "../../shared/base64url";

export type DecodedJwt = Readonly<{
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSegment(segment: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(segment));

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function decodeJwt(
  token: string,
  maxLength: number,
): DecodedJwt | undefined {
  if (token.length === 0 || token.length > maxLength) return undefined;

  const segments = token.split(".");
  if (segments.length !== 3) return undefined;

  const [headerSegment = "", payloadSegment = "", signatureSegment = ""] =
    segments;
  const header = parseSegment(headerSegment);
  const payload = parseSegment(payloadSegment);
  if (header === undefined || payload === undefined) return undefined;

  let signature: Uint8Array;
  try {
    signature = decodeBytesBase64Url(signatureSegment);
  } catch {
    return undefined;
  }

  return {
    header,
    payload,
    signingInput: `${headerSegment}.${payloadSegment}`,
    signature,
  };
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
