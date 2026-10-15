# Auth: sessions, revocation and JWKS

**What it does.** Lists and revokes sessions (`GET /v1/me/sessions`, `POST /v1/me/sessions/{id}/revoke`), serves
the public key set (`GET /v1/auth/jwks`), and closes a session on logout.

**Where it lives.** `src/features/auth/sessions/` (`session.routes.ts`, `sessions.routes.ts`, `session.service.ts`,
`jwks.routes.ts`, `sweep.jobs.ts`).

**Rules the code keeps.** Revocation is checked on every refresh path before the token is inspected; the sweeper
deletes expired sessions on the hourly cron; the JWKS surface serves only public material.

**Evidence.** `sessions.spec.ts`, `session-revoke.spec.ts` (integration: revoke then refresh fails), the sweep
job spec, and the `auth.refresh-rotation` oracle.
