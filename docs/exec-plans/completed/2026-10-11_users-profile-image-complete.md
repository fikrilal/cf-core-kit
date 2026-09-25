# users.me.profileImage.complete (endpoint 6 of 10)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: goal: all auth + users endpoints

## Objective

Mount `users.me.profileImage.complete` (POST /v1/me/profile-image/complete): verify the uploaded object
against the declared metadata, attach it as the profile image, and answer `204`.

## Behavior reference (backend-core-kit)

- Body `{ fileId: uuid }`; `404 NOT_FOUND` when the file is missing or owned by someone else; early
  `204` (no storage call, no attach) when the file is already `ACTIVE` and attached to the caller;
  `409 USERS_PROFILE_IMAGE_NOT_UPLOADED` when the row is `DELETED` or `headObject.exists === false`;
  `409 USERS_PROFILE_IMAGE_SIZE_MISMATCH` / `CONTENT_TYPE_MISMATCH` (after deleting the object and
  marking the row `DELETED`); `501 USERS_OBJECT_STORAGE_NOT_CONFIGURED`.
- Attach (transaction): row → `ACTIVE` + `uploadedAt` (guarded on `UPLOADING`/`uploadedAt null`),
  `user.profileImageFileId = fileId`, previous file → `DELETED` + `deletedAt`; the previous file's
  object is deleted by the `users.profileImage.deleteStoredFile` job (deterministic jobId per file).

## Acceptance Criteria

1. Full flow: upload → PUT the object (signed) → complete → `/v1/me` shows the fileId → url returns a
   readable URL; replay of complete is a no-op `204`.
2. `404` for unknown/foreign fileId; `409` for missing object, size mismatch, content-type mismatch
   (each rejection deletes the object and marks the row `DELETED`).
3. Previous image replaced in one transaction and its object cleanup enqueued.
4. Emitted op matches the pin; `verify` green.

## Steps

- [x] Repository attach/clear transactions + head verification + specs
- [x] DTO + route + manifest/emit + integration flow + verify + bookkeeping

## Verification

```bash
npx vitest run src/features/users/profile-image-complete.spec.ts   # attach/replace/no-op/404/409 matrix
npm run contract:emit && npm run contract:check                    # op emitted, parity ok
npm run verify                                                     # fast profile pass
```

## Completion Notes

Complete verifies the object via `headObject` (size and content-type), rejects with the family's 409
codes after deleting the object and retiring the row, attaches atomically (row → ACTIVE, pointer
updated, previous file retired in one batch), and enqueues `users.profileImage.deleteStoredFile` for the
replaced object. An already-attached ACTIVE file short-circuits without a storage call.

## Post-review fixes (2026-10-12)

- Replaced images are actually removed from R2 now: the cleanup job deletes objects for rows the
  attach transaction already retired (see the upload plan's note), and the worker injects the storage
  client into the queue handler.
