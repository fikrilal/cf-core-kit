import { encodeBytesBase64Url } from "../../shared/base64url";
import { asNonEmptyString } from "../../shared/string";

export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

const MAX_REQUEST_HASH_DEPTH = 5;
const MAX_REQUEST_HASH_ARRAY_LENGTH = 100;
const MAX_REQUEST_HASH_OBJECT_KEYS = 100;
const MAX_REQUEST_HASH_STRING_LENGTH = 1024;
const MAX_REQUEST_HASH_CHARS = 32_768;

export const MAX_REPLAY_RECORD_CHARS = 65_536;

export type InProgressRecord = Readonly<{
  v: 1;
  state: "in_progress";
  requestHash: string;
  startedAt: number;
}>;

export type CompletedRecord = Readonly<{
  v: 1;
  state: "completed";
  requestHash: string;
  status: number;
  hasBody: boolean;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  completedAt: number;
}>;

export type StoredRecord = InProgressRecord | CompletedRecord;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function clampString(value: string): string {
  if (value.length <= MAX_REQUEST_HASH_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_REQUEST_HASH_STRING_LENGTH)}\u2026`;
}

function stableStringifyScalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(clampString(value));
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";

  return undefined;
}

function stableStringify(value: unknown, depth = 0): string {
  if (depth > MAX_REQUEST_HASH_DEPTH) {
    return JSON.stringify("__idempotency_depth_exceeded__");
  }

  const scalar = stableStringifyScalar(value);
  if (scalar !== undefined) return scalar;

  if (typeof value === "function")
    return JSON.stringify("__idempotency_function__");
  if (typeof value === "symbol" || typeof value === "bigint") {
    return JSON.stringify(`__idempotency_${typeof value}__`);
  }

  if (Array.isArray(value)) {
    const truncated = value.length > MAX_REQUEST_HASH_ARRAY_LENGTH;
    const inner = value
      .slice(0, MAX_REQUEST_HASH_ARRAY_LENGTH)
      .map((item) => stableStringify(item, depth + 1))
      .join(",");
    const marker = truncated ? ',"__idempotency_truncated_array__"' : "";
    return `[${inner}${marker}]`;
  }

  if (!isRecord(value)) return JSON.stringify("__idempotency_unknown__");

  const keys = Object.keys(value).sort();
  const truncated = keys.length > MAX_REQUEST_HASH_OBJECT_KEYS;
  const parts = keys
    .slice(0, MAX_REQUEST_HASH_OBJECT_KEYS)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key], depth + 1)}`,
    );

  if (truncated) {
    parts.push(
      `${JSON.stringify("__idempotency_truncated_object__")}:${JSON.stringify(true)}`,
    );
  }

  const serialized = `{${parts.join(",")}}`;
  return serialized.length <= MAX_REQUEST_HASH_CHARS
    ? serialized
    : serialized.slice(0, MAX_REQUEST_HASH_CHARS);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );

  return encodeBytesBase64Url(new Uint8Array(digest));
}

export async function hashScopeKey(scopeKey: string): Promise<string> {
  return sha256Base64Url(scopeKey);
}

export function isWriteMethod(value: unknown): value is WriteMethod {
  return (
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE"
  );
}

function parseHeaders(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!isRecord(raw)) return headers;

  for (const [key, value] of Object.entries(raw)) {
    const parsed = asNonEmptyString(value);
    if (parsed !== undefined) headers[key] = parsed;
  }

  return headers;
}

function parseCompletedRecord(
  parsed: Record<string, unknown>,
  requestHash: string,
): CompletedRecord | undefined {
  const status = asFiniteNumber(parsed.status);
  const hasBody =
    typeof parsed.hasBody === "boolean" ? parsed.hasBody : undefined;
  const completedAt = asFiniteNumber(parsed.completedAt);
  if (
    status === undefined ||
    hasBody === undefined ||
    completedAt === undefined
  ) {
    return undefined;
  }

  const headers = parseHeaders(parsed.headers);

  return {
    v: 1,
    state: "completed",
    requestHash,
    status: Math.trunc(status),
    hasBody,
    ...(hasBody ? { body: parsed.body } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    completedAt,
  };
}

export function parseRecord(raw: string): StoredRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  if (parsed.v !== 1) return undefined;

  const state = asNonEmptyString(parsed.state);
  const requestHash = asNonEmptyString(parsed.requestHash);
  if (!state || !requestHash) return undefined;

  if (state === "in_progress") {
    const startedAt = asFiniteNumber(parsed.startedAt);
    if (startedAt === undefined) return undefined;

    return { v: 1, state: "in_progress", requestHash, startedAt };
  }

  if (state !== "completed") return undefined;

  return parseCompletedRecord(parsed, requestHash);
}

export function createInProgressRecord(
  requestHash: string,
  startedAt = Date.now(),
): InProgressRecord {
  return { v: 1, state: "in_progress", requestHash, startedAt };
}

export function createCompletedRecord(input: {
  requestHash: string;
  status: number;
  body: unknown;
  headers: Readonly<Record<string, string>>;
  completedAt?: number;
}): CompletedRecord {
  const hasBody = input.body !== undefined && input.status !== 204;

  return {
    v: 1,
    state: "completed",
    requestHash: input.requestHash,
    status: Math.trunc(input.status),
    hasBody,
    ...(hasBody ? { body: input.body } : {}),
    ...(Object.keys(input.headers).length > 0
      ? { headers: input.headers }
      : {}),
    completedAt: input.completedAt ?? Date.now(),
  };
}

export type RequestHashInput = Readonly<{
  method: WriteMethod;
  path: string;
  query: Readonly<Record<string, string>>;
  body: unknown;
}>;

export async function computeRequestHash(
  input: RequestHashInput,
): Promise<string> {
  return sha256Base64Url(
    stableStringify({
      method: input.method,
      path: input.path,
      query: input.query,
      body: input.body,
    }),
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
