import type { Clock } from "../clock/clock";
import type { Database } from "../db/db";
import type { Logger } from "../logging/logger";
import { SWEEP_BATCH_SIZE } from "../queue/defaults";
import { schedulePayloadSchema, type SchedulePayload } from "../queue/job";
import { defineJob, type Job } from "../queue/registry";
import { deleteExpiredIdempotencyRecords } from "./idempotency.service";

export type IdempotencySweepJobDependencies = Readonly<{
  db: Database;
  clock: Clock;
  logger: Logger;
}>;

export type IdempotencySweepJobs = Readonly<{
  purgeExpiredIdempotencyRecords: Job<SchedulePayload>;
}>;

export function createIdempotencySweepJobs(
  dependencies: IdempotencySweepJobDependencies,
): IdempotencySweepJobs {
  return {
    purgeExpiredIdempotencyRecords: defineJob({
      name: "http.purgeExpiredIdempotencyRecords",
      payloadSchema: schedulePayloadSchema,
      handle: async (payload, context) => {
        const purged = await deleteExpiredIdempotencyRecords(dependencies.db, {
          nowMs: dependencies.clock.now().getTime(),
          limit: SWEEP_BATCH_SIZE,
        });

        dependencies.logger.info("idempotency records purged", {
          jobId: context.jobId,
          traceId: context.traceId,
          scheduledFor: payload.scheduledFor,
          purged,
        });
      },
    }),
  };
}
