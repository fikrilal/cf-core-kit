# Runtime evidence

A change that can alter runtime behaviour owes evidence that the behaviour was observed, not inferred. This is
what to capture per risk class, and what must never appear in what you capture.

## What to capture

| Risk class | Required artifacts                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **high**   | The lane's passing episode (`cfkit task verify`, `.cfkit/tasks/<id>/episodes/`), a Workers transcript for each changed route, and the credentialed lane record when the behavior needs credentials (R2 bytes, dashboard CPU). |
| **medium** | The lane's passing episode, plus the specific gate output for the changed surface (queue transition, migration apply, limiter decision).                                                                                      |
| **low**    | The lane's passing episode. A docs-only or tooling-only change says so and owes nothing further.                                                                                                                              |

A **Workers transcript** is the request and the response facts, not a screenshot:

```
POST /v1/auth/refresh            200  {"data":{…}}        X-Request-Id: 8fc1b71a-…
GET  /v1/me                      401  {code:"UNAUTHORIZED"} X-Request-Id: 3ec00512-…
scheduled 0 * * * *              jobs enqueued: auth.purgeExpiredSessions, http.purgeExpiredIdempotencyRecords
queue cf-core-kit-jobs-dev       auth.sendVerificationEmail attempt 1 -> delivered (provider 202)
db:migrate:local                 0004 applied; drift:check clean
DO limiter                       auth.logout 203.0.113.10 allowed -> blocked (Retry-After 60)
R2 presign                       PUT 200; HEAD 200 (object present); DELETE 204 (object gone)
```

## Redaction table

Everything below is replaced before an artifact is written anywhere — the diagnostics writer applies exactly
this list, and fixtures pin each pattern:

| Pattern                                   | Replaced with                      |
| ----------------------------------------- | ---------------------------------- |
| `Authorization: Bearer <token>`           | `Authorization: Bearer <redacted>` |
| bare `Bearer <token>`                     | `Bearer <redacted>`                |
| `X-Amz-Signature=…`, `X-Amz-Credential=…` | `…=<redacted>`                     |
| `re_…`, `sk_…`, `pk_…` provider keys      | `<redacted>`                       |
| `eyJ…` JWTs                               | `<redacted>`                       |
| `AUTH_SIGNING_KEYS_JSON=…` and friends    | `<name>=<redacted>`                |
| JWK private material (`"d":"…"`)          | `"d":"<redacted>"`                 |
| e-mail addresses                          | `user-<redacted>@example.com`      |

## What never appears

Prompts, reasoning, model output, raw request or response bodies, environment dumps, cookies, credentials and
connection strings. Episodes are structured precisely so these cannot be represented: an unknown key, an address
or a line break is rejected by validation rather than stored. If evidence seems to need a secret to be
convincing, the evidence is wrong — capture the _effect_ (status, header, row count, object presence) instead.

## Where it goes

Episodes and diagnostics live under the gitignored `.cfkit/tasks/<id>/` (mode 0600) and are named in the plan's
Verification section. The ledger (`operating-evidence.md`) records the reviewed summary: hashes, the exact
revision and the hosted run URL — never the artifact itself.
