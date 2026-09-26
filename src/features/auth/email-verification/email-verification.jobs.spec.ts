import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { capturingLogger, type LogLine } from "../../../../test/queue-fixtures";
import { fixedClock } from "../../../platform/clock/clock";
import { parseConfig, type AppConfig } from "../../../platform/config/config";
import { sha256Base64Url } from "../../../platform/crypto/crypto";
import { createDb } from "../../../platform/db/db";
import { emailVerificationTokens, users } from "../../../platform/db/schema";
import {
  disabledEmailPort,
  type EmailPort,
} from "../../../platform/email/email";
import { createSendVerificationEmailJob } from "./email-verification.jobs";

const INSTANT = new Date("2026-06-01T00:00:00.000Z");
const CLOCK = fixedClock(INSTANT);
const CONTEXT = {
  jobId: "auth.sendVerificationEmail-1",
  traceId: "trace-1",
  attempt: 1,
  enqueuedAt: INSTANT.toISOString(),
};
const USER_EMAIL = "verify-jobs@example.com";
const EXPIRES_AT = new Date(INSTANT.getTime() + 3_600_000);

function db() {
  return createDb(env.DB);
}

function config(overrides: Record<string, string> = {}): AppConfig {
  return parseConfig({
    AUTH_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS: "3600",
    PUBLIC_APP_URL: "https://app.example",
    ...overrides,
  });
}

type SentEmail = Readonly<{
  to: string;
  subject: string;
  text: string;
  html?: string;
}>;

function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error("expected at least one item");

  return item;
}

function stubEmailPort(): Readonly<{ port: EmailPort; sent: SentEmail[] }> {
  const sent: SentEmail[] = [];

  return {
    sent,
    port: {
      isEnabled: () => true,
      send: (input) => {
        sent.push(input);

        return Promise.resolve({ id: `email-${String(sent.length)}` });
      },
    },
  };
}

function runJob(
  email: EmailPort,
  lines: LogLine[],
  overrides: Record<string, string> = {},
) {
  return createSendVerificationEmailJob({
    db: db(),
    clock: CLOCK,
    email,
    config: config(overrides),
    logger: capturingLogger(lines),
  });
}

async function seedUser(
  emailVerifiedAt: Date | null,
  status?: "ACTIVE" | "DELETED",
): Promise<string> {
  const id = crypto.randomUUID();

  await db()
    .insert(users)
    .values({
      id,
      email: USER_EMAIL,
      emailVerifiedAt,
      ...(status === undefined ? {} : { status }),
      createdAt: INSTANT,
      updatedAt: INSTANT,
    });

  return id;
}

async function tokenRows(userId: string) {
  return db()
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, userId));
}

describe("auth.sendVerificationEmail job", () => {
  beforeEach(async () => {
    await db().delete(emailVerificationTokens);
    await db().delete(users);
  });

  it("stores only the hashed token with the configured TTL", async () => {
    const userId = await seedUser(null);
    const { port, sent } = stubEmailPort();
    const job = runJob(port, []);

    await job.handle({ userId, requestedAt: INSTANT.toISOString() }, CONTEXT);

    const message = first(sent);
    const rawToken = message.text.split("\n")[2] ?? "";
    expect(rawToken.length).toBeGreaterThan(0);

    const row = first(await tokenRows(userId));
    expect(row.tokenHash).toBe(await sha256Base64Url(rawToken));
    expect(row.tokenHash).not.toBe(rawToken);
    expect(message.text).not.toContain(row.tokenHash);
    expect(row.usedAt).toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBe(EXPIRES_AT.getTime());
  });

  it("emails the raw token with the verify link and expiry", async () => {
    const userId = await seedUser(null);
    const { port, sent } = stubEmailPort();
    const lines: LogLine[] = [];
    const job = runJob(port, lines);

    await job.handle({ userId, requestedAt: INSTANT.toISOString() }, CONTEXT);

    const message = first(sent);
    expect(message.subject).toBe("Verify your email");
    expect(message.to).toBe(USER_EMAIL);
    const rawToken = message.text.split("\n")[2] ?? "";
    const linkLine = message.text
      .split("\n")
      .find((line) => line.startsWith("http"));
    const link = new URL(linkLine ?? "");
    expect(link.origin).toBe("https://app.example");
    expect(link.pathname).toBe("/verify-email");
    expect(link.searchParams.get("token")).toBe(rawToken);
    expect(message.text).toContain(
      `This token expires at ${EXPIRES_AT.toISOString()}.`,
    );
    expect(message.html).toContain(rawToken);

    expect(
      first(lines.filter((line) => line.message === "verification email sent"))
        .fields,
    ).toMatchObject({
      jobId: CONTEXT.jobId,
      traceId: CONTEXT.traceId,
      userId,
      emailId: "email-1",
      tokenExpiresAt: EXPIRES_AT.toISOString(),
    });
  });
});

describe("auth.sendVerificationEmail skips", () => {
  beforeEach(async () => {
    await db().delete(emailVerificationTokens);
    await db().delete(users);
  });

  it("skips unknown users and deleted users without sending or minting", async () => {
    const deletedUserId = await seedUser(null, "DELETED");
    const { port, sent } = stubEmailPort();
    const lines: LogLine[] = [];
    const job = runJob(port, lines);

    await job.handle(
      { userId: crypto.randomUUID(), requestedAt: INSTANT.toISOString() },
      CONTEXT,
    );
    await job.handle(
      { userId: deletedUserId, requestedAt: INSTANT.toISOString() },
      CONTEXT,
    );

    expect(sent).toHaveLength(0);
    expect(await tokenRows(deletedUserId)).toHaveLength(0);
    const skips = lines.filter(
      (line) => line.message === "verification email skipped",
    );
    expect(skips.map((line) => line.fields.reason)).toEqual([
      "user_not_found",
      "already_deleted",
    ]);
  });

  it("skips verified users without sending or minting", async () => {
    const userId = await seedUser(INSTANT);
    const { port, sent } = stubEmailPort();
    const lines: LogLine[] = [];
    const job = runJob(port, lines);

    await job.handle({ userId, requestedAt: INSTANT.toISOString() }, CONTEXT);

    expect(sent).toHaveLength(0);
    expect(await tokenRows(userId)).toHaveLength(0);
    expect(lines.at(-1)?.fields.reason).toBe("already_verified");
  });

  it("skips when email delivery is disabled", async () => {
    const userId = await seedUser(null);
    const lines: LogLine[] = [];
    const job = runJob(disabledEmailPort(), lines);

    await job.handle({ userId, requestedAt: INSTANT.toISOString() }, CONTEXT);

    expect(await tokenRows(userId)).toHaveLength(0);
    expect(lines.at(-1)?.fields.reason).toBe("email_not_configured");
  });
});

describe("verification email link", () => {
  beforeEach(async () => {
    await db().delete(emailVerificationTokens);
    await db().delete(users);
  });

  it("omits the link when PUBLIC_APP_URL is unset", async () => {
    const userId = await seedUser(null);
    const { port, sent } = stubEmailPort();
    const job = runJob(port, [], { PUBLIC_APP_URL: "" });

    await job.handle({ userId, requestedAt: INSTANT.toISOString() }, CONTEXT);

    expect(first(sent).text).not.toContain("/verify-email");
  });
});
