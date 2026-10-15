# Auth: token refresh and idempotent retries

**What it does.** `POST /v1/auth/refresh` rotates the refresh token exactly once: the old token is retired to a
replacement, a replayed token is treated as **reuse** and revokes the whole session, and every active token in it
goes with it. The same client contract covers retries: a retryable write carrying an `Idempotency-Key` executes
once and replays its stored response with `Idempotency-Replayed: true`.

**Where it lives.** `src/features/auth/sessions/session.service.ts` (`rotateRefreshToken`, `classifyRefresh`),
`src/platform/http/idempotency.core.ts` and `idempotency.service.ts`.

**Evidence.** `refresh.spec.ts` (rotation, reuse, expiry ordering, one-rotation-wins under concurrency) and the
end-to-end `refresh-rotation.spec.ts` plus `idempotent-write.spec.ts` — both oracles
(`auth.refresh-rotation`, `http.idempotent-write`).

**Why it is bound.** Reuse detection is the reason the refresh token is single-use; the integration suite asserts
the revoked session row and that no active token remains, not just the 401.
