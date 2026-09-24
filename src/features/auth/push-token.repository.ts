import { and, eq, exists, gt, isNull, ne } from "drizzle-orm";

import type { Database } from "../../platform/db/db";
import { runBatch } from "../../platform/db/db";
import { sessions } from "../../platform/db/schema";
import { readChangeCount } from "./repository";

export type UpsertSessionPushTokenInput = Readonly<{
  userId: string;
  sessionId: string;
  platform: typeof sessions.$inferInsert.pushPlatform;
  token: string;
  now: Date;
}>;

export type UpsertSessionPushTokenOutcome = "ok" | "session_not_found";

export async function upsertSessionPushToken(
  db: Database,
  input: UpsertSessionPushTokenInput,
): Promise<UpsertSessionPushTokenOutcome> {
  const sessionIsLive = exists(
    db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.userId, input.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, input.now),
        ),
      ),
  );

  const results = await runBatch(db, [
    db
      .update(sessions)
      .set({
        pushPlatform: null,
        pushToken: null,
        pushTokenUpdatedAt: input.now,
        pushTokenRevokedAt: input.now,
      })
      .where(
        and(
          eq(sessions.pushToken, input.token),
          ne(sessions.id, input.sessionId),
          sessionIsLive,
        ),
      ),
    db
      .update(sessions)
      .set({
        pushPlatform: input.platform,
        pushToken: input.token,
        pushTokenUpdatedAt: input.now,
        pushTokenRevokedAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.userId, input.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, input.now),
        ),
      ),
  ]);

  return readChangeCount(results[1]) === 1 ? "ok" : "session_not_found";
}

export async function revokeSessionPushToken(
  db: Database,
  input: Readonly<{ userId: string; sessionId: string; now: Date }>,
): Promise<void> {
  await db
    .update(sessions)
    .set({
      pushPlatform: null,
      pushToken: null,
      pushTokenUpdatedAt: input.now,
      pushTokenRevokedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)),
    );
}
