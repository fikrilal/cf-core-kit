# Email: the Resend adapter

**What it does.** `EmailPort` is the feature-facing seam (`send`); the Resend adapter implements it over `fetch`
with the provider's HTTP API. Config decides whether email is configured at all: with no key, the port reports
disabled and the verification routes answer `500 INTERNAL` **before** any other work.

**Where it lives.** `src/platform/email/` (port, adapter, config keys `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_REPLY_TO`), consumed by `auth.email.verification.*`.

**Rules the code keeps.** No SDK: one `fetch` call, explicit status handling, and the provider key never leaves
config. `env-isolation.spec.ts` pins that the ambient test environment configures no provider, so the disabled
paths stay deterministic.

**Evidence.** The platform tests for the adapter's request shape, and the integration
`email-verification.spec.ts` for delivery through the composed worker.
