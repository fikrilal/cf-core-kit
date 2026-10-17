import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";

import type { Database } from "../../../platform/db/db";
import { runBatch } from "../../../platform/db/db";
import {
  emailVerificationTokens,
  oidcIdentities,
  refreshTokens,
  sessions,
  users,
} from "../../../platform/db/schema";

export type UserRow = typeof users.$inferSelect;
export type IdentityRow = typeof oidcIdentities.$inferSelect;

export async function findUserById(
  db: Database,
  id: string,
): Promise<UserRow | undefined> {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export async function findUserByEmail(
  db: Database,
  email: string,
): Promise<UserRow | undefined> {
  return db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();
}

export async function findIdentity(
  db: Database,
  provider: IdentityRow["provider"],
  subject: string,
): Promise<IdentityRow | undefined> {
  return db
    .select()
    .from(oidcIdentities)
    .where(
      and(
        eq(oidcIdentities.provider, provider),
        eq(oidcIdentities.subject, subject),
      ),
    )
    .get();
}

export async function findIdentityByUserProvider(
  db: Database,
  userId: string,
  provider: IdentityRow["provider"],
): Promise<IdentityRow | undefined> {
  return db
    .select()
    .from(oidcIdentities)
    .where(
      and(
        eq(oidcIdentities.userId, userId),
        eq(oidcIdentities.provider, provider),
      ),
    )
    .get();
}

export async function insertIdentity(
  db: Database,
  values: typeof oidcIdentities.$inferInsert,
): Promise<void> {
  await db.insert(oidcIdentities).values(values);
}

export async function markEmailVerified(
  db: Database,
  userId: string,
  at: Date,
): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: at, updatedAt: at })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

export type CreateSessionInput = Readonly<{
  session: typeof sessions.$inferInsert;
  token: typeof refreshTokens.$inferInsert;
  revokeActiveKey: string | undefined;
}>;

export async function createSessionWithToken(
  db: Database,
  input: CreateSessionInput,
): Promise<void> {
  const now = new Date(input.session.createdAt);

  if (input.revokeActiveKey !== undefined) {
    await runBatch(db, [
      db
        .update(sessions)
        .set({
          revokedAt: now,
          activeKey: null,
          pushPlatform: null,
          pushToken: null,
          pushTokenUpdatedAt: now,
          pushTokenRevokedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(sessions.activeKey, input.revokeActiveKey),
            isNull(sessions.revokedAt),
          ),
        ),
      db.insert(sessions).values(input.session),
      db.insert(refreshTokens).values(input.token),
    ]);

    return;
  }

  await runBatch(db, [
    db.insert(sessions).values(input.session),
    db.insert(refreshTokens).values(input.token),
  ]);
}

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readChangeCount(result: unknown): number {
  if (!isRecordValue(result)) return 0;

  const meta = result.meta;
  if (!isRecordValue(meta)) return 0;

  return typeof meta.changes === "number" ? meta.changes : 0;
}

export async function findRefreshTokenByHash(
  db: Database,
  tokenHash: string,
): Promise<RefreshTokenRow | undefined> {
  return db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .get();
}

export async function findSessionById(
  db: Database,
  id: string,
): Promise<SessionRow | undefined> {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

export type RotateRefreshTokenInput = Readonly<{
  currentTokenId: string;
  replacement: typeof refreshTokens.$inferInsert;
  sessionId: string;
  now: Date;
  ip: string | undefined;
  userAgent: string | undefined;
}>;

export async function rotateRefreshToken(
  db: Database,
  input: RotateRefreshTokenInput,
): Promise<"rotated" | "lost"> {
  const sessionUpdate: Partial<typeof sessions.$inferInsert> = {
    lastSeenAt: input.now,
    updatedAt: input.now,
  };
  if (input.ip !== undefined) sessionUpdate.ip = input.ip;
  if (input.userAgent !== undefined) sessionUpdate.userAgent = input.userAgent;

  // "lost" may already have inserted the replacement. The caller must revoke.
  const results = await runBatch(db, [
    db
      .update(refreshTokens)
      .set({
        revokedAt: input.now,
        replacedById: input.replacement.id,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(refreshTokens.id, input.currentTokenId),
          isNull(refreshTokens.revokedAt),
          isNull(refreshTokens.replacedById),
        ),
      ),
    db.insert(refreshTokens).values(input.replacement),
    db
      .update(sessions)
      .set(sessionUpdate)
      .where(eq(sessions.id, input.sessionId)),
  ]);

  return readChangeCount(results[0]) === 1 ? "rotated" : "lost";
}

export async function revokeSessionAndTokens(
  db: Database,
  sessionId: string,
  now: Date,
): Promise<void> {
  await runBatch(db, [
    db
      .update(refreshTokens)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(refreshTokens.sessionId, sessionId),
          isNull(refreshTokens.revokedAt),
        ),
      ),
    db
      .update(sessions)
      .set({
        revokedAt: now,
        activeKey: null,
        pushPlatform: null,
        pushToken: null,
        pushTokenUpdatedAt: now,
        pushTokenRevokedAt: now,
        updatedAt: now,
      })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt))),
  ]);
}

export async function purgeExpiredSessions(
  db: Database,
  input: Readonly<{ now: Date; limit: number }>,
): Promise<number> {
  const doomed = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lte(sessions.expiresAt, input.now))
    .orderBy(asc(sessions.expiresAt))
    .limit(input.limit);

  const deleted = await db
    .delete(sessions)
    .where(inArray(sessions.id, doomed))
    .returning({ id: sessions.id });

  return deleted.length;
}

export type VerifyEmailOutcome =
  "ok" | "already_verified" | "token_invalid" | "token_expired";

async function markEmailVerificationTokenUsed(
  db: Database,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: now, updatedAt: now })
    .where(
      and(
        eq(emailVerificationTokens.id, id),
        isNull(emailVerificationTokens.usedAt),
      ),
    );
}

export async function consumeEmailVerificationToken(
  db: Database,
  input: Readonly<{ tokenHash: string; now: Date }>,
): Promise<VerifyEmailOutcome> {
  const token = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, input.tokenHash))
    .get();
  if (token === undefined) return "token_invalid";

  const user = await findUserById(db, token.userId);
  if (user === undefined) return "token_invalid";

  if (user.emailVerifiedAt !== null) {
    await markEmailVerificationTokenUsed(db, token.id, input.now);

    return "already_verified";
  }
  if (token.revokedAt !== null || token.usedAt !== null) return "token_invalid";
  if (token.expiresAt.getTime() <= input.now.getTime()) return "token_expired";

  const results = await runBatch(db, [
    db
      .update(users)
      .set({ emailVerifiedAt: input.now, updatedAt: input.now })
      .where(and(eq(users.id, token.userId), isNull(users.emailVerifiedAt))),
    db
      .update(emailVerificationTokens)
      .set({ usedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(emailVerificationTokens.id, token.id),
          isNull(emailVerificationTokens.usedAt),
        ),
      ),
  ]);

  return readChangeCount(results[0]) === 1 ? "ok" : "already_verified";
}
