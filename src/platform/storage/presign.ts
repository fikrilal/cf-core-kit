import { AwsClient } from "aws4fetch";

import { ErrorCode } from "../../shared/error-codes";
import type { Clock } from "../clock/clock";
import { AppError } from "../errors/app-error";

export const PRESIGN_MIN_EXPIRY_SECONDS = 1;
export const PRESIGN_MAX_EXPIRY_SECONDS = 604_800;
export const PRESIGN_DEFAULT_EXPIRY_SECONDS = 300;
export const MAX_OBJECT_KEY_LENGTH = 1024;

export type PresignMethod = "GET" | "PUT";

export type PresignInput = Readonly<{
  method: PresignMethod;
  key: string;
  expiresInSeconds?: number;
}>;

export type ObjectPresigner = Readonly<{
  presign: (input: PresignInput) => Promise<string>;
}>;

export type ObjectPresignerConfig = Readonly<{
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

function validationError(field: string, message: string): AppError {
  return new AppError({
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
    issues: [{ field, message }],
  });
}

function amzDate(now: Date): string {
  return `${now.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

function normalizeKey(key: string): string {
  const normalized = key.trim().replace(/^\/+/, "");
  const segments = normalized.split("/");
  const hasInvalidSegment = segments.some(
    (segment) => segment === "" || segment === "." || segment === "..",
  );

  if (
    normalized === "" ||
    normalized.length > MAX_OBJECT_KEY_LENGTH ||
    hasInvalidSegment
  ) {
    throw validationError(
      "key",
      `must be a non-empty object key of at most ${String(MAX_OBJECT_KEY_LENGTH)} characters without empty, "." or ".." segments`,
    );
  }

  return normalized;
}

function resolveExpiry(expiresInSeconds: number | undefined): number {
  const expiry = expiresInSeconds ?? PRESIGN_DEFAULT_EXPIRY_SECONDS;

  if (
    !Number.isInteger(expiry) ||
    expiry < PRESIGN_MIN_EXPIRY_SECONDS ||
    expiry > PRESIGN_MAX_EXPIRY_SECONDS
  ) {
    throw validationError(
      "expiresInSeconds",
      `must be an integer within ${String(PRESIGN_MIN_EXPIRY_SECONDS)}..${String(PRESIGN_MAX_EXPIRY_SECONDS)} seconds`,
    );
  }

  return expiry;
}

function objectUrl(
  config: ObjectPresignerConfig,
  key: string,
  expires: number,
): string {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(
    `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}/${encodedKey}`,
  );

  url.searchParams.set("X-Amz-Expires", String(expires));

  return url.toString();
}

export function createObjectPresigner(
  config: ObjectPresignerConfig,
  clock: Clock,
): ObjectPresigner {
  for (const [name, value] of Object.entries(config)) {
    if (value.trim() === "") {
      throw new Error(`R2 presign configuration is missing "${name}"`);
    }
  }

  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  const presign = async (input: PresignInput): Promise<string> => {
    const key = normalizeKey(input.key);
    const expires = resolveExpiry(input.expiresInSeconds);
    const signed = await client.sign(objectUrl(config, key, expires), {
      method: input.method,
      aws: { signQuery: true, datetime: amzDate(clock.now()) },
    });

    return signed.url;
  };

  return { presign };
}
