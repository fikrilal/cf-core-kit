import { createWorkerApp } from "./app";
import { createWorkerJobs } from "./jobs";
import { systemClock } from "./platform/clock/clock";
import { getConfig } from "./platform/config/config";
import { createDb } from "./platform/db/db";
import { createLogger } from "./platform/logging/logger";
import {
  createDeadLetterConsumer,
  createQueueConsumer,
} from "./platform/queue/consumer";
import { deadLetterQueueName } from "./platform/queue/names";
import { createQueueProducer } from "./platform/queue/producer";

export { AuthRateLimiter } from "./platform/rate-limit/rate-limiter";

const app = createWorkerApp();

export default {
  fetch: (request: Request, env: Env) => app.fetch(request, env),

  queue: async (batch: MessageBatch, env: Env) => {
    const config = getConfig(env);
    const logger = createLogger({
      appEnv: config.appEnv,
      logLevel: config.logLevel,
    });

    if (batch.queue === deadLetterQueueName(config.appEnv)) {
      await createDeadLetterConsumer({ logger })(batch);

      return;
    }

    const jobs = createWorkerJobs({
      db: createDb(env.DB),
      clock: systemClock,
      logger,
    });

    await createQueueConsumer({ registry: jobs.registry, logger })(batch);
  },

  scheduled: async (controller: ScheduledController, env: Env) => {
    const config = getConfig(env);
    const logger = createLogger({
      appEnv: config.appEnv,
      logLevel: config.logLevel,
    });
    const jobs = createWorkerJobs({
      db: createDb(env.DB),
      clock: systemClock,
      logger,
    });
    const producer = createQueueProducer({
      queue: env.JOBS,
      clock: systemClock,
      logger,
    });
    const scheduledFor = new Date(controller.scheduledTime).toISOString();
    const traceId = `cron:${scheduledFor}`;

    for (const job of jobs.scheduled) {
      await producer.enqueue(
        job,
        { scheduledFor },
        { jobId: `${job.name}-${scheduledFor}`, traceId },
      );
    }
  },
} satisfies ExportedHandler<Env>;
