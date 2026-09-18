export const QUEUE_DEFAULTS = {
  maxBatchSize: 10,
  maxBatchTimeoutSeconds: 5,
  maxRetries: 3,
  retryBaseDelaySeconds: 30,
  retryJitterRatio: 0.2,
} as const;

export const MAX_MESSAGE_DELAY_SECONDS = 86_400;

export const SWEEP_BATCH_SIZE = 50;

export type RetryDelayOptions = Readonly<{
  baseDelaySeconds?: number;
  jitterRatio?: number;
  random?: () => number;
}>;

export function retryDelaySeconds(
  attempts: number,
  options: RetryDelayOptions = {},
): number {
  const base = options.baseDelaySeconds ?? QUEUE_DEFAULTS.retryBaseDelaySeconds;
  const jitterRatio = options.jitterRatio ?? QUEUE_DEFAULTS.retryJitterRatio;
  const random = options.random ?? Math.random;
  const exponent = Math.max(1, Math.trunc(attempts));
  const backoff = Math.min(base ** exponent, MAX_MESSAGE_DELAY_SECONDS);
  const jittered = backoff * (1 + random() * jitterRatio);

  return Math.min(Math.round(jittered), MAX_MESSAGE_DELAY_SECONDS);
}
