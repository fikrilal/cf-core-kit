import { z } from "zod";

import type { Clock } from "../../platform/clock/clock";
import type { AppConfig } from "../../platform/config/config";
import { randomBase64Url, sha256Base64Url } from "../../platform/crypto/crypto";
import type { Database } from "../../platform/db/db";
import { emailVerificationTokens } from "../../platform/db/schema";
import type { EmailPort } from "../../platform/email/email";
import type { Logger } from "../../platform/logging/logger";
import { createQueueProducer } from "../../platform/queue/producer";
import {
  defineJob,
  type Job,
  type JobSpec,
} from "../../platform/queue/registry";
import { findUserById } from "./repository";

export const SEND_VERIFICATION_EMAIL_JOB = "auth.sendVerificationEmail";

export const sendVerificationEmailPayloadSchema = z.object({
  userId: z.string().min(1),
  requestedAt: z.iso.datetime(),
});

export type SendVerificationEmailPayload = z.infer<
  typeof sendVerificationEmailPayloadSchema
>;

export const sendVerificationEmailSpec: JobSpec<SendVerificationEmailPayload> =
  {
    name: SEND_VERIFICATION_EMAIL_JOB,
    payloadSchema: sendVerificationEmailPayloadSchema,
  };

export type VerificationEmailMessage = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

function buildVerifyEmailUrl(
  publicAppUrl: string | undefined,
  token: string,
): string | undefined {
  if (publicAppUrl === undefined || publicAppUrl.trim() === "") {
    return undefined;
  }

  const url = new URL("/verify-email", publicAppUrl);
  url.searchParams.set("token", token);

  return url.toString();
}

export function buildVerificationEmail(input: {
  rawToken: string;
  expiresAt: Date;
  publicAppUrl: string | undefined;
}): VerificationEmailMessage {
  const verifyUrl = buildVerifyEmailUrl(input.publicAppUrl, input.rawToken);
  const expiresAtIso = input.expiresAt.toISOString();
  const text = [
    "Use this token to verify your email:",
    "",
    input.rawToken,
    "",
    ...(verifyUrl === undefined ? [] : ["Or open this link:", verifyUrl, ""]),
    `This token expires at ${expiresAtIso}.`,
  ].join("\n");
  const html = [
    "<p>Use this token to verify your email:</p>",
    `<p><strong>${input.rawToken}</strong></p>`,
    ...(verifyUrl === undefined
      ? []
      : [`<p>Or open this link: <a href="${verifyUrl}">${verifyUrl}</a></p>`]),
    `<p>This token expires at ${expiresAtIso}.</p>`,
  ].join("");

  return { subject: "Verify your email", text, html };
}

export type SendVerificationEmailJobDependencies = Readonly<{
  db: Database;
  clock: Clock;
  email: EmailPort;
  config: AppConfig;
  logger: Logger;
}>;

export function createSendVerificationEmailJob(
  dependencies: SendVerificationEmailJobDependencies,
): Job<SendVerificationEmailPayload> {
  return defineJob({
    name: SEND_VERIFICATION_EMAIL_JOB,
    payloadSchema: sendVerificationEmailPayloadSchema,
    handle: async (payload, context) => {
      const user = await findUserById(dependencies.db, payload.userId);

      if (user === undefined || user.status === "DELETED") {
        dependencies.logger.warn("verification email skipped", {
          jobId: context.jobId,
          traceId: context.traceId,
          userId: payload.userId,
          reason: user === undefined ? "user_not_found" : "already_deleted",
        });

        return;
      }

      if (user.emailVerifiedAt !== null) {
        dependencies.logger.info("verification email skipped", {
          jobId: context.jobId,
          traceId: context.traceId,
          userId: payload.userId,
          reason: "already_verified",
        });

        return;
      }

      if (!dependencies.email.isEnabled()) {
        dependencies.logger.warn("verification email skipped", {
          jobId: context.jobId,
          traceId: context.traceId,
          userId: payload.userId,
          reason: "email_not_configured",
        });

        return;
      }

      const now = dependencies.clock.now();
      const rawToken = randomBase64Url(32);
      const expiresAt = new Date(
        now.getTime() +
          dependencies.config.authEmailVerificationTokenTtlSeconds * 1000,
      );
      const message = buildVerificationEmail({
        rawToken,
        expiresAt,
        publicAppUrl: dependencies.config.publicAppUrl,
      });

      await dependencies.db.insert(emailVerificationTokens).values({
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: await sha256Base64Url(rawToken),
        expiresAt,
        usedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const sent = await dependencies.email.send({
        to: user.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      dependencies.logger.info("verification email sent", {
        jobId: context.jobId,
        traceId: context.traceId,
        userId: user.id,
        requestedAt: payload.requestedAt,
        emailId: sent.id,
        tokenExpiresAt: expiresAt.toISOString(),
      });
    },
  });
}

export type SendVerificationEmailProducer = Readonly<{
  isEnabled: () => boolean;
  enqueueSendVerificationEmail: (input: {
    userId: string;
    requestedAt: string;
  }) => Promise<boolean>;
}>;

export function createSendVerificationEmailProducer(
  dependencies: Readonly<{
    queue: Queue;
    clock: Clock;
    email: EmailPort;
    logger: Logger;
  }>,
): SendVerificationEmailProducer {
  const producer = createQueueProducer({
    queue: dependencies.queue,
    clock: dependencies.clock,
    logger: dependencies.logger,
  });

  return {
    isEnabled: () => dependencies.email.isEnabled(),
    enqueueSendVerificationEmail: (input) =>
      producer.enqueue(sendVerificationEmailSpec, input),
  };
}
