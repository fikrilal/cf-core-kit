import type { Clock } from "../../platform/clock/clock";
import type { Database } from "../../platform/db/db";
import type { Logger } from "../../platform/logging/logger";
import { SWEEP_BATCH_SIZE } from "../../platform/queue/defaults";
import {
  schedulePayloadSchema,
  type SchedulePayload,
} from "../../platform/queue/job";
import { defineJob, type Job } from "../../platform/queue/registry";
import { purgeExpiredSessions } from "./repository";

export type AuthSweepJobDependencies = Readonly<{
  db: Database;
  clock: Clock;
  logger: Logger;
}>;

export type AuthSweepJobs = Readonly<{
  purgeExpiredSessions: Job<SchedulePayload>;
}>;

export function createAuthSweepJobs(
  dependencies: AuthSweepJobDependencies,
): AuthSweepJobs {
  return {
    purgeExpiredSessions: defineJob({
      name: "auth.purgeExpiredSessions",
      payloadSchema: schedulePayloadSchema,
      handle: async (payload, context) => {
        const purged = await purgeExpiredSessions(dependencies.db, {
          now: dependencies.clock.now(),
          limit: SWEEP_BATCH_SIZE,
        });

        dependencies.logger.info("sessions purged", {
          jobId: context.jobId,
          traceId: context.traceId,
          scheduledFor: payload.scheduledFor,
          purged,
        });
      },
    }),
  };
}
