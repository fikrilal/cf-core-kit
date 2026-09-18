import { sql } from "drizzle-orm";

import { ErrorCode } from "../../shared/error-codes";
import { asNonEmptyString } from "../../shared/string";
import type { Database } from "../db/db";
import { AppError } from "../errors/app-error";
import {
  createCompletedRecord,
  createInProgressRecord,
  hashScopeKey,
  parseRecord,
  sleep,
  MAX_REPLAY_RECORD_CHARS,
  type CompletedRecord,
} from "./idempotency.core";

const MAX_KEY_HEADER_LENGTH = 128;

export type IdempotencyBeginResult =
  | Readonly<{ kind: "skip" }>
  | Readonly<{
      kind: "acquired";
      key: string;
      requestHash: string;
      ttlSeconds: number;
      waitMs: number;
    }>
  | Readonly<{ kind: "replay"; record: CompletedRecord }>
  | Readonly<{
      kind: "in_progress";
      key: string;
      requestHash: string;
      waitMs: number;
    }>;

export type IdempotencyBeginParams = Readonly<{
  principalId: string | undefined;
  headerValue: string | undefined;
  requestHash: string;
  scopeKey: string;
  required: boolean;
  ttlSeconds: number;
  waitMs: number;
  lockTtlSeconds: number;
}>;

type StoredRow = Readonly<{ record: string; expiresAt: number }>;

function inProgressError(): AppError {
  return new AppError({
    status: 409,
    code: ErrorCode.IDEMPOTENCY_IN_PROGRESS,
    message: "An identical request is already in progress",
  });
}

function reuseConflictError(): AppError {
  return new AppError({
    status: 409,
    code: ErrorCode.CONFLICT,
    message: "Idempotency-Key reuse with a different request payload",
  });
}

function validationError(message: string): AppError {
  return new AppError({
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
    issues: [{ field: "Idempotency-Key", message }],
  });
}

async function tryAcquire(
  db: Database,
  key: string,
  serialized: string,
  expiresAt: number,
): Promise<boolean> {
  const result = await db.run(sql`
    INSERT INTO idempotency_records (key, record, expires_at)
    VALUES (${key}, ${serialized}, ${expiresAt})
    ON CONFLICT(key) DO NOTHING
  `);

  return result.meta.changes > 0;
}

async function readRow(
  db: Database,
  key: string,
): Promise<StoredRow | undefined> {
  return db.get<StoredRow | undefined>(sql`
    SELECT record, expires_at AS expiresAt FROM idempotency_records WHERE key = ${key}
  `);
}

function acquiredResult(
  key: string,
  params: IdempotencyBeginParams,
): IdempotencyBeginResult {
  return {
    kind: "acquired",
    key,
    requestHash: params.requestHash,
    ttlSeconds: params.ttlSeconds,
    waitMs: params.waitMs,
  };
}

async function resolveConflict(
  db: Database,
  key: string,
  params: IdempotencyBeginParams,
  serialized: string,
  now: number,
): Promise<IdempotencyBeginResult | undefined> {
  const row = await readRow(db, key);

  if (row === undefined) {
    if (
      await tryAcquire(db, key, serialized, now + params.lockTtlSeconds * 1000)
    ) {
      return acquiredResult(key, params);
    }

    throw inProgressError();
  }

  if (row.expiresAt <= now) {
    await db.run(sql`
      DELETE FROM idempotency_records WHERE key = ${key} AND expires_at <= ${now}
    `);

    if (
      await tryAcquire(db, key, serialized, now + params.lockTtlSeconds * 1000)
    ) {
      return acquiredResult(key, params);
    }

    throw inProgressError();
  }

  const existing = parseRecord(row.record);
  if (!existing) throw inProgressError();
  if (existing.requestHash !== params.requestHash) throw reuseConflictError();
  if (existing.state === "completed")
    return { kind: "replay", record: existing };

  return undefined;
}

export async function beginIdempotency(
  db: Database,
  params: IdempotencyBeginParams,
): Promise<IdempotencyBeginResult> {
  const header = asNonEmptyString(params.headerValue);

  if (header === undefined) {
    if (!params.required) return { kind: "skip" };
    throw validationError("Idempotency-Key header is required");
  }

  if (header.length > MAX_KEY_HEADER_LENGTH) {
    throw validationError("Idempotency-Key header is too long");
  }

  const principalId = asNonEmptyString(params.principalId);
  if (principalId === undefined) {
    throw new AppError({
      status: 500,
      code: ErrorCode.INTERNAL,
      message: "Idempotency requires an authenticated principal",
    });
  }

  const scopeHash = await hashScopeKey(params.scopeKey);
  const key = `idempotency:v1:${principalId}:${scopeHash}:${header}`;
  const now = Date.now();
  const serialized = JSON.stringify(
    createInProgressRecord(params.requestHash, now),
  );

  if (
    await tryAcquire(db, key, serialized, now + params.lockTtlSeconds * 1000)
  ) {
    return acquiredResult(key, params);
  }

  const resolved = await resolveConflict(db, key, params, serialized, now);
  if (resolved !== undefined) return resolved;

  return {
    kind: "in_progress",
    key,
    requestHash: params.requestHash,
    waitMs: params.waitMs,
  };
}

export async function waitForIdempotencyCompletion(
  db: Database,
  key: string,
  requestHash: string,
  waitMs: number,
): Promise<CompletedRecord | undefined> {
  if (waitMs <= 0) return undefined;

  const deadline = Date.now() + waitMs;
  let delay = 50;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 2, 250);

    const row = await readRow(db, key);
    if (row === undefined) return undefined;

    const record = parseRecord(row.record);
    if (!record) return undefined;
    if (record.requestHash !== requestHash) throw reuseConflictError();
    if (record.state === "completed") return record;
  }

  return undefined;
}

export async function completeIdempotency(
  db: Database,
  key: string,
  requestHash: string,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>>,
  ttlSeconds: number,
): Promise<void> {
  if (status >= 400) {
    await releaseIdempotency(db, key, requestHash);
    return;
  }

  const completed = createCompletedRecord({
    requestHash,
    status,
    body,
    headers,
  });
  const serialized = JSON.stringify(completed);

  if (serialized.length > MAX_REPLAY_RECORD_CHARS) {
    await releaseIdempotency(db, key, requestHash);
    return;
  }

  await db.run(sql`
    UPDATE idempotency_records
    SET record = ${serialized}, expires_at = ${Date.now() + ttlSeconds * 1000}
    WHERE key = ${key}
  `);
}

export async function releaseIdempotency(
  db: Database,
  key: string,
  requestHash: string,
): Promise<void> {
  const row = await readRow(db, key);
  if (row === undefined) return;

  const record = parseRecord(row.record);
  if (!record) return;
  if (record.requestHash !== requestHash) return;
  if (record.state !== "in_progress") return;

  await db.run(sql`DELETE FROM idempotency_records WHERE key = ${key}`);
}

export async function deleteExpiredIdempotencyRecords(
  db: Database,
  input: Readonly<{ nowMs: number; limit: number }>,
): Promise<number> {
  const result = await db.run(sql`
    DELETE FROM idempotency_records
    WHERE key IN (
      SELECT key FROM idempotency_records
      WHERE expires_at <= ${input.nowMs}
      ORDER BY expires_at
      LIMIT ${input.limit}
    )
  `);

  return result.meta.changes;
}
