import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanAuthTables,
  TEST_TOKEN_INSTANT,
} from "../../../test/auth-fixtures";
import { createDb } from "../../platform/db/db";
import { sessions, users } from "../../platform/db/schema";
import { upsertSessionPushToken } from "./push-token.repository";
import { revokeSessionAndTokens } from "./repository";

const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);
const TOKEN_TABLE = "tok-1";

function db() {
  return createDb(env.DB);
}

type SeedSessionOptions = Readonly<{
  pushPlatform?: "ANDROID" | "IOS" | "WEB";
  pushToken?: string;
  pushTokenUpdatedAt?: Date;
  pushTokenRevokedAt?: Date;
}>;

async function seedLiveSession(
  push: SeedSessionOptions = {},
): Promise<{ userId: string; sessionId: string }> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  await db()
    .insert(users)
    .values({
      id: userId,
      email: `push-repo-${userId}@example.com`,
      emailVerifiedAt: SEED_NOW,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  await db()
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      lastSeenAt: SEED_NOW,
      expiresAt: new Date(TEST_TOKEN_INSTANT.getTime() + 86_400_000),
      pushPlatform: push.pushPlatform ?? null,
      pushToken: push.pushToken ?? null,
      pushTokenUpdatedAt:
        push.pushTokenUpdatedAt ??
        (push.pushToken === undefined ? null : SEED_NOW),
      pushTokenRevokedAt: push.pushTokenRevokedAt ?? null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

  return { userId, sessionId };
}

async function sessionRow(sessionId: string) {
  const rows = await db()
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  const [row] = rows;
  if (row === undefined) throw new Error("expected a session row");

  return row;
}

describe("push fields on session lifecycle paths", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("session revocation clears the push fields", async () => {
    const { sessionId } = await seedLiveSession({
      pushPlatform: "ANDROID",
      pushToken: TOKEN_TABLE,
      pushTokenUpdatedAt: SEED_NOW,
    });

    await revokeSessionAndTokens(db(), sessionId, TEST_TOKEN_INSTANT);

    const row = await sessionRow(sessionId);
    expect(row.pushToken).toBeNull();
    expect(row.pushPlatform).toBeNull();
    expect(row.pushTokenRevokedAt?.getTime()).toBe(
      TEST_TOKEN_INSTANT.getTime(),
    );
  });

  it("upsert outcomes distinguish missing sessions", async () => {
    const { userId } = await seedLiveSession();

    const outcome = await upsertSessionPushToken(db(), {
      userId,
      sessionId: crypto.randomUUID(),
      platform: "ANDROID",
      token: TOKEN_TABLE,
      now: TEST_TOKEN_INSTANT,
    });

    expect(outcome).toBe("session_not_found");
  });
});
