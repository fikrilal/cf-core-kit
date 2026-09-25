# auth.email.verification.resend — resend the verification email (endpoint 2 of 10)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0007 (platform service policy: queues, email module), ADR-0012 (DO limiters); goal: all auth + users endpoints

## Objective

Mount `auth.email.verification.resend` with the upstream control flow exactly, and land the email
platform module the rest of the surface needs: an email port with a Resend adapter (enabled only when
`RESEND_API_KEY` + `EMAIL_FROM` are set), the `auth.sendVerificationEmail` job (producer + consumer)
that mints the hashed token and sends the message, and the per-IP + per-user rate limiting.

## Behavior reference (backend-core-kit)

- Bearer-guarded `POST /v1/auth/email/verification/resend`, **no body**, `204`; codes `UNAUTHORIZED`,
  `RATE_LIMITED` (with `Retry-After`), `INTERNAL`.
- Control flow order is behavior: (1) email/queue not configured → **500 `INTERNAL`
  "Email is not configured"** _before_ anything else; (2) user already verified → `204`, no enqueue,
  no limiter state consumed; (3) rate limit: per-IP window (30 attempts / 300s, 900s block) then
  per-user cooldown (60s `SET NX`); (4) enqueue `{ userId, requestedAt }`; enqueue failure → 500.
- Send job: 32 random bytes base64url, store only `sha256+base64url`, TTL
  `AUTH_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS` (86400); subject `Verify your email`; body carries the
  raw token on its own line plus an optional `/verify-email?token=` link when `PUBLIC_APP_URL` is set;
  at-least-once delivery (duplicate emails possible); skip outcomes `user_not_found`,
  `already_deleted`, `already_verified` (no token created, no email sent).
- No email input and no existence oracle; unknown/deleted principal → `401 UNAUTHORIZED`.

## Design (free-tier mapping)

- Email module `src/platform/email/`: `EmailPort { isEnabled(): boolean; send(input) }` with a Resend
  HTTP adapter (fetch against the Resend API, no SDK dependency) and a disabled implementation as the
  default; config keys `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `PUBLIC_APP_URL` (all
  optional; secret keys join `SENSITIVE_KEYS`).
- Job `auth.sendVerificationEmail` on the existing queue platform: producer enqueues the envelope
  (payload `{ userId, requestedAt }`); the consumer handler in the auth feature mints the token row
  and sends via the port, returning normally for the skip outcomes. The worker registry gains the
  job; the handler takes `{ db, clock, logger, email }` through the existing job-factory pattern.
- Rate limiting maps onto the DO limiter: two new policies — IP window (30/300s, block 900s) and a
  per-user cooldown (60s) keyed by `userId` rather than address. The limiter's key shape generalizes
  from address-only to `{ kind: 'address' | 'subject', value }`; ADR-0012's mechanism is unchanged
  (same DO, same fixed windows, same fail-open), the extension is recorded in the plan and the
  ADR-0012 budget note.
- `429` stays undeclared in `x-error-codes`? No — the pin declares `RATE_LIMITED` for this operation
  (unlike the auth middlewares), so the metadata lists it and `Retry-After` accompanies 429.

## Acceptance Criteria

1. Unconfigured email → `500 INTERNAL` (checked before the verified short-circuit); configured (stub
   port) + unverified user → `204` and one enqueued job; repeated call inside the cooldown → `429`
   `RATE_LIMITED` with `Retry-After`; per-IP window blocks after 30 attempts; already-verified user →
   `204` with no job and no limiter consumption.
2. The consumer mints a hashed token (raw absent from the stored row), TTL from config, and the sent
   message carries the raw token and the `PUBLIC_APP_URL` link; skip outcomes send nothing and create
   no token.
3. Emitted operation matches the pin; `verify`/`ci` green.

## Steps

- [x] Email module (port, Resend adapter, disabled default) + config + redaction (+ specs)
- [x] Send job (producer, consumer handler, worker registry) + token minting (+ specs)
- [x] Limiter block escalation + subject-keyed policies (+ specs)
- [x] Resend endpoint + manifest move + emit + endpoint specs + verify + bookkeeping

## Decision Log

- 2026-10-11: Resend over plain fetch, no SDK. -> one POST endpoint; avoids a runtime dependency and keeps the module testable with a stub
- 2026-10-11: limiter keys generalize to address or subject. -> the upstream resend limiter is user-keyed; the DO mechanism is unchanged, only the bucket key shape grows

## Verification

```bash
npx vitest run src/platform/email/email.spec.ts                       # port: disabled, request shape, provider errors
npx vitest run src/platform/rate-limit/rate-limiter.spec.ts           # block escalation, window rollover after block
npx vitest run src/features/auth/email-verification.jobs.spec.ts      # hashing, TTL, link, skip matrix
npx vitest run src/features/auth/email-verification-resend.spec.ts    # 9 tests: guards, order, payload, 429 + Retry-After
npx vitest run test/integration/email-verification.spec.ts            # real queue delivery (consumer skip path)
# mutation probe: removing the isEnabled guard turns the not-configured spec red; revert restores green
npm run contract:emit && npm run contract:check                       # resend op emitted, parity ok
npm run verify                                                        # fast profile green
```

## Completion Notes

Landed the email platform (`EmailPort` + Resend adapter over fetch + disabled default, config keys
`RESEND_API_KEY`/`EMAIL_FROM`/`EMAIL_REPLY_TO`/`PUBLIC_APP_URL`, `RESEND_API_KEY` joins the redaction
list), the `auth.sendVerificationEmail` job (producer + consumer in the worker registry on the single
work queue, job name identical to the family), the resend endpoint with the family's exact control
flow, and the two limiter extensions it needed: subject-keyed buckets and an optional `blockSeconds`
escalation. Two faithful deviations are recorded: the transport queue name differs (single work queue,
job names preserved) and the consumer re-checks `email.isEnabled()` defensively instead of the family's
"no worker registered" wiring, which a single-queue design cannot express.

## Post-review fixes (2026-10-12)

- Limiter blocking semantics: when an advertised block elapses, the bucket resets instead of
  re-blocking on the stale count. With `blockSeconds < windowSeconds` the old behavior promised a
  retry the client could not use (each retry re-armed the block), so `Retry-After` was untruthful.
