# Section note: `src/features/users/profile-image`

- Status: Accepted. The five edits below are applied. The two bugs are not.
- Date: 2026-10-15
- Scope: upload, complete, clear, the read URL, the service, the repository, and the two cleanup jobs. `requireLiveUser` in `src/features/users/shared/guards.ts` is used as it stands. Account deletion's cleanup call is a later note.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: registration is six `app.use` calls. Complete switches on `kind`. Upload returns `UploadPlanResult`. Clear drops `objectKey`. Upload and URL return `dataPayload`.

## Verdict

This is the copy target for a capability that earns a service. ADR-0001 allows one when the operation is a multi-step rule. `createUploadPlan` and `completeUpload` are that rule: presign, head, size, content type, attach. The handlers stay the HTTP map. The repository stays the batch. The jobs stay `defineJob`. Do not inline the service back into the handlers, and do not add a second service.

Two spots are hard to read. `registerProfileImageRoutes` hides six `app.use` calls inside a loop. `completeUpload` returns six named kinds, and the handler walks them with `if` and lets `"noop"` and `"attached"` fall through.

Two bugs, neither is a taste edit. Complete calls `rejectUnknownKeys` without `captureRawJson` on that path, so the check never runs. The handler also enqueues a delete when `previousFileId` is the file just attached. Backend suppresses that case.

## What was read

| File | Lines | Role |
| --- | --- | --- |
| `profile-image.routes.ts` | 213 | four routes and registration |
| `profile-image.handlers.ts` | 234 | HTTP map, limiter, enqueue |
| `profile-image.service.ts` | 156 | plan and complete policy |
| `profile-image.repository.ts` | 206 | stored-file sequence |
| `profile-image.jobs.ts` | 206 | expire and delete jobs |
| `shared/guards.ts` | 23 | `requireLiveUser` |

Specs sampled by case name: `profile-image.spec.ts` (338), `profile-image-complete.spec.ts` (171), `profile-image-clear-url.spec.ts` (130), `profile-image.jobs.spec.ts` (220). Backend `profile-image.service.ts` `completeUpload`, `attachProfileImageFile`, and the controller were read for the previous-file rule and the unknown-key path.

Platform storage stays closed. `objectStorageFrom` throws 501 `USERS_OBJECT_STORAGE_NOT_CONFIGURED`. The upload and URL specs lock that code. The feature does not need a storage note.

## The shape to copy

**Upload.** Authenticated. `captureRawJson`, `requireAuth`, then `idempotent` with scope `users.me.profileImage.upload`. Handler: principal, unknown keys, live user, per-user limit, then per-IP limit, one service call, best-effort expiry enqueue, object envelope.

**Complete.** Authenticated. No idempotency header. One service call, map the kind, best-effort delete enqueue, `noContent()`.

**Clear and URL.** Authenticated. No body. Clear calls the repository directly. URL calls `getCurrentProfileImageFile` and presigns, or `noContent()` when there is no active file. A missing image is 204 even when storage is unconfigured. The spec locks that. The 501 happens only when a file exists and the port is disabled.

**Jobs.** `defineJob`, clock from the dependencies, skip or delete. The jobs pass should not restyle `defineJob`. Expire marks the row deleted even when storage is missing. Delete skips the row when storage is missing. Those specs lock the split.

## Hard to read

### 1. Registration is a loop

`guarded` pairs a middleware with a path, and a `for` loop calls `app.use`. The order is real, and it is also easy to miss. Complete, clear, and URL are not in the raw-body line. Upload is the only path with `captureRawJson` and `idempotent`.

Applied. Six `app.use` calls, then the four `app.openapi` calls, in the order the loop used. `guarded` and `PROFILE_IMAGE_PATHS` are gone. `captureRawJson` was not added to complete. That missing line is the bug below, and adding it changes which bodies return 400.

