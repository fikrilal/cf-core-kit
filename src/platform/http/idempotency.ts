import type { Context, MiddlewareHandler } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import { createDb } from "../db/db";
import { AppError } from "../errors/app-error";
import {
  computeRequestHash,
  isWriteMethod,
  type CompletedRecord,
  type WriteMethod,
} from "./idempotency.core";
import {
  beginIdempotency,
  completeIdempotency,
  releaseIdempotency,
  waitForIdempotencyCompletion,
  type IdempotencyBeginParams,
} from "./idempotency.service";
import type { AppEnv } from "./types";

export type IdempotencyOptions = Readonly<{
  scopeKey?: string;
  required?: boolean;
  ttlSeconds?: number;
  waitMs?: number;
  lockTtlSeconds?: number;
}>;

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_WAIT_MS = 2000;
const DEFAULT_LOCK_TTL_SECONDS = 30;

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function replayHeaders(response: Response): Record<string, string> {
  const location = response.headers.get("Location");

  return location === null ? {} : { Location: location };
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.body === null) return undefined;

  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

function replayResponse(record: CompletedRecord): Response {
  const headers = new Headers(record.headers);
  // Family replay downgrades 201 to 200.
  const status = record.status === 201 ? 200 : record.status;

  headers.set("Idempotency-Replayed", "true");

  if (!record.hasBody) {
    return new Response(null, { status, headers });
  }

  return Response.json(record.body, { status, headers });
}

function beginParams(
  context: Context<AppEnv>,
  method: WriteMethod,
  options: IdempotencyOptions,
  requestHash: string,
): IdempotencyBeginParams {
  return {
    principalId: context.get("principalId"),
    headerValue: context.req.header("idempotency-key"),
    requestHash,
    scopeKey:
      options.scopeKey ?? `${method} ${new URL(context.req.url).pathname}`,
    required: options.required ?? false,
    ttlSeconds: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    waitMs: options.waitMs ?? DEFAULT_WAIT_MS,
    lockTtlSeconds: options.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS,
  };
}

export function idempotent(
  options: IdempotencyOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const method = context.req.method.toUpperCase();

    if (!isWriteMethod(method)) {
      throw new AppError({
        status: 500,
        code: ErrorCode.INTERNAL,
        message: "Idempotency is only supported for write endpoints",
      });
    }

    const url = new URL(context.req.url);
    const db = createDb(context.env.DB);

    const requestHash = await computeRequestHash({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: await readJsonBody(context.req.raw.clone()),
    });

    const begin = await beginIdempotency(
      db,
      beginParams(context, method, options, requestHash),
    );

    switch (begin.kind) {
      case "skip":
        await next();
        return;
      case "replay":
        return replayResponse(begin.record);
      case "in_progress": {
        const completed = await waitForIdempotencyCompletion(
          db,
          begin.key,
          begin.requestHash,
          begin.waitMs,
        );

        if (completed !== undefined) {
          return replayResponse(completed);
        }

        throw new AppError({
          status: 409,
          code: ErrorCode.IDEMPOTENCY_IN_PROGRESS,
          message: "An identical request is already in progress",
          retryAfterSeconds: 1,
        });
      }
      case "acquired":
        try {
          await next();
        } catch (error) {
          await releaseIdempotency(db, begin.key, begin.requestHash);
          throw error;
        }

        await completeIdempotency(
          db,
          begin.key,
          begin.requestHash,
          context.res.status,
          await readResponseBody(context.res),
          replayHeaders(context.res),
          begin.ttlSeconds,
        );
        return;
      default: {
        const unreachable: never = begin;
        throw new Error(
          `Unexpected idempotency outcome: ${String(unreachable)}`,
        );
      }
    }
  };
}
