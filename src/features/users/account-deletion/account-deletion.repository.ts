import { and, asc, eq, isNull, lte, ne } from "drizzle-orm";

import type { Database } from "../../../platform/db/db";
import { runBatch } from "../../../platform/db/db";
import {
  emailVerificationTokens,
  oidcIdentities,
  sessions,
  storedFiles,
  userAccountDeletionAudits,
  users,
  userStatusChangeAudits,
} from "../../../platform/db/schema";

export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;
export const ACCOUNT_DELETION_SCRUBBED_EMAIL_DOMAIN = "example.invalid";

export function accountDeletionScheduledFor(now: Date): Date {
  return new Date(
    now.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function scrubbedEmail(userId: string): string {
  return `deleted+${userId}@${ACCOUNT_DELETION_SCRUBBED_EMAIL_DOMAIN}`;
}

type AuditAction = typeof userAccountDeletionAudits.$inferInsert.action;

type DeletionAuditInput = Readonly<{
  actorUserId: string;
  actorSessionId: string | undefined;
  targetUserId: string;
  action: AuditAction;
  traceId: string | undefined;
  now: Date;
}>;

function deletionAuditValues(
  input: DeletionAuditInput,
): typeof userAccountDeletionAudits.$inferInsert {
  return {
    id: crypto.randomUUID(),
    actorUserId: input.actorUserId,
    actorSessionId: input.actorSessionId ?? null,
    targetUserId: input.targetUserId,
    action: input.action,
    traceId: input.traceId ?? null,
    createdAt: input.now,
  };
}

function deletionAuditStatement(db: Database, input: DeletionAuditInput) {
  return db
    .insert(userAccountDeletionAudits)
    .values(deletionAuditValues(input));
}

async function insertDeletionAudit(
  db: Database,
  input: DeletionAuditInput,
): Promise<void> {
  await deletionAuditStatement(db, input);
}

type DeletionColumnValues = Readonly<{
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  deletionRequestedSessionId: string | null;
  deletionRequestedTraceId: string | null;
}>;

function applyDeletionColumns(
  db: Database,
  userId: string,
  columns: DeletionColumnValues,
  now: Date,
) {
  return db
    .update(users)
    .set({ ...columns, updatedAt: now })
    .where(eq(users.id, userId));
}

async function countActiveAdmins(db: Database): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.status, "ACTIVE")));

  return rows.length;
}

async function findOpenStoredFileIds(
  db: Database,
  userId: string,
): Promise<readonly string[]> {
  const rows = await db
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.ownerUserId, userId),
        ne(storedFiles.status, "DELETED"),
      ),
    );

  return rows.map((row) => row.id);
}

async function findLiveUser(
  db: Database,
  userId: string,
): Promise<typeof users.$inferSelect | undefined> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();

  if (user === undefined || user.status === "DELETED") return undefined;

  return user;
}

export type RequestAccountDeletionResult =
  | Readonly<{ kind: "ok"; scheduledFor: Date }>
  | Readonly<{ kind: "already_requested"; scheduledFor: Date }>
  | Readonly<{ kind: "last_admin" }>
  | Readonly<{ kind: "not_found" }>;

export async function requestAccountDeletion(
  db: Database,
  input: Readonly<{
    userId: string;
    sessionId: string;
    traceId: string | undefined;
    now: Date;
  }>,
): Promise<RequestAccountDeletionResult> {
  const user = await findLiveUser(db, input.userId);

  if (user === undefined) return { kind: "not_found" };

  if (
    user.role === "ADMIN" &&
    user.status === "ACTIVE" &&
    user.deletionScheduledFor === null
  ) {
    if ((await countActiveAdmins(db)) <= 1) return { kind: "last_admin" };
  }

  if (user.deletionScheduledFor !== null) {
    return {
      kind: "already_requested",
      scheduledFor: user.deletionScheduledFor,
    };
  }

  const scheduledFor = accountDeletionScheduledFor(input.now);

  await runBatch(db, [
    applyDeletionColumns(
      db,
      input.userId,
      {
        deletionRequestedAt: input.now,
        deletionScheduledFor: scheduledFor,
        deletionRequestedSessionId: input.sessionId,
        deletionRequestedTraceId: input.traceId ?? null,
      },
      input.now,
    ),
    deletionAuditStatement(db, {
      actorUserId: input.userId,
      actorSessionId: input.sessionId,
      targetUserId: input.userId,
      action: "REQUESTED",
      traceId: input.traceId,
      now: input.now,
    }),
  ]);

  return { kind: "ok", scheduledFor };
}

export type CancelAccountDeletionResult =
  | Readonly<{ kind: "ok" }>
  | Readonly<{ kind: "not_requested" }>
  | Readonly<{ kind: "not_found" }>;

