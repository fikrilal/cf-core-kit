# Section note: `src/shared/list-query`

- Status: Draft. No production edit until this note is accepted. Earlier fixes stay parked.
- Date: 2026-10-15
- Scope: the framework-free list parser. The Hono adapter in `src/platform/http/list-query.ts` was judged in note 01. The first caller of the where-builders is the session list, judged in note 05.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: none.

## Verdict

This package is already the shared core a list handler should call. `parseListQuery` is the one entry. Sort, filter, cursor, and scalar parsing each own a file. `buildCursorAfterWhere` is the keyset predicate. Drizzle stays out of this folder. `src/shared` has no Workers APIs here.

The function looks like it collects every problem into one `issues` array. Sort, filters, and cursor throw on their own instead. That matches `backend-core-kit` `libs/shared/list-query/list-query.ts`. Leave it. A cleanup that waits for every parser would change which errors a bad query returns.

No bug. No edit in this section.

## What was read

Production:

| File              | Lines | Role                                           |
| ----------------- | ----- | ---------------------------------------------- |
| `list-query.ts`   | 159   | `parseListQuery`                               |
| `sort.ts`         | 114   | tokens, default, tie-breaker                   |
| `filter.ts`       | 153   | allowlist, operators                           |
| `cursor.ts`       | 153   | base64url cursor v1                            |
| `cursor-after.ts` | 65    | keyset OR of ANDs                              |
| `where.ts`        | 79    | builder factory, date and string cursor values |
| `scalars.ts`      | 91    | string, uuid, datetime, number, boolean, enum  |
| `types.ts`        | 56    | the result and the allowlists                  |
| `errors.ts`       | 15    | `ListQueryValidationError`                     |
| `object.ts`       | 12    | `isPlainObject`, `hasOwnField`                 |
| `index.ts`        | 10    | re-exports                                     |

Specs were sampled for the claims below: `list-query.spec.ts`, `sort.spec.ts`, `filter.spec.ts`, `cursor.spec.ts`, `cursor-after.spec.ts`, `where.spec.ts`.

## Correct and should stay

- `parseScalar` switches on the field type and returns in every arm. That is the exhaustive switch this package already has. `parseFilterScalar` handles `enum` before that switch because a cursor field cannot be an enum. Leave the split.
- `parseDateIso` and `parseCursorDateValue` call `new Date` to accept or reject a timestamp. That is parsing, not a clock. Do not inject `Clock`.
- An empty sort uses the endpoint default, then appends `tieBreaker` when the caller left it out. A tie-breaker that is not in the allowlist throws `ListQuery misconfigured`. That is a programmer error, not a `400`. Leave the two different throws.
- `parseFilters` rejects an unknown field, an unknown operator, and a bad value with `filter[field]` or `filter[field][op]`. The Hono adapter owns the query-string grammar. This file owns the object. Do not merge them.
- `decodeCursorV1` rejects a long cursor, a bad encoding, a bad version, a sort that does not match, and an `after` value that misses a sort field. Header problems and field problems are separate throws. Leave that order.
- `buildCursorAfterWhere` walks the sort from the left. Each clause equals the earlier fields and compares the current field. `createCursorAfterBuilders` maps `asc` to `gt` and `desc` to `lt`. That is "strictly after this row" for both directions. The session list is where a reader meets the Drizzle columns. Do not put SQL in this package.
- `isPlainObject` stays local. It is two lines. Note 02 left the same guard local in idempotency.

## The trap

`parseListQuery` pushes `limit` and `q` onto `issues` and throws once at the bottom. `parseSort`, `parseFilters`, and `decodeCursorV1` throw as soon as they fail. A query with a bad limit and a bad sort returns only the sort error. The backend parser does the same. Do not accumulate those throws into the bottom list. That would add errors the contract tests do not return today.

## Bugs

None.

## Design question

The repeated mechanic already lives here. A feature passes an allowlist and reads a `ListQuery`. It does not parse `sort` or `cursor` itself. The session list is the first feature caller. Its note may build a cursor `after` object. It may not grow a second parser.

## Edit this acceptance allows

None.

## Next

`src/features/auth/sessions`, including the session functions in `src/features/auth/shared/`.
