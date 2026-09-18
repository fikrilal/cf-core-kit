import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { send } from "../../../test/app-request";

import { ErrorCode } from "../../shared/error-codes";
import { createDb } from "../db/db";
import { AppError } from "../errors/app-error";
import { createApp } from "./app";
import { created, data } from "./envelope";
import { computeRequestHash, hashScopeKey } from "./idempotency.core";
import { idempotent, type IdempotencyOptions } from "./idempotency";
import { deleteExpiredIdempotencyRecords } from "./idempotency.service";

function createTestApp(
  options: { middleware?: IdempotencyOptions; withPrincipal?: boolean } = {},
) {
  const app = createApp();
  const counters = { executed: 0 };

  if (options.withPrincipal ?? true) {
    app.use("*", async (context, next) => {
      context.set("principalId", "user-1");
      await next();
    });
  }

  app.post(
    "/items",
    idempotent({
      scopeKey: "items.create",
      required: true,
      ...options.middleware,
    }),
    () => {
      counters.executed += 1;
      return created({ id: "item-1" }, "/items/item-1");
    },
  );

  app.post("/optional", idempotent({ scopeKey: "items.optional" }), () => {
    counters.executed += 1;
    return data({ ok: true });
  });

  app.post(
    "/failing",
    idempotent({ scopeKey: "items.failure", required: true }),
    () => {
      counters.executed += 1;

      if (counters.executed === 1) {
        throw new AppError({
          status: 409,
          code: ErrorCode.CONFLICT,
          message: "boom",
        });
      }

      return data({ ok: true });
    },
  );

  app.post(
    "/large",
    idempotent({ scopeKey: "items.large", required: true }),
    () => {
      counters.executed += 1;
      return data({ blob: "x".repeat(70_000) });
    },
  );

  app.get("/read", idempotent({ scopeKey: "items.read" }), () =>
    data({ ok: true }),
  );

  return { app, counters };
}

