import type { Scalar, SortSpec } from "./types";

export type CursorAfterValues<Field extends string> = Readonly<
  Partial<Record<Field, Scalar>>
>;

export type CursorAfterBuilders<Field extends string, Where> = Readonly<{
  equals: (field: Field, value: Scalar) => Where;
  compare: (field: Field, direction: "asc" | "desc", value: Scalar) => Where;
  and: (clauses: readonly Where[]) => Where;
  or: (clauses: readonly Where[]) => Where;
  empty: () => Where;
}>;

type BuildCursorAfterWhereInput<Field extends string, Where> = Readonly<{
  sort: readonly SortSpec<Field>[];
  after: CursorAfterValues<Field>;
  builders: CursorAfterBuilders<Field, Where>;
}>;

function getAfterValue<Field extends string>(
  after: CursorAfterValues<Field>,
  field: Field,
): Scalar {
  const value = after[field];

  if (value === undefined) {
    throw new Error(`Cursor missing value for sort field "${field}"`);
  }

  return value;
}

export function buildCursorAfterWhere<Field extends string, Where>(
  input: BuildCursorAfterWhereInput<Field, Where>,
): Where {
  if (input.sort.length === 0) return input.builders.empty();

  const clauses: Where[] = [];

  for (const [index, current] of input.sort.entries()) {
    const and: Where[] = [];

    for (const earlier of input.sort.slice(0, index)) {
      and.push(
        input.builders.equals(
          earlier.field,
          getAfterValue(input.after, earlier.field),
        ),
      );
    }

    and.push(
      input.builders.compare(
        current.field,
        current.direction,
        getAfterValue(input.after, current.field),
      ),
    );

    clauses.push(input.builders.and(and));
  }

  return input.builders.or(clauses);
}
