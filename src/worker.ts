import { createWorkerApp } from "./app";
import { getConfig } from "./platform/config/config";
import { createLogger } from "./platform/logging/logger";
import {
  createDeadLetterConsumer,
  createQueueConsumer,
} from "./platform/queue/consumer";
import { deadLetterQueueName } from "./platform/queue/names";
import { createJobRegistry } from "./platform/queue/registry";

export { AuthRateLimiter } from "./platform/rate-limit/rate-limiter";

const app = createWorkerApp();

const JOB_REGISTRY = createJobRegistry([]);

export default {
  fetch: (request: Request, env: Env) => app.fetch(request, env),
  queue: async (batch: MessageBatch, env: Env) => {
    const config = getConfig(env);
    const logger = createLogger({
      appEnv: config.appEnv,
      logLevel: config.logLevel,
    });
    const consumer =
      batch.queue === deadLetterQueueName(config.appEnv)
        ? createDeadLetterConsumer({ logger })
        : createQueueConsumer({ registry: JOB_REGISTRY, logger });

    await consumer(batch);
  },
} satisfies ExportedHandler<Env>;
