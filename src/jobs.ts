// cfkit:job-factories — `cfkit scaffold feature --with-queue` inserts its import after this line.
import { createSendVerificationEmailJob } from "./features/auth/email-verification/email-verification.jobs";
import { createAuthSweepJobs } from "./features/auth/sessions/sweep.jobs";
import { createAccountDeletionJobs } from "./features/users/account-deletion/account-deletion.jobs";
import { createProfileImageJobs } from "./features/users/profile-image/profile-image.jobs";
import type { Clock } from "./platform/clock/clock";
import type { AppConfig } from "./platform/config/config";
import type { Database } from "./platform/db/db";
import type { EmailPort } from "./platform/email/email";
import { createIdempotencySweepJobs } from "./platform/http/idempotency.jobs";
import type { Logger } from "./platform/logging/logger";
import type { SchedulePayload } from "./platform/queue/job";
import {
  createJobRegistry,
  type Job,
  type JobRegistry,
} from "./platform/queue/registry";
import type { ObjectStorageHandle } from "./platform/storage/presign";

export type WorkerJobDependencies = Readonly<{
  db: Database;
  queue: Queue;
  clock: Clock;
  email: EmailPort;
  config: AppConfig;
  objectStorage: ObjectStorageHandle | undefined;
  logger: Logger;
}>;

export type WorkerJobs = Readonly<{
  registry: JobRegistry;
  scheduled: readonly Job<SchedulePayload>[];
}>;

export function createWorkerJobs(
  dependencies: WorkerJobDependencies,
): WorkerJobs {
  const authSweeps = createAuthSweepJobs(dependencies);
  const idempotencySweeps = createIdempotencySweepJobs(dependencies);
  const sendVerificationEmail = createSendVerificationEmailJob(dependencies);
  const profileImage = createProfileImageJobs(dependencies);
  const accountDeletion = createAccountDeletionJobs(dependencies);

  const scheduled = [
    authSweeps.purgeExpiredSessions,
    idempotencySweeps.purgeExpiredIdempotencyRecords,
    accountDeletion.finalizeDueAccountDeletions,
  ] as const;

  return {
    registry: createJobRegistry([
      ...scheduled,
      sendVerificationEmail,
      profileImage.deleteStoredFile,
      profileImage.expireUpload,
      accountDeletion.finalizeAccountDeletion,
    ]),
    scheduled,
  };
}