function post(path: string, headers: Record<string, string>, body: unknown) {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function seedInProgress(
  key: string,
  requestHash: string,
  expiresAt: number,
): Promise<void> {
  const db = createDb(env.DB);

  await db.run(sql`
    INSERT OR REPLACE INTO idempotency_records (key, record, expires_at)
    VALUES (${key}, ${JSON.stringify({ v: 1, state: "in_progress", requestHash, startedAt: 1 })}, ${expiresAt})
  `);
}

async function scopedKey(scopeKey: string, header: string): Promise<string> {
  return `idempotency:v1:user-1:${await hashScopeKey(scopeKey)}:${header}`;
}

describe("idempotent middleware", () => {
  it("skips requests without a key when not required", async () => {
    const { app, counters } = createTestApp();

    const first = await send(app, post("/optional", {}, { a: 1 }));
    const second = await send(app, post("/optional", {}, { a: 1 }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBeNull();
    expect(counters.executed).toBe(2);
  });

  it("requires the key header when configured", async () => {
    const { app, counters } = createTestApp();

    const response = await send(app, post("/items", {}, { a: 1 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [
        {
          field: "Idempotency-Key",
          message: "Idempotency-Key header is required",
        },
      ],
    });
    expect(counters.executed).toBe(0);
  });

  it("replays a completed response with the downgraded status", async () => {
    const { app, counters } = createTestApp();

    const first = await send(
      app,
      post("/items", { "idempotency-key": "key-replay" }, { a: 1 }),
    );

    expect(first.status).toBe(201);
    expect(first.headers.get("Location")).toBe("/items/item-1");

    const second = await send(
      app,
      post("/items", { "idempotency-key": "key-replay" }, { a: 1 }),
    );

    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(second.headers.get("Location")).toBe("/items/item-1");
    await expect(second.json()).resolves.toEqual({ data: { id: "item-1" } });
    expect(counters.executed).toBe(1);
  });
});

describe("idempotent middleware conflicts", () => {
  it("rejects key reuse with a different payload", async () => {
    const { app } = createTestApp();

    await send(
      app,
      post("/items", { "idempotency-key": "key-mismatch" }, { a: 1 }),
    );
    const response = await send(
      app,
      post("/items", { "idempotency-key": "key-mismatch" }, { a: 2 }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONFLICT",
      detail: "Idempotency-Key reuse with a different request payload",
    });
  });

  it("waits and reports in-progress with Retry-After", async () => {
    const { app, counters } = createTestApp({ middleware: { waitMs: 30 } });
    const key = await scopedKey("items.create", "key-in-progress");
    const requestHash = await computeRequestHash({
      method: "POST",
      path: "/items",
      query: {},
      body: { a: 1 },
    });

    await seedInProgress(key, requestHash, Date.now() + 60_000);

    const response = await send(
      app,
      post("/items", { "idempotency-key": "key-in-progress" }, { a: 1 }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
    });
    expect(counters.executed).toBe(0);
  });

  it("takes over a stale in-progress lock", async () => {
    const { app, counters } = createTestApp();
    const key = await scopedKey("items.create", "key-stale");

    await seedInProgress(key, "some-other-hash", Date.now() - 1_000);

    const response = await send(
      app,
      post("/items", { "idempotency-key": "key-stale" }, { a: 1 }),
    );

    expect(response.status).toBe(201);
    expect(counters.executed).toBe(1);
  });

  it("rejects keys longer than 128 characters", async () => {
    const { app } = createTestApp();

    const response = await send(
      app,
      post("/items", { "idempotency-key": "k".repeat(129) }, { a: 1 }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errors: [
        {
          field: "Idempotency-Key",
          message: "Idempotency-Key header is too long",
        },
      ],
    });
  });
});

describe("idempotent middleware failure semantics", () => {
  it("does not cache error responses", async () => {
    const { app, counters } = createTestApp();

    const first = await send(
      app,
      post("/failing", { "idempotency-key": "key-failing" }, { a: 1 }),
    );

    expect(first.status).toBe(409);

    const second = await send(
      app,
      post("/failing", { "idempotency-key": "key-failing" }, { a: 1 }),
    );

    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBeNull();
    expect(counters.executed).toBe(2);
  });

  it("fails safe for oversized replay records", async () => {
    const { app, counters } = createTestApp();

    const first = await send(
      app,
      post("/large", { "idempotency-key": "key-large" }, { a: 1 }),
    );
    const second = await send(
      app,
      post("/large", { "idempotency-key": "key-large" }, { a: 1 }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBeNull();
    expect(counters.executed).toBe(2);
  });
});

describe("idempotent middleware invariants", () => {
  it("rejects non-write routes", async () => {
    const { app } = createTestApp();

    const response = await send(app, new Request("https://example.com/read"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL",
      detail: "Idempotency is only supported for write endpoints",
    });
  });

  it("requires an authenticated principal", async () => {
    const { app, counters } = createTestApp({ withPrincipal: false });

    const response = await send(
      app,
      post("/items", { "idempotency-key": "key-no-principal" }, { a: 1 }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL",
      detail: "Idempotency requires an authenticated principal",
    });
    expect(counters.executed).toBe(0);
  });
});

describe("idempotency records maintenance", () => {
  it("has the migrated table available", async () => {
    const db = createDb(env.DB);
    const row = await db.get<{ name: string }>(sql`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'idempotency_records'
    `);

    expect(row).toEqual({ name: "idempotency_records" });
  });

  it("sweeps expired records only", async () => {
    const db = createDb(env.DB);
    const now = 1_000_000;

    await db.run(sql`
      INSERT OR REPLACE INTO idempotency_records (key, record, expires_at)
      VALUES ('sweep-a', '{}', ${now - 1}), ('sweep-b', '{}', ${now + 60_000})
    `);

    await deleteExpiredIdempotencyRecords(db, { nowMs: now, limit: 50 });

    const remaining = await db.get<{ total: number }>(sql`
      SELECT COUNT(*) AS total FROM idempotency_records WHERE key IN ('sweep-a', 'sweep-b')
    `);

    expect(remaining).toEqual({ total: 1 });
  });
});
