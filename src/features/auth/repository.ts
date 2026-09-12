import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../../platform/db/db";
import { runBatch } from "../../platform/db/db";
import {
  oidcIdentities,
  refreshTokens,
  sessions,
  users,
} from "../../platform/db/schema";

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
        .set({ revokedAt: now, activeKey: null, updatedAt: now })
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
