import type { Context } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import {
  ListQueryValidationError,
  isPlainObject,
  parseListQuery,
  type ListQuery,
  type ListQueryInput,
  type ListQueryOptions,
} from "../../shared/list-query";
import { AppError, type AppErrorIssue } from "../errors/app-error";
import type { AppEnv } from "./types";

const FILTER_KEY_PATTERN = /^filter\[([^[\]]+)\](?:\[([^[\]]+)\])?$/;
const RESERVED_QUERY_KEYS = new Set(["limit", "cursor", "sort", "q", "filter"]);

function collectUnknownParamIssues(
  query: Readonly<Record<string, string[]>>,
): AppErrorIssue[] {
  const issues: AppErrorIssue[] = [];

  for (const key of Object.keys(query)) {
    if (RESERVED_QUERY_KEYS.has(key) || FILTER_KEY_PATTERN.test(key)) continue;

    issues.push({ field: key, message: "Unsupported query parameter" });
  }

  return issues;
}

function queryValue(
  query: Readonly<Record<string, string[]>>,
  key: string,
): unknown {
  const values = query[key];

  if (values === undefined || values.length === 0) return undefined;
  return values.length > 1 ? values : values[0];
}

function buildFilterObject(
  query: Readonly<Record<string, string[]>>,
): Record<string, unknown> | undefined {
  let filter: Record<string, unknown> | undefined;

  for (const [key, values] of Object.entries(query)) {
    const match = FILTER_KEY_PATTERN.exec(key);
    if (match === null) continue;

    const field = match[1];
    if (field === undefined || values.length === 0) continue;

    const value: unknown = values.length > 1 ? values : values[0];
    const op = match[2];

    filter ??= {};

    if (op === undefined) {
      filter[field] = value;
      continue;
    }

    const existing = filter[field];
    const nested = isPlainObject(existing) ? existing : {};
    nested[op] = value;
    filter[field] = nested;
  }

  return filter;
}

function readListQueryInput(
  query: Readonly<Record<string, string[]>>,
): ListQueryInput {
  const filter = buildFilterObject(query);

  return {
    limit: queryValue(query, "limit"),
    cursor: queryValue(query, "cursor"),
    sort: queryValue(query, "sort"),
    q: queryValue(query, "q"),
    filter: filter ?? queryValue(query, "filter"),
  };
}

function validationError(issues: readonly AppErrorIssue[]): AppError {
  return new AppError({
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
    issues,
  });
}

export function readListQuery<
  SortField extends string,
  FilterField extends string,
>(
  context: Context<AppEnv>,
  options: ListQueryOptions<SortField, FilterField>,
): ListQuery<SortField, FilterField> {
  const query = context.req.queries();
  const unknownParamIssues = collectUnknownParamIssues(query);

  if (unknownParamIssues.length > 0) {
    throw validationError(unknownParamIssues);
  }

  try {
    return parseListQuery(readListQueryInput(query), options);
  } catch (error) {
    if (error instanceof ListQueryValidationError) {
      throw validationError(
        error.issues.map((issue) => ({
          field: issue.field,
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}
