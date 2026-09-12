import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Database } from "./db";
import { oidcIdentities, refreshTokens, sessions, users } from "./schema";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const LATER = new Date("2026-02-01T00:00:00.000Z");

function userValues(email: string): typeof users.$inferInsert {
  return {
    id: crypto.randomUUID(),
    email,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function cleanAuthTables(db: Database): Promise<void> {
  await db.delete(refreshTokens);
  await db.delete(sessions);
  await db.delete(oidcIdentities);
  await db.delete(users);
}

async function seedUserWithSession(
  db: Database,
): Promise<{ userId: string; sessionId: string }> {
  const user = userValues(`seed-${crypto.randomUUID()}@example.com`);

  await db.insert(users).values(user);

  const session = {
    id: crypto.randomUUID(),
    userId: user.id,
    lastSeenAt: NOW,
    expiresAt: LATER,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await db.insert(sessions).values(session);

  return { userId: user.id, sessionId: session.id };
}

describe("auth schema constraints: uniqueness", () => {
  beforeEach(async () => {
    await cleanAuthTables(createDb(env.DB));
  });

  it("rejects duplicate user emails", async () => {
    const db = createDb(env.DB);
    const email = `dup-${crypto.randomUUID()}@example.com`;

    await db.insert(users).values(userValues(email));

    await expect(db.insert(users).values(userValues(email))).rejects.toThrow();
    await expect(db.$count(users)).resolves.toBe(1);
  });

  it("rejects duplicate provider subjects and duplicate user providers", async () => {
    const db = createDb(env.DB);
    const first = userValues(`first-${crypto.randomUUID()}@example.com`);
    const second = userValues(`second-${crypto.randomUUID()}@example.com`);

    await db.insert(users).values([first, second]);
    await db.insert(oidcIdentities).values({
      id: crypto.randomUUID(),
      userId: first.id,
      provider: "GOOGLE",
      subject: "subject-1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(
      db.insert(oidcIdentities).values({
        id: crypto.randomUUID(),
        userId: second.id,
        provider: "GOOGLE",
        subject: "subject-1",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(oidcIdentities).values({
        id: crypto.randomUUID(),
        userId: first.id,
        provider: "GOOGLE",
        subject: "subject-2",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).rejects.toThrow();

    await expect(db.$count(oidcIdentities)).resolves.toBe(1);
  });
});

describe("auth schema constraints: keys and tokens", () => {
  beforeEach(async () => {
    await cleanAuthTables(createDb(env.DB));
  });

  it("enforces one active session per device key but allows null keys", async () => {
    const db = createDb(env.DB);
    const user = userValues(`device-${crypto.randomUUID()}@example.com`);

    await db.insert(users).values(user);

    const activeKey = `${user.id}:device-a`;

    await db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId: user.id,
      activeKey,
      lastSeenAt: NOW,
      expiresAt: LATER,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(
      db.insert(sessions).values({
        id: crypto.randomUUID(),
        userId: user.id,
        activeKey,
        lastSeenAt: NOW,
        expiresAt: LATER,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).rejects.toThrow();

    await db.insert(sessions).values([
      {
        id: crypto.randomUUID(),
        userId: user.id,
        lastSeenAt: NOW,
        expiresAt: LATER,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: crypto.randomUUID(),
        userId: user.id,
        lastSeenAt: NOW,
        expiresAt: LATER,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    await expect(db.$count(sessions)).resolves.toBe(3);
  });

  it("rejects duplicate refresh token hashes", async () => {
    const db = createDb(env.DB);
    const { sessionId } = await seedUserWithSession(db);
    const tokenHash = `hash-${crypto.randomUUID()}`;

    const values = {
      id: crypto.randomUUID(),
      sessionId,
      tokenHash,
      expiresAt: LATER,
      createdAt: NOW,
      updatedAt: NOW,
    };

    await db.insert(refreshTokens).values(values);

    await expect(
      db.insert(refreshTokens).values({ ...values, id: crypto.randomUUID() }),
    ).rejects.toThrow();

    await expect(db.$count(refreshTokens)).resolves.toBe(1);
  });
});

describe("auth schema constraints: cascades", () => {
  beforeEach(async () => {
    await cleanAuthTables(createDb(env.DB));
  });

  it("cascades user deletion across sessions, tokens, and identities", async () => {
    const db = createDb(env.DB);
    const { userId, sessionId } = await seedUserWithSession(db);

    await db.insert(oidcIdentities).values({
      id: crypto.randomUUID(),
      userId,
      provider: "GOOGLE",
      subject: "cascade-subject",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(refreshTokens).values({
      id: crypto.randomUUID(),
      sessionId,
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: LATER,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await db.delete(users);

    await expect(db.$count(users)).resolves.toBe(0);
    await expect(db.$count(sessions)).resolves.toBe(0);
    await expect(db.$count(refreshTokens)).resolves.toBe(0);
    await expect(db.$count(oidcIdentities)).resolves.toBe(0);
  });
});