The idempotency TTL reads `PROFILE_IMAGE_PRESIGN_TTL_SECONDS`. The number stays 600.

### 2. Complete names four kinds and hides two

`"not_found"`, `"not_uploaded"`, `"size_mismatch"`, and `"content_type_mismatch"` throw. `"noop"` and `"attached"` fall through to 204. A seventh kind would succeed with no type error.

Applied. `CompleteUploadResult` keeps `kind`. Same status, same code, same message, same enqueue condition. `default` assigns `never` and throws `new Error`. `@typescript-eslint/only-throw-error` rejects a thrown `never`.

```ts
switch (result.kind) {
  case "noop":
    return noContent();
  case "attached":
    if (result.previousFileId !== null) {
      // existing enqueue
    }
    return noContent();
  case "not_found":
    throw new AppError({ status: 404, code: ErrorCode.NOT_FOUND });
  case "not_uploaded":
    throw new AppError({
      status: 409,
      code: ErrorCode.USERS_PROFILE_IMAGE_NOT_UPLOADED,
      message: "Upload is not available",
    });
  case "size_mismatch":
    throw new AppError({
      status: 409,
      code: ErrorCode.USERS_PROFILE_IMAGE_SIZE_MISMATCH,
    });
  case "content_type_mismatch":
    throw new AppError({
      status: 409,
      code: ErrorCode.USERS_PROFILE_IMAGE_CONTENT_TYPE_MISMATCH,
    });
  default: {
    const unreachable: never = result;
    throw new Error(
      `Unexpected profile image outcome: ${String(unreachable)}`,
    );
  }
}
```

Do not add `detail` sentences in this switch. The specs lock the code. An empty message omits `detail`. Filling it changes the JSON.

Do not add `previousFileId !== result`'s file here either. The handler does not have the new file id in `result`. The equality guard is the bug section, and it changes which job is enqueued.

### 3. The upload plan is an object or a string

`createUploadPlan` returns `UploadPlan | "not_found"`. The handler checks the string and otherwise reads `plan.fileId`. A new failure string is not a switch.

Applied, same 401 for `"not_found"`. The upload handler switches. `default` assigns `never` and throws `new Error`.

```ts
type UploadPlanResult =
  | Readonly<{ kind: "ok"; plan: UploadPlan }>
  | Readonly<{ kind: "not_found" }>;
```

The handler switches. `default` assigns `never`.

### 4. Two successes still build the envelope by hand

Applied. Upload returns `context.json(dataPayload(plan), 200)`. The URL returns `context.json(dataPayload({ url, expiresAt }), 200)`. Note 03 added the helper. This edit does not add it.

### 5. Clear reads an object key nobody uses

Applied. `clearProfileImage` no longer selects `objectKey` or returns it. The handler reads `clearedFileId` only. The delete job loads the row again by id. The response stays 204. One less read when a file is cleared. The empty result stays `{ clearedFileId: null }`.

## Correct and should stay

