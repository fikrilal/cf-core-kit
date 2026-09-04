import { decodeCursorV1 } from "./cursor";
import { ListQueryValidationError, type ListQueryIssue } from "./errors";
import { parseFilters } from "./filter";
import { parseSort, type ParseSortOptions } from "./sort";
import type { FilterAllowlist, FilterExpr, ListQuery, SortSpec } from "./types";

export type ListQueryInput = Readonly<{
  limit?: unknown;
  cursor?: unknown;
  sort?: unknown;
  q?: unknown;
  filter?: unknown;
}>;

export type ListQueryOptions<
  SortField extends string,
  FilterField extends string,
> = Readonly<{
  defaultLimit?: number;
  maxLimit?: number;
  search?: boolean;
  sort: ParseSortOptions<SortField>;
  filters?: FilterAllowlist<FilterField>;
}>;

function parseLimit(raw: unknown, defaultLimit: number): number | undefined {
  if (raw === undefined || raw === null || raw === "") return defaultLimit;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;

  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function resolveLimit(
  rawLimit: unknown,
  defaultLimit: number,
  maxLimit: number,
  issues: ListQueryIssue[],
): number {
  const parsedLimit = parseLimit(rawLimit, defaultLimit);

  if (
    parsedLimit === undefined ||
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1
  ) {
    issues.push({
      field: "limit",
      message: "limit must be a positive integer",
    });
    return defaultLimit;
  }

  if (parsedLimit > maxLimit) {
    issues.push({
      field: "limit",
      message: `limit must be at most ${String(maxLimit)}`,
    });
  }

  return parsedLimit;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function resolveFilters<Field extends string>(
  input: ListQueryInput,
  allowlist: FilterAllowlist<Field> | undefined,
): readonly FilterExpr<Field>[] {
  if (allowlist !== undefined) {
    return parseFilters(input.filter, allowlist);
  }

  if (input.filter === undefined || input.filter === null) {
    return [];
  }

  if (
    typeof input.filter === "object" &&
    Object.keys(input.filter).length === 0
  ) {
    return [];
  }

  throw new ListQueryValidationError([
    { field: "filter", message: "Filtering is not supported" },
  ]);
}

function resolveQ(
  input: ListQueryInput,
  searchEnabled: boolean,
  issues: ListQueryIssue[],
): string | undefined {
  if (!isNonEmptyString(input.q)) return undefined;

  if (!searchEnabled) {
    issues.push({ field: "q", message: "Search is not supported" });
    return undefined;
  }

  return input.q.trim();
}

export function parseListQuery<
  SortField extends string,
  FilterField extends string,
>(
  input: ListQueryInput,
  options: ListQueryOptions<SortField, FilterField>,
): ListQuery<SortField, FilterField> {
  const issues: ListQueryIssue[] = [];

  const limit = resolveLimit(
    input.limit,
    options.defaultLimit ?? 25,
    options.maxLimit ?? 250,
    issues,
  );

  const { sort, normalizedSort } = parseSort(input.sort, {
    ...options.sort,
    maxFields: options.sort.maxFields ?? 3,
  });

  const filters = resolveFilters(input, options.filters);
  const q = resolveQ(input, options.search === true, issues);

  const cursorRaw = isNonEmptyString(input.cursor)
    ? input.cursor.trim()
    : undefined;
  const cursor = cursorRaw
    ? decodeCursorV1(cursorRaw, {
        expectedSort: normalizedSort,
        sortFields: sort.map((spec: SortSpec<SortField>) => spec.field),
        allowed: options.sort.allowed,
      })
    : undefined;

  if (issues.length > 0) {
    throw new ListQueryValidationError(issues);
  }

  return {
    limit,
    sort,
    normalizedSort,
    ...(cursor === undefined ? {} : { cursor }),
    ...(cursorRaw === undefined ? {} : { cursorRaw }),
    filters,
    ...(q === undefined ? {} : { q }),
  };
}
