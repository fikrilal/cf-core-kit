# users.me.profileImage.url (endpoint 8 of 10)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: goal: all auth + users endpoints

## Objective

Mount `users.me.profileImage.url` (GET /v1/me/profile-image/url): return a short-lived presigned GET for
the current image, `204` when there is none.

## Behavior reference (backend-core-kit)

- Resolves the pointer first: no image → `204` **even when storage is disabled**; image present but
  storage disabled → `501 USERS_OBJECT_STORAGE_NOT_CONFIGURED`; otherwise
  `200 { data: { url, expiresAt } }` with a 900 s presign TTL. Only `ACTIVE` files resolve (a stale
  pointer reads as no image).

## Acceptance Criteria

1. No image → `204` (empty body); with image → `200` with a signed GET url and `expiresAt = now + 900 s`.
2. Storage disabled: no image → `204`, image present → `501`.
3. Integration flow: the signed URL downloads the exact bytes that were uploaded.
4. Emitted op matches the pin; `verify` green.

## Steps

- [x] Resolver (pointer → ACTIVE file) + presign GET + route + specs + verify + bookkeeping

## Verification

```bash
npx vitest run src/features/users/profile-image-clear-url.spec.ts  # url: 204 without image (even unconfigured), 200 signed GET (900 s), 501 with image and no storage
npm run contract:emit && npm run contract:check                    # op emitted, parity ok
npm run verify                                                     # fast profile pass
```

## Completion Notes

The URL resolver reads the pointer first (stale pointers read as no image) so the no-image 204 does not
depend on storage configuration; with an ACTIVE file the endpoint returns a 900 s presigned GET.
