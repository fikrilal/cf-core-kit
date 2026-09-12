import type { Context } from "hono";
import type { z } from "zod";

import { ErrorCode } from "../../shared/error-codes";
import { AppError, type AppErrorIssue } from "../errors/app-error";
import type { AppEnv } from "./types";

export function zodErrorToIssues(error: z.ZodError): AppErrorIssue[] {
  return error.issues.map((issue) => ({
    ...(issue.path.length === 0 ? {} : { field: issue.path.join(".") }),
    message: issue.message,
  }));
}

export function decode<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      issues: zodErrorToIssues(result.error),
    });
  }

  return result.data;
}

export async function readJson<T>(
  context: Context<AppEnv>,
  schema: z.ZodType<T>,
): Promise<T> {
  let payload: unknown;

  try {
    payload = await context.req.json();
  } catch {
    throw new AppError({ status: 400, code: ErrorCode.VALIDATION_FAILED });
  }

  return decode(schema, payload);
}
