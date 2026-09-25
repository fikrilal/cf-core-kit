# users.me.profileImage.clear (endpoint 7 of 10)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: goal: all auth + users endpoints

## Objective

Mount `users.me.profileImage.clear` (DELETE /v1/me/profile-image): clear the current profile image and
answer `204`, idempotently.

## Behavior reference (backend-core-kit)

- Guarded; `204` always (`UNAUTHORIZED`/`INTERNAL` are the only declared errors). Clearing nulls
  `profile.profileImageFileId`, marks the stored file `DELETED` + `deletedAt`, and best-effort enqueues
  `users.profileImage.deleteStoredFile` for the object (inline delete when the queue is unavailable).
  No storage-configured requirement: clearing works with storage disabled.

## Acceptance Criteria

1. With an attached image: `204`, pointer null, row `DELETED`, cleanup enqueued (job shape asserted).
2. Without an image: `204`, no job, no storage call.
3. `/v1/me/profile-image/url` afterwards answers `204`.
4. Emitted op matches the pin; `verify` green.

## Steps

- [x] Repository clear transaction + cleanup enqueue + route + specs + verify + bookkeeping

## Verification

```bash
npx vitest run src/features/users/profile-image-clear-url.spec.ts  # clear: retire + enqueue, idempotent, no storage needed
npm run contract:emit && npm run contract:check                    # op emitted, parity ok
npm run verify                                                     # fast profile pass
```

## Completion Notes

Clear works with storage disabled, nulls the pointer, retires the row, and enqueues the object
cleanup job only when a file was cleared.

## Post-review fixes (2026-10-12)

- Cleared objects are actually removed from R2 now: the cleanup job deletes objects for rows the clear
  transaction already retired (see the upload plan's note), and the worker injects the storage client
  into the queue handler.
