import { decodeBase64Url, encodeBase64Url } from "../base64url";
import { ListQueryValidationError, type ListQueryIssue } from "./errors";
import { hasOwnField, isPlainObject } from "./object";
import { parseScalar } from "./scalars";
import type { CursorPayloadV1, Scalar, SortAllowlist } from "./types";

const MAX_CURSOR_LENGTH = 4096;

export function encodeCursorV1<Field extends string>(
  payload: CursorPayloadV1<Field>,
): string {
  return encodeBase64Url(JSON.stringify(payload));
}

export type DecodeCursorV1Options<Field extends string> = Readonly<{
  expectedSort: string;
  sortFields: readonly Field[];
  allowed: SortAllowlist<Field>;
}>;

function parseCursorJson(cursor: string): Record<string, unknown> {
  let decoded: string;
  try {
    decoded = decodeBase64Url(cursor);
  } catch {
    throw new ListQueryValidationError([
      { field: "cursor", message: "Invalid cursor encoding" },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new ListQueryValidationError([
      { field: "cursor", message: "Invalid cursor JSON" },
    ]);
  }

  if (!isPlainObject(parsed)) {
    throw new ListQueryValidationError([
      { field: "cursor", message: "Invalid cursor payload" },
    ]);
  }

  return parsed;
}

function validateCursorHeader(
  parsed: Record<string, unknown>,
  expectedSort: string,
  issues: ListQueryIssue[],
): Record<string, unknown> | undefined {
  const version = parsed.v;
  const sort = parsed.sort;
  const after = parsed.after;

  if (version !== 1) {
    issues.push({ field: "cursor", message: "Unsupported cursor version" });
  }

  if (typeof sort !== "string" || sort.trim() === "") {
    issues.push({ field: "cursor", message: "Cursor sort is missing" });
  } else if (sort !== expectedSort) {
    issues.push({
      field: "cursor",
      message: "Cursor does not match the current sort",
    });
  }

  const afterObj = isPlainObject(after) ? after : undefined;
  if (!afterObj) {
    issues.push({ field: "cursor", message: 'Cursor "after" is missing' });
  }

  return afterObj;
}

function parseAfterFields<Field extends string>(
  afterObj: Record<string, unknown>,
  options: DecodeCursorV1Options<Field>,
  issues: ListQueryIssue[],
): Partial<Record<Field, Scalar>> {
  const outAfter: Partial<Record<Field, Scalar>> = {};

  for (const [fieldRaw, value] of Object.entries(afterObj)) {
    if (!hasOwnField(options.allowed, fieldRaw)) {
      issues.push({
        field: "cursor",
        message: "Cursor contains unsupported fields",
      });
      continue;
    }

    const parsedValue = parseScalar(options.allowed[fieldRaw].type, value);
    if (parsedValue === undefined) {
      issues.push({
        field: "cursor",
        message: `Invalid cursor value for "${fieldRaw}"`,
      });
      continue;
    }

    outAfter[fieldRaw] = parsedValue;
  }

  for (const field of options.sortFields) {
    if (outAfter[field] === undefined) {
      issues.push({
        field: "cursor",
        message: `Cursor is missing field "${field}"`,
      });
    }
  }

  return outAfter;
}

export function decodeCursorV1<Field extends string>(
  cursor: string,
  options: DecodeCursorV1Options<Field>,
): CursorPayloadV1<Field> {
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw new ListQueryValidationError([
      { field: "cursor", message: "Cursor is too long" },
    ]);
  }

  const parsed = parseCursorJson(cursor);
  const headerIssues: ListQueryIssue[] = [];
  const afterObj = validateCursorHeader(
    parsed,
    options.expectedSort,
    headerIssues,
  );

  if (headerIssues.length > 0 || afterObj === undefined) {
    throw new ListQueryValidationError(
      headerIssues.length > 0
        ? headerIssues
        : [{ field: "cursor", message: 'Cursor "after" is missing' }],
    );
  }

  const fieldIssues: ListQueryIssue[] = [];
  const after = parseAfterFields(afterObj, options, fieldIssues);

  if (fieldIssues.length > 0) {
    throw new ListQueryValidationError(fieldIssues);
  }

  return { v: 1, sort: options.expectedSort, after };
}
