import { createAuthSweepJobs } from "./features/auth/sweep.jobs";
import type { Clock } from "./platform/clock/clock";
import type { Database } from "./platform/db/db";
import { createIdempotencySweepJobs } from "./platform/http/idempotency.jobs";
import type { Logger } from "./platform/logging/logger";
import type { SchedulePayload } from "./platform/queue/job";
import {
  createJobRegistry,
  type Job,
  type JobRegistry,
} from "./platform/queue/registry";

export type WorkerJobDependencies = Readonly<{
  db: Database;
  clock: Clock;
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

  return {
    registry: createJobRegistry([
      authSweeps.purgeExpiredSessions,
      idempotencySweeps.purgeExpiredIdempotencyRecords,
    ]),
    scheduled: [
      authSweeps.purgeExpiredSessions,
      idempotencySweeps.purgeExpiredIdempotencyRecords,
    ],
  };
}
