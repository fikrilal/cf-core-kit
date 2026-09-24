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

export type PresignedUpload = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
}>;

export type HeadObjectResult =
  | Readonly<{ exists: false }>
  | Readonly<{
      exists: true;
      contentType: string | undefined;
      contentLength: number | undefined;
    }>;

export type ObjectStorageHandle = Readonly<{
  bucket: string;
  storage: ObjectStorage;
}>;

export type ObjectStorage = ObjectPresigner &
  Readonly<{
    presignPutObject: (input: {
      key: string;
      contentType: string;
      expiresInSeconds?: number;
    }) => Promise<PresignedUpload>;
    headObject: (key: string) => Promise<HeadObjectResult>;
    deleteObject: (key: string) => Promise<void>;
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
  return createObjectStorage(config, clock);
}

function objectRequestUrl(config: ObjectPresignerConfig, key: string): string {
  const objectKey = normalizeKey(key);

  return `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}/${objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function createSignedSender(
  config: ObjectPresignerConfig,
  client: AwsClient,
  clock: Clock,
): (key: string, method: "HEAD" | "DELETE") => Promise<Response> {
  return async (key, method) => {
    const signed = await client.sign(objectRequestUrl(config, key), {
      method,
      aws: { datetime: amzDate(clock.now()) },
    });

    return fetch(signed);
  };
}

export function createObjectStorage(
  config: ObjectPresignerConfig,
  clock: Clock,
): ObjectStorage {
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

  const presignPutObject: ObjectStorage["presignPutObject"] = async (input) => {
    const key = normalizeKey(input.key);
    const expires = resolveExpiry(input.expiresInSeconds);
    const signed = await client.sign(objectUrl(config, key, expires), {
      method: "PUT",
      headers: { "content-type": input.contentType },
      aws: {
        signQuery: true,
        datetime: amzDate(clock.now()),
        allHeaders: true,
      },
    });

    return {
      url: signed.url,
      headers: { "Content-Type": input.contentType },
    };
  };

  const send = createSignedSender(config, client, clock);

  const headObject: ObjectStorage["headObject"] = async (key) => {
    const response = await send(key, "HEAD");

    if (response.status === 404) return { exists: false };
    if (!response.ok) {
      throw new Error(
        `R2 head object failed with status ${String(response.status)}`,
      );
    }

    const contentLength = response.headers.get("content-length");

    return {
      exists: true,
      contentType: response.headers.get("content-type") ?? undefined,
      contentLength:
        contentLength === null ? undefined : Number.parseInt(contentLength, 10),
    };
  };

  const deleteObject: ObjectStorage["deleteObject"] = async (key) => {
    const response = await send(key, "DELETE");

    if (response.ok || response.status === 404) return;

    throw new Error(
      `R2 delete object failed with status ${String(response.status)}`,
    );
  };

  return { presign, presignPutObject, headObject, deleteObject };
}
