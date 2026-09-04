import { ListQueryValidationError, type ListQueryIssue } from "./errors";
import { hasOwnField } from "./object";
import type { SortAllowlist, SortDirection, SortSpec } from "./types";

export type ParseSortOptions<Field extends string> = Readonly<{
  allowed: SortAllowlist<Field>;
  default: readonly SortSpec<Field>[];
  maxFields?: number;
  tieBreaker: SortSpec<Field>;
}>;

function normalizeSort<Field extends string>(
  sort: readonly SortSpec<Field>[],
): string {
  return sort
    .map((spec) => (spec.direction === "desc" ? `-${spec.field}` : spec.field))
    .join(",");
}

function hasField<Field extends string>(
  sort: readonly SortSpec<Field>[],
  field: Field,
): boolean {
  return sort.some((spec) => spec.field === field);
}

function parseSortTokens<Field extends string>(
  raw: unknown,
  options: ParseSortOptions<Field>,
  issues: ListQueryIssue[],
): SortSpec<Field>[] {
  const tokens: string[] = [];

  if (raw === undefined || raw === null || raw === "") {
    // empty -> default
  } else if (typeof raw === "string") {
    tokens.push(
      ...raw
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token !== ""),
    );
  } else {
    issues.push({ field: "sort", message: "sort must be a string" });
  }

  const userSort: SortSpec<Field>[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const direction: SortDirection = token.startsWith("-") ? "desc" : "asc";
    const field = (token.startsWith("-") ? token.slice(1) : token).trim();

    if (!hasOwnField(options.allowed, field)) {
      issues.push({
        field: "sort",
        message: `Unsupported sort field "${field}"`,
      });
      continue;
    }

    if (seen.has(field)) {
      issues.push({
        field: "sort",
        message: `Duplicate sort field "${field}"`,
      });
      continue;
    }

    seen.add(field);
    userSort.push({ field, direction });
  }

  return userSort;
}

export function parseSort<Field extends string>(
  raw: unknown,
  options: ParseSortOptions<Field>,
): { sort: readonly SortSpec<Field>[]; normalizedSort: string } {
  const maxFields = options.maxFields ?? 3;
  const issues: ListQueryIssue[] = [];

  if (!hasOwnField(options.allowed, options.tieBreaker.field)) {
    throw new Error(
      `ListQuery misconfigured: tieBreaker "${options.tieBreaker.field}" must be included in allowed sort fields`,
    );
  }

  const userSort = parseSortTokens(raw, options, issues);

  if (userSort.length > maxFields) {
    issues.push({
      field: "sort",
      message: `sort supports at most ${String(maxFields)} fields`,
    });
  }

  if (issues.length > 0) {
    throw new ListQueryValidationError(issues);
  }

  const baseSort = userSort.length > 0 ? userSort : [...options.default];

  if (baseSort.length === 0) {
    throw new Error("ListQuery misconfigured: default sort must not be empty");
  }

  const sort = hasField(baseSort, options.tieBreaker.field)
    ? baseSort
    : [...baseSort, options.tieBreaker];

  return { sort, normalizedSort: normalizeSort(sort) };
}