- Presign runs before `createStoredFile`. A deleted user returns `"not_found"` and the handler throws 401 before the expiry enqueue. The signed URL is never returned. Inserting first would leave an `UPLOADING` row when presign throws. Leave the order.
- The upload limiter is per user, then per IP. The numbers match the backend defaults: user 20 per 3600 seconds, block 900; IP 60 per 300 seconds, block 900. The spec locks "IP after user". Do not move the checks into middleware. An already-rejected user would not reach a middleware that runs before the handler, but a middleware would also run before `requireLiveUser`. Leave the consts in the handler.
- `requireLiveUser` rejects missing and `DELETED` with 401 and allows `SUSPENDED`. It returns void. Push tokens kept a local copy. That note already said not to merge them. Do not point push at this guard in this pass.
- `attachProfileImageFile` updates the file only when it is not `DELETED` and it is `UPLOADING` or `uploadedAt` is null, then points the user at it, then retires a different previous file. It does not read the file update count. A 0-row file update still moves the pointer. Backend `updateMany` does the same. Do not split the batch, and do not make the pointer conditional on the file count.
- The already-attached noop is `ACTIVE`, `uploadedAt` set, and `getCurrentProfileImageFile` returning that id. The spec locks 204 with no storage call. Backend's noop does not require `uploadedAt`. This kit's attach always sets `uploadedAt` in the same batch, so the tested path matches. Do not loosen the predicate in a taste edit.
- A failed object delete during size or content-type rejection is logged, then the row is still marked deleted. Leave that best effort.
- Upload logs a false expiry enqueue and still returns the plan. Complete and clear ignore a false delete enqueue. The previous row is already `DELETED` inside the attach or clear batch. The job only removes the object. A 500 after that batch would make a retry take the noop path and skip the enqueue. Do not fail the request on a false enqueue.
- `expiresAt` is `new Date(clock.now().getTime() + ttlSeconds * 1000)`. The instant comes from the clock. Do not add a helper for that addition.
- `Math.trunc` on `sizeBytes` stays. The schema truncates too. The spec locks a fractional upload.
- Account deletion nulls `profileImageFileId` in its own repository. That note owns the call. Do not move it here.

## Bugs

Complete's unknown-key check is dead. The handler calls `rejectUnknownKeys(rawJsonOf(context), ["fileId"])`. `registerProfileImageRoutes` never calls `captureRawJson` on `/v1/me/profile-image/complete`. `rawJsonOf` is then `undefined`, and `rejectUnknownKeys` returns on a non-object. Zod strips the extra field, so the request still completes. Upload rejects an extra field because that path does capture the body. Note 01 made `rejectUnknownKeys` the unknown-key policy. The fix is the missing `app.use` on the complete path. Extra fields then return 400 `VALIDATION_FAILED`. That is a status change, so it is not in the taste list.

The delete enqueue does not compare the previous id with the file just attached. Backend `completeUpload` returns null when `previousFileId` is missing or equal to `input.fileId`, and the controller only then enqueues. This handler enqueues for every non-null previous id. The sampled noop test never reaches that line: an active current file returns `"noop"` first. The equal-id path is the one the backend still guards. A bug note should skip the enqueue when the ids match. The tested 204 stays. The change is which job is sent, so it is not a taste edit.

## Design question

The service keeps presign, head, and attach policy. The repository keeps the batch. The handler keeps the limiter and the queue, because those depend on the request. Platform storage keeps signing and the 501. The jobs keep object deletion.

## Edit this acceptance allows

When this note is accepted, and not before:

1. Unroll `registerProfileImageRoutes` into `app.use` calls. Same middleware, same paths. The idempotency TTL reads `PROFILE_IMAGE_PRESIGN_TTL_SECONDS`.
2. The `result.kind` switch in `createCompleteProfileImageHandler`, with the enqueue condition unchanged.
3. `UploadPlanResult` and the switch in the upload handler.
4. Drop `objectKey` from `clearProfileImage`.
5. The upload and URL successes use `dataPayload` only after note 03 has added it.

No change to status codes, error codes, the batch statements, or the job skip rules. The complete raw-body fix and the equal-id enqueue fix are not in this list.

## Verification

`npx vitest run src/features/users/profile-image/profile-image.spec.ts src/features/users/profile-image/profile-image-complete.spec.ts src/features/users/profile-image/profile-image-clear-url.spec.ts src/features/users/profile-image/profile-image.jobs.spec.ts`

20 tests passed. `npx eslint` and `npx prettier --check` on `profile-image.routes.ts`, `profile-image.handlers.ts`, `profile-image.service.ts`, and `profile-image.repository.ts` passed. `npx tsc --noEmit` exited 0.

## Next

`_WIP/readability/10-features-users-account-deletion.md`. It already calls the profile-image cleanup producer. It must not reshape that producer. The complete raw-body bug and the equal-id enqueue stay out of that note.