export async function cancelAccountDeletion(
  db: Database,
  input: Readonly<{
    userId: string;
    sessionId: string;
    traceId: string | undefined;
    now: Date;
  }>,
): Promise<CancelAccountDeletionResult> {
  const user = await findLiveUser(db, input.userId);

  if (user === undefined) return { kind: "not_found" };
  if (user.deletionScheduledFor === null) return { kind: "not_requested" };

  await runBatch(db, [
    applyDeletionColumns(
      db,
      input.userId,
      {
        deletionRequestedAt: null,
        deletionScheduledFor: null,
        deletionRequestedSessionId: null,
        deletionRequestedTraceId: null,
      },
      input.now,
    ),
    deletionAuditStatement(db, {
      actorUserId: input.userId,
      actorSessionId: input.sessionId,
      targetUserId: input.userId,
      action: "CANCELED",
      traceId: input.traceId,
      now: input.now,
    }),
  ]);

  return { kind: "ok" };
}

export type FinalizeAccountDeletionResult =
  | Readonly<{
      kind: "finalized";
      deletedAt: Date;
      clearedFileIds: readonly string[];
    }>
  | Readonly<{ kind: "blocked_last_admin" }>
  | Readonly<{ kind: "not_due"; scheduledFor: Date }>
  | Readonly<{
      kind: "skipped";
      reason: "user_not_found" | "already_deleted" | "not_scheduled";
    }>;

type FinalizeGuard =
  | Readonly<{ kind: "proceed"; user: typeof users.$inferSelect }>
  | Readonly<{ kind: "early"; result: FinalizeAccountDeletionResult }>;

async function guardFinalize(
  db: Database,
  input: Readonly<{ userId: string; now: Date }>,
): Promise<FinalizeGuard> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .get();

  if (user === undefined) {
    return {
      kind: "early",
      result: { kind: "skipped", reason: "user_not_found" },
    };
  }
  if (user.status === "DELETED" || user.deletedAt !== null) {
    return {
      kind: "early",
      result: { kind: "skipped", reason: "already_deleted" },
    };
  }
  if (user.deletionScheduledFor === null) {
    return {
      kind: "early",
      result: { kind: "skipped", reason: "not_scheduled" },
    };
  }
  if (user.deletionScheduledFor.getTime() > input.now.getTime()) {
    return {
      kind: "early",
      result: { kind: "not_due", scheduledFor: user.deletionScheduledFor },
    };
  }

  if (user.role === "ADMIN" && user.status === "ACTIVE") {
    if ((await countActiveAdmins(db)) <= 1) {
      await insertDeletionAudit(db, {
        actorUserId: user.id,
        actorSessionId: user.deletionRequestedSessionId ?? undefined,
        targetUserId: user.id,
        action: "FINALIZE_BLOCKED_LAST_ADMIN",
        traceId: user.deletionRequestedTraceId ?? undefined,
        now: input.now,
      });

      return { kind: "early", result: { kind: "blocked_last_admin" } };
    }
  }

  return { kind: "proceed", user };
}

export async function finalizeAccountDeletion(
  db: Database,
  input: Readonly<{
    userId: string;
    now: Date;
    traceId: string | undefined;
  }>,
): Promise<FinalizeAccountDeletionResult> {
  const guard = await guardFinalize(db, input);

  if (guard.kind === "early") return guard.result;

  const { user } = guard;
  const traceId = user.deletionRequestedTraceId ?? input.traceId;
  const actorSessionId = user.deletionRequestedSessionId;
  const clearedFileIds = await findOpenStoredFileIds(db, user.id);

  await runBatch(db, [
    db
      .update(users)
      .set({
        email: scrubbedEmail(user.id),
        emailVerifiedAt: null,
        role: "USER",
        status: "DELETED",
        deletedAt: input.now,
        deletionRequestedAt: null,
        deletionScheduledFor: null,
        deletionRequestedSessionId: null,
        deletionRequestedTraceId: null,
        suspendedAt: null,
        suspendedReason: null,
        displayName: null,
        givenName: null,
        familyName: null,
        profileImageFileId: null,
        updatedAt: input.now,
      })
      .where(eq(users.id, user.id)),
    db
      .update(storedFiles)
      .set({ status: "DELETED", deletedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(storedFiles.ownerUserId, user.id),
          ne(storedFiles.status, "DELETED"),
        ),
      ),
    db.delete(oidcIdentities).where(eq(oidcIdentities.userId, user.id)),
    db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, user.id)),
    db.delete(sessions).where(eq(sessions.userId, user.id)),
    db.insert(userStatusChangeAudits).values({
      id: crypto.randomUUID(),
      actorUserId: user.id,
      actorSessionId: actorSessionId ?? null,
      targetUserId: user.id,
      oldStatus: user.status,
      newStatus: "DELETED",
      reason: null,
      traceId: traceId ?? null,
      createdAt: input.now,
    }),
    db.insert(userAccountDeletionAudits).values(
      deletionAuditValues({
        actorUserId: user.id,
        actorSessionId: actorSessionId ?? undefined,
        targetUserId: user.id,
        action: "FINALIZED",
        traceId: traceId ?? undefined,
        now: input.now,
      }),
    ),
  ]);

  return { kind: "finalized", deletedAt: input.now, clearedFileIds };
}

export async function findDueAccountDeletions(
  db: Database,
  input: Readonly<{ now: Date; limit: number }>,
): Promise<readonly string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        ne(users.status, "DELETED"),
        isNull(users.deletedAt),
        lte(users.deletionScheduledFor, input.now),
      ),
    )
    .orderBy(asc(users.deletionScheduledFor))
    .limit(input.limit);

  return rows.map((row) => row.id);
}
