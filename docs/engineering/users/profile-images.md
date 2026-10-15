# Users: profile images

**What it does.** `POST /v1/me/profile-image/upload` presigns a PUT, `POST …/complete` attaches the object,
`DELETE …` clears it, and `users.profileImage.expireUpload` / `deleteStoredFile` keep storage honest. Exactly one
object stays live per user; every replaced or finalised object is deleted.

**Where it lives.** `src/features/users/profile-image/` (routes, handlers, repository, jobs),
`src/platform/storage/presign.ts` for the signed requests.

**Rules the code keeps.** The presign is content-type bound; HEAD/DELETE are authenticated; the cleanup job
deletes on both `UPLOADING` and `DELETED` rows (a row retired before enqueueing must still have its object
removed — the bug a review round caught here), and account finalisation enqueues a deletion for the avatar.

**Evidence.** `profile-image*.spec.ts` (signed requests against a fetch stub, the jobs' deletion paths),
`account-deletion.spec.ts` for the finalisation hand-off, and the `users.profile-image-object-lifecycle` oracle
(pending: the byte-level R2 round trip is a credentialed lane).
