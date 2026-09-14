import type { Context } from "hono";
import type { z } from "zod";

import { ErrorCode } from "../../shared/error-codes";
import { AppError, type AppErrorIssue } from "../errors/app-error";
import type { AppEnv } from "./types";

export function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    record[entryKey] = entryValue;
  }

  return record[key];
}

export function rejectUnknownKeys(
  value: unknown,
  allowed: readonly string[],
  fieldPrefix = "",
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }

  const issues: AppErrorIssue[] = [];

  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;

    issues.push({
      field: `${fieldPrefix}${key}`,
      message: "property should not exist",
    });
  }

  if (issues.length > 0) {
    throw new AppError({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      issues,
    });
  }
}

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
