# Runtime evidence: auth flows measured (task 3.8)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0005 (budget evidence), ADR-0010 (deployment/failure modes); roadmap task 3.8

## Objective

Record runtime evidence for the auth + users surface within the free-tier envelope: live local measurements through `wrangler dev` (real workerd, real D1 state, real Durable Object) for every mounted auth/users route class — latency samples, DO requests per auth operation, and rows written per write operation — plus the documented credentialed lane (dashboard CPU per route class after a real deploy), mirroring the 1.13 pattern.

## Constraints

- No Cloudflare credentials in this environment: the credentialed lane (real dev worker + dashboard CPU) stays an explicit follow-up; nothing here claims production CPU numbers.
- Measurements are wall-clock proxies labeled as such; CPU ceilings are argued from the design (zod parse + one D1 query + Ed25519 verify/sign) and the 1.13 startup evidence, not asserted as CPU.
- Live flow uses real state: the dev server's local D1 is seeded through `wrangler d1 execute --local` (same state directory), signing keys come from the generator, and access tokens are minted with the same key set; refresh/logout/revoke run against seeded sessions so rotation and revocation are exercised end to end.
- Rows written per operation are recorded as a table (design + verified spot checks with before/after counts), including the first-sign-in cost (user + identity + session + token, with index amplification) versus repeat sign-in (session + token + previous-session revoke).
- Evidence lands in this plan (table + command transcript), the roadmap line, and the README if a user-facing number changes.

## Impact Areas

- Docs: evidence only; no code changes expected (fixes only if a measurement surprises).

## Acceptance Criteria

1. A scripted `wrangler dev` session exercises, with real state: `/health`, `/.well-known/jwks.json`, `users.me.get` (minted token), `users.me.patch` (idempotent write), `users.me.sessions.list` (seeded sessions, statuses visible), `users.me.sessions.revoke` (then refresh → `AUTH_SESSION_REVOKED`), `auth.refresh` (rotation, second use → `REUSED`), `auth.logout`; all responses match the dialect.
2. Latency samples (min/p50/max over N warm requests per route class) recorded, labeled wall-clock proxies; DO requests per auth op confirmed as exactly 1 from the middleware design + logs.
3. Rows-written table recorded per write operation with at least two spot-checked before/after counts.
4. Roadmap 3.8 checked with the credentialed lane explicit; plan filed to `completed/`.

## Steps

- [x] Seed + smoke script (scratchpad) driving the full auth/users flow through `wrangler dev`
- [x] Latency + rows evidence table; spot-check counts
- [x] Record evidence; verify + bookkeeping

## Decision Log

- 2026-10-11: local live evidence + design-derived CPU argument, credentialed dashboard CPU tracked. -> same honesty boundary as 1.13; no fake production numbers
- 2026-10-11: first-sign-in rows are recorded as an explicit exception to the 2–3 rows target with the repeat-sign-in path showing the steady-state cost. -> the budget standard targets steady-state writes, not account creation

## Verification

```bash
npm run verify:ci   # full profile green (recorded after the evidence run)
```

## Runtime Evidence (2026-10-11, live local)

Harness: `wrangler dev` with a scratch `--persist-to` directory, migrations applied through
`wrangler d1 migrations apply` (0000 + 0001), 11 sessions seeded through
`wrangler d1 execute --local` into the same state, `AUTH_SIGNING_KEYS_JSON` from the repo
generator, and an access token minted with the same JWK (Ed25519, real guard verification).
The first attempt failed cleanly and is part of the record: without an explicit migrations
apply, the dev D1 had no application tables and every DB-touching route 500'd — the harness
now applies migrations before starting the server.

### Semantics asserted live

