import type { AppConfig } from "../config/config";
import { queueName, type QueueName } from "./job";

export const JOB_QUEUE_PREFIX = "cf-core-kit-jobs";
export const DEAD_LETTER_QUEUE_PREFIX = "cf-core-kit-dlq";

export function jobQueueName(appEnv: AppConfig["appEnv"]): QueueName {
  return queueName(`${JOB_QUEUE_PREFIX}-${appEnv}`);
}

export function deadLetterQueueName(appEnv: AppConfig["appEnv"]): QueueName {
  return queueName(`${DEAD_LETTER_QUEUE_PREFIX}-${appEnv}`);
}
