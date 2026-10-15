# Auth: e-mail verification

**What it does.** `POST /v1/auth/email/verification` mints a single-use token and enqueues
`auth.sendVerificationEmail`; `POST /v1/auth/email/verification/verify` consumes it (204); `resend` re-issues
within the rate policy. Tokens are hashed at rest and expire.

**Where it lives.** `src/features/auth/email-verification/` (routes, service, repository, `email-verification.jobs.ts`),
`platform/email/` for delivery.

**Evidence.** `email-verification.spec.ts` (token lifecycle), `email-verification-resend.spec.ts` (guards and the
disabled-provider path), and the integration `email-verification.spec.ts` (delivery through the composed worker)
— the `auth.email-verification-delivery` oracle.

**Note.** The job name matches the reference family's, so a queue audit reads the same on both sides.
