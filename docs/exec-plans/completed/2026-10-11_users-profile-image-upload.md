# users.me.profileImage.upload (endpoint 5 of 10)

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0004 (D1), ADR-0007 (R2 policy), ADR-0012 (limiters); goal: all auth + users endpoints

## Objective

Mount `users.me.profileImage.upload` (POST /v1/me/profile-image/upload, Idempotency-Key) exactly as
the family behaves: validate a declared `{ contentType, sizeBytes }`, create an `UPLOADING` stored-file
row, presign a PUT for `users/<userId>/profile-images/<fileId>`, schedule the upload-expiry job, and
answer `200 { data: { fileId, upload, expiresAt } }`.

## Behavior reference (backend-core-kit)

- Allowed content types `image/jpeg|png|webp`; `sizeBytes` 1..5,000,000 (truncated); `fileId` =
  random UUID; object key `users/<userId>/profile-images/<fileId>`; presign TTL 600 s with required
  header `Content-Type`; plan `{ fileId, upload: { method: "PUT", url, headers }, expiresAt }`.
- Errors: `USERS_OBJECT_STORAGE_NOT_CONFIGURED` 501 (storage off), `VALIDATION_FAILED` 400 with field
  issues, `UNAUTHORIZED` 401 (user missing/DELETED), `RATE_LIMITED` 429 with `Retry-After` (per-user
  20/3600 s and per-IP 60/300 s, both blocking 900 s), plus the idempotency pair
  (`IDEMPOTENCY_IN_PROGRESS`, `CONFLICT`) from the shared middleware.
- Side effects: only a `StoredFile` row (`status UPLOADING`, `purpose PROFILE_IMAGE`, bucket/key/
  contentType/sizeBytes/traceId) is created; `profile.profileImageFileId` is untouched; an expiry job
  removes the object after 7200 s if the upload was never completed.

## Design (free-tier mapping)

- `stored_files` table (owner FK cascade, `purpose`, `status` enum, bucket/objectKey unique,
  contentType, sizeBytes, uploadedAt, deletedAt, traceId, timestamps) — migration 0004.
- Storage platform gains authenticated `headObject` and `deleteObject` (SigV4 via aws4fetch, mirroring
  the existing presigner) because complete/clear and the expiry job need them; keys stay validated
  segment-wise. `presignPutObject` already exists.
- Rate limiting maps onto the DO limiter with subject-aware keys
  (`users.profile-image.upload:user:<id>` / `:ip:<address>`) and `blockSeconds` (landed with the resend
  endpoint); limits/windows come from config keys with the family defaults.
- Idempotency uses the existing middleware (`scopeKey users.me.profileImage.upload`, optional header),
  TTL 600 s to match the presign window.
- Expiry: enqueue `users.profileImage.expireUpload` with a 7200 s delay through the single work queue
  (family job name preserved); the consumer deletes the object (when storage is on) and marks the row
  `DELETED`. Inline fallback when the queue rejects the message (the API must not 500 on a failed
  bookkeeping enqueue — documented deviation from the family's best-effort enqueue).

## Acceptance Criteria

1. Storage disabled → `501 USERS_OBJECT_STORAGE_NOT_CONFIGURED`; user missing/DELETED → `401`.
2. Valid request → `200` with the plan shape; the presigned URL is a signed PUT for the exact key with
   the `Content-Type` header; a row exists `UPLOADING` with matching fields; `profileImageFileId` is
   still null.
3. Validation: bad contentType, sizeBytes 0 / >5,000,000 / non-integer, unknown fields → `400`.
4. Rate limits: over the per-user budget → `429` + `Retry-After`; IP window blocks after its limit.
5. Emitted op matches the pin; `verify` green.

## Steps

- [x] stored_files migration + repository (create/find/attach/clear)
- [x] Storage head/delete + expiry job (producer, consumer, registry)
- [x] DTO + route + limiter policies + manifest/emit + specs + verify + bookkeeping

## Decision Log

- 2026-10-11: expiry job instead of bucket lifecycle rules. -> one bucket serves dev/staging/prod
  scopes; the row is the source of truth for what may be deleted

## Verification

```bash
npm run db:generate                                   # migration 0004 (stored_files)
npx vitest run src/features/users/profile-image.spec.ts   # 5 tests: 501 gate, plan + presign + row + expiry job, validation, 429, key order
npm run contract:emit && npm run contract:check       # op emitted, parity ok
npm run verify                                        # fast profile green
```

## Completion Notes

The upload endpoint returns the family's plan shape (fileId + presigned PUT bound to `Content-Type` +
`expiresAt`) and lands the platform pieces the profile-image group needs: `stored_files`, authenticated
`headObject`/`deleteObject` on the object storage port (`allHeaders` signing so the upload's
`Content-Type` is part of the signature), the `users.profileImage.expireUpload` job (7200 s delay), and
the DO-limiter policies (user 20/h + IP 60/5 min, both blocking 900 s). Deviations recorded:
`content-length`-based verification cannot be exercised against the real R2 endpoint locally (stubbed
fetch), so the byte-level round trip is a credentialed-lane item; expiry-job enqueue failures are
logged instead of failing the request.

## Post-review fixes (2026-10-12)

- The cleanup job no longer treats a retired (`DELETED`) row as a skip: `clear`/`complete` retire the
  row _before_ enqueuing, so the old bail-out meant the R2 object was never deleted. The job now
  deletes the object for any found row and marks the row deleted idempotently; the regression test
  seeds the realistic retired state (the earlier test was theater).
- `worker.ts` now injects `objectStorageFromConfig(config)` into both job compositions (the queue
  handler previously omitted it, so background cleanup silently skipped with
  `storage_not_configured`); `WorkerJobDependencies.objectStorage` is required-typed so an omission
  is a compile error, and the worker spec dispatches a real cleanup message through `worker.queue`.