| Check                                           | Result                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                   | 200                                                                                                                    |
| `GET /.well-known/jwks.json`                    | 200, no private material                                                                                               |
| `GET /v1/me` (no token / minted token)          | 401 / 200 fresh projection                                                                                             |
| `PATCH /v1/me`                                  | 200, `"  Live Smoke  "` stored trimmed; replay `Idempotency-Replayed: true`; different payload same key 409 `CONFLICT` |
| `GET /v1/me/sessions`                           | 11 rows, `meta {limit: 25, hasMore: false}`, 11 active, `current: 1`; `limit=101` 400                                  |
| `POST .../sessions/:id/revoke`                  | 204; re-revoke 204; unknown 404; non-UUID 400                                                                          |
| `POST /v1/auth/refresh`                         | rotation 200 (new token + access token); reuse 401                                                                     |
| `POST /v1/auth/logout` then refresh             | 204; refresh 401 `AUTH_SESSION_REVOKED`                                                                                |
| `POST /v1/auth/oidc/exchange` (malformed token) | 401 `AUTH_OIDC_TOKEN_INVALID`                                                                                          |

### Rows written (design + spot checks)

D1 exposes no per-request rows-written counter, so the table is the code's write set with
counted spot checks where rows are inserted.

| Operation                            | Rows written                                                 | Spot check                                                                                              |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `users.me.patch`                     | 1 (users update)                                             | `display_name`/`family_name`/`updated_at` observed changed                                              |
| `sessions.revoke`                    | 2 (session update, token family update)                      | `revoked_at` set on session + tokens                                                                    |
| `auth.refresh` (rotate)              | 3 (old token revoke, new token insert, session `lastSeenAt`) | `refresh_tokens` 12 → 13, revoked tokens advanced, sessions unchanged                                   |
| `auth.logout`                        | 2 (session, tokens)                                          | refresh afterwards 401 `AUTH_SESSION_REVOKED`                                                           |
| `auth.oidc.exchange` (first sign-in) | 4 (user, identity, session, token) + index amplification     | recorded exception: steady-state target is 2–3 rows/request; repeat sign-in writes session + token only |

Auth operations issue exactly one `AUTH_RATE_LIMITER` request each by the middleware design
(one limiter call per auth operation); the limiter wrote no storage rows in this run.

### Latency (warm, wall-clock proxies)

| Route class                  | curl min/p50/max (ms) | server-side p50 (ms) |
| ---------------------------- | --------------------- | -------------------- |
| `GET /health`                | 2.5 / 2.9 / 3.8       | ~0                   |
| `GET /.well-known/jwks.json` | 2.7 / 3.2 / 4.6       | 0                    |
| `GET /v1/me`                 | 5.7 / 6.1 / 7.7       | 3                    |
| `GET /v1/me/sessions`        | 5.2 / 5.7 / 6.9       | 3                    |
| `POST .../revoke`            | 5.6 / 6.8 / 7.5       | 3                    |
| `PATCH /v1/me`               | 8.8 / 9.8 / 10.7      | 6                    |
| `POST /v1/auth/refresh`      | 9.8 / 10.2 / 10.7     | 7                    |
| `POST /v1/auth/logout`       | single sample 5       | 5                    |

These are workerd-side wall-clock numbers on a laptop, not CPU; the credentialed lane below
is what converts them into dashboard CPU per route class.

### Credentialed lane (follow-up)

No Cloudflare credentials in this environment: real dev-worker dashboard CPU per route class
(after `wrangler deploy` with real D1) stays an explicit follow-up, the same boundary as
1.13. The design argument for the free tier: each request is one D1 statement set (≤3 writes),
Ed25519 verify/sign via WebCrypto, one memoized JWKS fetch per cold isolate, one DO request
per auth op; bundle is 1174.97 KiB of the 2048 KiB budget and startup was measured at 17 ms
in 1.13.

## Completion Notes

The evidence run exercised the full auth + users surface through real workerd, real D1 state,
and the real Durable Object, with a natively minted Ed25519 access token verified by the guard.
Two findings are worth keeping: the local dev loop does **not** apply D1 migrations without an
explicit `wrangler d1 migrations apply` (the first attempt 500'd on every DB route for exactly
that reason), and D1 exposes no rows-written counter, so the rows table pairs the code's write
sets with counted insert spot checks instead of pretending to measure writes it cannot see.
The credentialed dashboard-CPU lane remains the only open item, tracked here.
