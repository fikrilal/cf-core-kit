import { expect } from "vitest";

import type { CapturedRequest } from "../profile-image-fixtures";

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected ${what} to be an object`);
  }

  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;

  return record;
}

/**
 * The success envelope (`{ data, meta? }`, standards/http-contract.md). Returns `data` as a record so
 * specs can assert fields directly.
 */
export async function expectData(
  response: Response,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(200);

  const body = asRecord(await response.json(), "a success body");

  expect(body).not.toHaveProperty("error");
  expect(body).toHaveProperty("data");

  return asRecord(body.data, "data");
}

export type ExpectedList = Readonly<{
  items: Record<string, unknown>[];
  meta: Record<string, unknown>;
}>;

/** The list envelope: `data` plus `{ nextCursor?, limit, hasMore }`. */
export async function expectDataArray(
  response: Response,
): Promise<ExpectedList> {
  expect(response.status).toBe(200);

  const body = asRecord(await response.json(), "a success body");
  const data = body.data;

  if (!Array.isArray(data)) throw new Error("expected an array at data");

  const items = data.map((entry) => asRecord(entry, "a list entry"));
  const meta = asRecord(body.meta, "list meta");

  expect(typeof meta.limit).toBe("number");
  expect(typeof meta.hasMore).toBe("boolean");

  return { items, meta };
}

/** 204 with no body and no content type — the dialect's no-content response. */
export async function expectNoContent(response: Response): Promise<void> {
  expect(response.status).toBe(204);
  await expect(response.text()).resolves.toBe("");
  expect(response.headers.get("Content-Type")).toBeNull();
}

/**
 * RFC7807 problem details with the stable code and the request-id echo: the `traceId` in the body is
 * the `X-Request-Id` the caller can quote in a support request.
 */
export async function expectProblem(
  response: Response,
  status: number,
  code: string,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status);

  const body = asRecord(await response.json(), "a problem body");

  expect(body.status).toBe(status);
  expect(body.code).toBe(code);
  expect(typeof body.title).toBe("string");

  const traceId = body.traceId;
  expect(typeof traceId).toBe("string");
  expect(response.headers.get("X-Request-Id")).toBe(traceId);

  return body;
}

/** 429 with the retry dialect: `RATE_LIMITED`, a truthful `Retry-After`, and no envelope. */
export async function expectRateLimited(response: Response): Promise<number> {
  const body = await expectProblem(response, 429, "RATE_LIMITED");
  const retryAfter = Number(response.headers.get("Retry-After"));

  expect(Number.isInteger(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(body.title).toBe("Too Many Requests");

  return retryAfter;
}

/** The storage object behind `key` was deleted through the signed fetch seam. */
export function expectObjectDeleted(
  calls: readonly CapturedRequest[],
  key: string,
): void {
  const deleted = calls.some(
    (call) => call.method === "DELETE" && call.url.includes(key),
  );

  expect(deleted, `expected a DELETE for ${key}`).toBe(true);
}

/** A unique address per test, so parallel specs cannot collide on a unique index. */
export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

/** The `sid` claim of an access token, without pulling in a JWT library for one field. */
export function sessionIdFromToken(token: string): string {
  const [, payload] = token.split(".");

  if (payload === undefined) throw new Error("access token has no payload");

  const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
  const claims: unknown = JSON.parse(atob(normalized));
  const sid = asRecord(claims, "token claims").sid;

  if (typeof sid !== "string") throw new Error("access token has no sid claim");

  return sid;
}
