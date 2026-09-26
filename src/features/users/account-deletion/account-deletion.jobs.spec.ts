import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanAuthTables,
  TEST_TOKEN_INSTANT,
} from "../../../../test/auth-fixtures";
import {
  capturingLogger,
  fakeQueue,
  type LogLine,
} from "../../../../test/queue-fixtures";
import { fixedClock } from "../../../platform/clock/clock";
import { createDb } from "../../../platform/db/db";
import {
  emailVerificationTokens,
  oidcIdentities,
  sessions,
  storedFiles,
  userAccountDeletionAudits,
  users,
  userStatusChangeAudits,
} from "../../../platform/db/schema";
import { scrubbedEmail } from "./account-deletion.repository";
import { createAccountDeletionJobs } from "./account-deletion.jobs";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);
const DUE = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);
const FUTURE = new Date(TEST_TOKEN_INSTANT.getTime() + 86_400_000);
const CONTEXT = {
  jobId: "users.finalizeAccountDeletion-1",
  traceId: "job:trace-1",
  attempt: 1,
  enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
};

function db() {
  return createDb(env.DB);
}

function jobs() {
  const lines: LogLine[] = [];

  return {
    lines,
    jobs: createAccountDeletionJobs({
      db: db(),
      clock: CLOCK,
      logger: capturingLogger(lines),
      queue: fakeQueue().queue,
    }),
  };
}

async function seedDueUser(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();

  await db()
    .insert(users)
    .values({
      id,
      email: `due-${id}@example.com`,
      emailVerifiedAt: SEED_NOW,
      role: "USER",
      status: "ACTIVE",
      deletionRequestedAt: SEED_NOW,
      deletionScheduledFor: DUE,
      deletionRequestedSessionId: "session-1",
      deletionRequestedTraceId: "req-trace-1",
      displayName: "Dante",
      givenName: "Given",
      familyName: "Family",
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
      ...overrides,
    });

  return id;
}

