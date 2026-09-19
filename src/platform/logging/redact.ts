export const REDACTED = "[Redacted]";

const MAX_REDACT_DEPTH = 5;

export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "auth_signing_keys_json",
  "auth_signing_keys_json_base64",
  "r2_secret_access_key",
  "otel_exporter_otlp_headers",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactRecord(
  record: Readonly<Record<string, unknown>>,
  depth: number,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    output[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redactValue(value, depth);
  }

  return output;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_REDACT_DEPTH) return "[Truncated]";
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, depth + 1));
  if (!isRecord(value)) return value;

  return redactRecord(value, depth + 1);
}

export function redactLogFields(
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return redactRecord(fields, 0);
}
