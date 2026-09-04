import { ListQueryValidationError, type ListQueryIssue } from "./errors";
import { hasOwnField, isPlainObject } from "./object";
import { parseFilterScalar } from "./scalars";
import type {
  FilterAllowlist,
  FilterExpr,
  FilterFieldConfig,
  FilterOperator,
  Scalar,
} from "./types";

interface FilterParseState<Field extends string> {
  filters: FilterExpr<Field>[];
  issues: ListQueryIssue[];
}

function formatFilterField(field: string, op?: string): string {
  return op ? `filter[${field}][${op}]` : `filter[${field}]`;
}

function parseInList(raw: unknown): string[] | undefined {
  if (typeof raw !== "string") return undefined;

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  return parts.length > 0 ? parts : undefined;
}

function addExpr<Field extends string>(
  state: FilterParseState<Field>,
  field: Field,
  op: FilterOperator,
  rawValue: unknown,
  config: FilterFieldConfig,
): void {
  if (!config.ops.includes(op)) {
    state.issues.push({
      field: formatFilterField(field, op),
      message: "Unsupported operator",
    });
    return;
  }

  if (op === "in") {
    const list = parseInList(rawValue);
    if (list === undefined) {
      state.issues.push({
        field: formatFilterField(field, "in"),
        message: "Expected a comma-separated list",
      });
      return;
    }

    const parsed = list.map((item) =>
      parseFilterScalar(config.type, item, config.enumValues),
    );
    const defined = parsed.filter(
      (value): value is Scalar => value !== undefined,
    );

    if (defined.length !== list.length) {
      state.issues.push({
        field: formatFilterField(field, "in"),
        message: "Invalid value in list",
      });
      return;
    }

    state.filters.push({ field, op: "in", value: defined });
    return;
  }

  const parsed = parseFilterScalar(config.type, rawValue, config.enumValues);
  if (parsed === undefined) {
    state.issues.push({
      field: formatFilterField(field, op === "eq" ? undefined : op),
      message: "Invalid value",
    });
    return;
  }

  if (op === "eq") {
    state.filters.push({ field, op: "eq", value: parsed });
    return;
  }

  state.filters.push({ field, op, value: parsed });
}

function parseFieldValue<Field extends string>(
  state: FilterParseState<Field>,
  field: Field,
  value: unknown,
  config: FilterFieldConfig,
): void {
  if (!isPlainObject(value)) {
    addExpr(state, field, "eq", value, config);
    return;
  }

  for (const [opRaw, opValue] of Object.entries(value)) {
    if (
      opRaw === "eq" ||
      opRaw === "in" ||
      opRaw === "gte" ||
      opRaw === "lte"
    ) {
      addExpr(state, field, opRaw, opValue, config);
      continue;
    }

    state.issues.push({
      field: formatFilterField(field, opRaw),
      message: "Unsupported operator",
    });
  }
}

export function parseFilters<Field extends string>(
  rawFilter: unknown,
  allowlist: FilterAllowlist<Field>,
): readonly FilterExpr<Field>[] {
  if (rawFilter === undefined || rawFilter === null) return [];

  if (!isPlainObject(rawFilter)) {
    throw new ListQueryValidationError([
      { field: "filter", message: "filter must be an object" },
    ]);
  }

  const state: FilterParseState<Field> = { filters: [], issues: [] };

  for (const [fieldRaw, value] of Object.entries(rawFilter)) {
    if (!hasOwnField(allowlist, fieldRaw)) {
      state.issues.push({
        field: formatFilterField(fieldRaw),
        message: "Unsupported filter field",
      });
      continue;
    }

    parseFieldValue(state, fieldRaw, value, allowlist[fieldRaw]);
  }

  if (state.issues.length > 0) {
    throw new ListQueryValidationError(state.issues);
  }

  return state.filters;
}