async function seedStoredFile(userId: string): Promise<string> {
  const id = crypto.randomUUID();

  await db()
    .insert(storedFiles)
    .values({
      id,
      ownerUserId: userId,
      purpose: "PROFILE_IMAGE",
      status: "ACTIVE",
      bucket: "cf-core-kit-dev",
      objectKey: `users/${userId}/profile-images/${id}`,
      contentType: "image/webp",
      sizeBytes: 4,
      uploadedAt: SEED_NOW,
      deletedAt: null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  await db()
    .update(users)
    .set({ profileImageFileId: id, updatedAt: SEED_NOW })
    .where(eq(users.id, userId));

  return id;
}

async function seedAuthState(userId: string): Promise<void> {
  await db()
    .insert(oidcIdentities)
    .values({
      id: crypto.randomUUID(),
      userId,
      provider: "GOOGLE",
      subject: `subject-${userId}`,
      email: null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  await db().insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    lastSeenAt: SEED_NOW,
    expiresAt: FUTURE,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  await db()
    .insert(emailVerificationTokens)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash: `hash-${userId}`,
      expiresAt: FUTURE,
      usedAt: null,
      revokedAt: null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
}

async function userRow(userId: string) {
  const rows = await db().select().from(users).where(eq(users.id, userId));
  const [row] = rows;
  if (row === undefined) throw new Error("expected a user row");

  return row;
}

async function assertScrubbed(userId: string): Promise<void> {
  const row = await userRow(userId);
  const deletedAt = row.deletedAt;
  const scrubbed = {
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    role: row.role,
    status: row.status,
    deletedAt: deletedAt === null ? null : deletedAt.getTime(),
    deletionRequestedAt: row.deletionRequestedAt,
    deletionScheduledFor: row.deletionScheduledFor,
    deletionRequestedSessionId: row.deletionRequestedSessionId,
    deletionRequestedTraceId: row.deletionRequestedTraceId,
    displayName: row.displayName,
    givenName: row.givenName,
    familyName: row.familyName,
  };

  expect(scrubbed).toEqual({
    email: scrubbedEmail(userId),
    emailVerifiedAt: null,
    role: "USER",
    status: "DELETED",
    deletedAt: TEST_TOKEN_INSTANT.getTime(),
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    deletionRequestedSessionId: null,
    deletionRequestedTraceId: null,
    displayName: null,
    givenName: null,
    familyName: null,
  });
}

async function assertPurged(userId: string): Promise<void> {
  expect(
    await db()
      .select()
      .from(oidcIdentities)
      .where(eq(oidcIdentities.userId, userId)),
  ).toHaveLength(0);
  expect(
    await db().select().from(sessions).where(eq(sessions.userId, userId)),
  ).toHaveLength(0);
  expect(
    await db()
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId)),
  ).toHaveLength(0);
}

async function assertAudits(): Promise<void> {
  const deletionAudits = await db().select().from(userAccountDeletionAudits);
  expect(deletionAudits).toHaveLength(1);
  expect(deletionAudits[0]).toMatchObject({
    action: "FINALIZED",
    traceId: "req-trace-1",
    actorSessionId: "session-1",
  });

  const statusAudits = await db().select().from(userStatusChangeAudits);
  expect(statusAudits).toHaveLength(1);
  expect(statusAudits[0]).toMatchObject({
    oldStatus: "ACTIVE",
    newStatus: "DELETED",
    traceId: "req-trace-1",
  });
}

describe("users.finalizeAccountDeletion", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("scrubs the account, purges auth state, retires stored files, and writes both audits", async () => {
    const userId = await seedDueUser();
    await seedAuthState(userId);
    const fileId = await seedStoredFile(userId);
    const { queue, sent } = fakeQueue();
    const lines: LogLine[] = [];
    const handler = createAccountDeletionJobs({
      db: db(),
      clock: CLOCK,
      logger: capturingLogger(lines),
      queue,
    });

    await handler.finalizeAccountDeletion.handle(
      { userId, scheduledFor: DUE.toISOString() },
      CONTEXT,
    );

    await assertScrubbed(userId);
    await assertPurged(userId);
    await assertAudits();

    const fileRows = await db()
      .select()
      .from(storedFiles)
      .where(eq(storedFiles.id, fileId));
    expect(fileRows[0]?.status).toBe("DELETED");
    expect(fileRows[0]?.deletedAt).toBeInstanceOf(Date);
    expect(sent).toHaveLength(1);
    const cleanupBody = sent[0]?.body as Record<string, unknown>;
    expect(cleanupBody.job).toBe("users.profileImage.deleteStoredFile");
    expect(cleanupBody.payload).toMatchObject({ fileId, ownerUserId: userId });
  });

  it("skips a second run and users without a due schedule", async () => {
    const userId = await seedDueUser();
    const future = await seedDueUser({ deletionScheduledFor: FUTURE });
    const none = await seedDueUser({ deletionScheduledFor: null });
    const { jobs: handlerJobs, lines } = jobs();

    for (const target of [userId, userId, future, none, crypto.randomUUID()]) {
      await handlerJobs.finalizeAccountDeletion.handle(
        { userId: target, scheduledFor: DUE.toISOString() },
        CONTEXT,
      );
    }

    const outcomes = lines
      .filter((line) => line.message === "account deletion finalized")
      .map((line) => {
        const outcome = line.fields.outcome;
        const reason = line.fields.reason;
        const outcomeText = typeof outcome === "string" ? outcome : "?";
        const reasonText = typeof reason === "string" ? reason : "";

        return `${outcomeText}:${reasonText}`;
      });
    expect(outcomes).toEqual([
      "finalized:",
      "skipped:already_deleted",
      "not_due:",
      "skipped:not_scheduled",
      "skipped:user_not_found",
    ]);
  });

  it("blocks the last active admin with an audit", async () => {
    const userId = await seedDueUser({ role: "ADMIN", status: "ACTIVE" });
    const { jobs: handlerJobs, lines } = jobs();

    await handlerJobs.finalizeAccountDeletion.handle(
      { userId, scheduledFor: DUE.toISOString() },
      CONTEXT,
    );

    const rows = await db().select().from(users).where(eq(users.id, userId));
    expect(rows[0]?.status).toBe("ACTIVE");
    expect(rows[0]?.email).not.toBe(scrubbedEmail(userId));
    expect(lines.at(-1)?.message).toBe("account deletion blocked");

    const deletionAudits = await db().select().from(userAccountDeletionAudits);
    expect(deletionAudits).toHaveLength(1);
    expect(deletionAudits[0]?.action).toBe("FINALIZE_BLOCKED_LAST_ADMIN");
  });
});

describe("users.finalizeDueAccountDeletions", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("enqueues one finalize job per due user with deterministic ids", async () => {
    const due = await seedDueUser();
    const { queue, sent } = fakeQueue();
    const lines: LogLine[] = [];
    const sweep = createAccountDeletionJobs({
      db: db(),
      clock: CLOCK,
      logger: capturingLogger(lines),
      queue,
    });

    await sweep.finalizeDueAccountDeletions.handle(
      { scheduledFor: DUE.toISOString() },
      CONTEXT,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({
      job: "users.finalizeAccountDeletion",
      jobId: `users.finalizeAccountDeletion-${due}`,
      payload: { userId: due },
    });
    expect(lines.at(-1)?.fields).toMatchObject({ due: 1, enqueued: 1 });
  });
});
