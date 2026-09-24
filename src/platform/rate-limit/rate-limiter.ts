export type RateLimitRequest = Readonly<{
  key: string;
  limit: number;
  windowSeconds: number;
  blockSeconds?: number;
}>;

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

const MAX_KEY_LENGTH = 256;
const MAX_LIMIT = 1_000_000;
const MAX_WINDOW_SECONDS = 86_400;
const MAX_BLOCK_SECONDS = 86_400;

export interface RateLimitBucket {
  count: number;
  resetAt: number;
  blockedUntil?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedInteger(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;

  return value;
}

export function readRateLimitRequest(
  value: unknown,
): RateLimitRequest | undefined {
  if (!isRecord(value)) return undefined;

  const key = value.key;
  const limit = readBoundedInteger(value.limit, 1, MAX_LIMIT);
  const windowSeconds = readBoundedInteger(
    value.windowSeconds,
    1,
    MAX_WINDOW_SECONDS,
  );

  if (typeof key !== "string" || key === "" || key.length > MAX_KEY_LENGTH) {
    return undefined;
  }

  if (limit === undefined || windowSeconds === undefined) return undefined;

  if (value.blockSeconds === undefined) {
    return { key, limit, windowSeconds };
  }

  const blockSeconds = readBoundedInteger(
    value.blockSeconds,
    1,
    MAX_BLOCK_SECONDS,
  );

  if (blockSeconds === undefined) return undefined;

  return { key, limit, windowSeconds, blockSeconds };
}

export type RateLimitEvaluation = Readonly<{
  bucket: RateLimitBucket;
  decision: RateLimitDecision;
}>;

export function evaluateRateLimit(
  input: RateLimitRequest,
  previous: RateLimitBucket | undefined,
  now: number,
): RateLimitEvaluation {
  if (previous?.blockedUntil !== undefined) {
    if (previous.blockedUntil > now) {
      return {
        bucket: previous,
        decision: {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((previous.blockedUntil - now) / 1000),
          ),
        },
      };
    }

    // The advertised block elapsed: treat it as the resolution and start a
    // fresh window instead of instantly re-blocking on the stale count.
    return {
      bucket: { count: 1, resetAt: now + input.windowSeconds * 1000 },
      decision: { allowed: true, retryAfterSeconds: 0 },
    };
  }

  const bucket =
    previous === undefined || previous.resetAt <= now
      ? { count: 1, resetAt: now + input.windowSeconds * 1000 }
      : { count: previous.count + 1, resetAt: previous.resetAt };

  if (bucket.count <= input.limit) {
    return { bucket, decision: { allowed: true, retryAfterSeconds: 0 } };
  }

  if (input.blockSeconds !== undefined) {
    const blockedUntil = now + input.blockSeconds * 1000;

    return {
      bucket: { ...bucket, blockedUntil },
      decision: { allowed: false, retryAfterSeconds: input.blockSeconds },
    };
  }

  return {
    bucket,
    decision: {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    },
  };
}

export class AuthRateLimiter implements DurableObject {
  private readonly buckets = new Map<string, RateLimitBucket>();

  async fetch(request: Request): Promise<Response> {
    const input = await readRequest(request);
    if (input === undefined) {
      return Response.json({ error: "invalid request" }, { status: 400 });
    }

    const evaluation = evaluateRateLimit(
      input,
      this.buckets.get(input.key),
      Date.now(),
    );
    this.buckets.set(input.key, evaluation.bucket);

    return Response.json(evaluation.decision);
  }
}

async function readRequest(
  request: Request,
): Promise<RateLimitRequest | undefined> {
  try {
    const parsed: unknown = await request.json();

    return readRateLimitRequest(parsed);
  } catch {
    return undefined;
  }
}
