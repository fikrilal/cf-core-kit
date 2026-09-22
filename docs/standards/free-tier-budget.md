# Free-tier budget (normative)

Status: normative (landed 2026-10-11). These are hard rules: the kit is built to run on the
Workers Free plan, and `budget:check` (plus the review dimension it mirrors) enforces them.

## Platform envelope (verified against the live docs, pages dated 2026-10-08 / 2026-04-21)

| Limit            | Workers Free                                   | Consequence for this kit                                                   |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Requests         | 100,000/day                                    | probes are cheap; the app is not a proxy                                   |
| CPU time         | 10 ms per request and per cron trigger         | handlers orchestrate; cron fans out, never processes                       |
| Subrequests      | 50 per request (platform cap)                  | the kit designs to ≤ 10                                                    |
| Cron triggers    | 5 per account                                  | one per project (ADR-0007)                                                 |
| D1 rows read     | 5 million/day                                  | indexed lookups only; no unbounded scans                                   |
| D1 rows written  | 100,000/day (index writes count)               | 2–3 rows per API write including index amplification (ADR-0004)            |
| D1 storage / DBs | 5 GB / 10 databases                            | one database per environment                                               |
| Durable Objects  | 100,000 requests/day, 13k GB-s/day             | one request per auth operation; no always-on patterns (ADR-0007, ADR-0012) |
| KV writes        | ~1,000/day                                     | KV is read-only territory; writes only in allowlisted maintenance paths    |
| Queues           | 10,000 operations/day, fixed 24-hour retention | ~3 ops per delivered message; one queue + DLQ; ID-only payloads (ADR-0007) |
| Worker size      | 64 MiB platform cap                            | the kit budget is 2048 KiB                                                 |
| Log data         | 256 KB per request                             | one line per request/job (observability standard)                          |

## The kit's budgets

| Rule                    | Budget                                                                                                                                                                     | Enforced by                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Bundle size             | ≤ 2048 KiB upload                                                                                                                                                          | `budget:check` rule `bundle` (dry-run parse)   |
| Crypto                  | WebCrypto only; `crypto.subtle` inside `src/platform/`                                                                                                                     | `budget:check` rule `crypto`                   |
| Env access              | `context.env` only in `src/platform/` + `src/app.ts`                                                                                                                       | `budget:check` rule `env`                      |
| KV                      | any access requires an allowlist entry                                                                                                                                     | `budget:check` rule `kv`                       |
| Cron                    | ≤ 1 trigger per scope (root + every environment)                                                                                                                           | `budget:check` rule `crons`                    |
| Queues                  | one work queue + DLQ per scope; `max_batch_size ≤ 10`, `max_batch_timeout ≤ 10s`, `max_retries ≤ 5`; work consumer declares the DLQ; names pinned to the platform prefixes | `budget:check` rule `queue`                    |
| Queue binding           | `env.JOBS` only in `src/platform/` and the composition roots                                                                                                               | `budget:check` rule `queue` (confinement)      |
| Signing dependency      | `aws4fetch` only in `src/platform/storage/`                                                                                                                                | `budget:check` rule `storage`                  |
| Logging                 | `console.*` only in `src/platform/logging/`                                                                                                                                | `budget:check` rule `logging`                  |
| Log economy             | one line per request (probes excluded), one per job, one per batch/sweep                                                                                                   | observability standard, spec-asserted (counts) |
| Rows per API write      | 2–3 rows including index amplification                                                                                                                                     | ADR-0004 + review dimension (no static gate)   |
| Enqueues per write path | one                                                                                                                                                                        | standard (queues-jobs)                         |
| Sweep batch             | 50 rows per run, ordered subquery                                                                                                                                          | standard (queues-jobs) + handler specs         |

## Measured envelopes (evidence, not estimates)

- Bundle: 1218 KiB of the 2048 KiB budget (`budget:check`, every run).
- Startup: 17 ms in the preview-lane deploy (1.13 evidence).
- Local wall-clock per route class (3.8 evidence, server-side p50): me/sessions/revoke 3 ms,
  PATCH 6 ms, refresh 7 ms; curl p50 within 3–10 ms across the auth + users surface.
- First sign-in writes 4 rows (user, identity, session, token) — the documented exception to the
  2–3 row target; repeat sign-in writes 2–3.
- Sweeps delete ≤ 50 rows per run; batch/refresh/lifecycle writes measured at ≤ 3 rows.

## Keeping the numbers honest

- Re-measure before quoting: the credentialed lane (dashboard CPU per route class after a real
  deploy) is tracked in the 3.8 plan; local numbers are labeled as wall-clock proxies.
- When a measurement changes, update this standard with the measurement, not with an estimate,
  and record the evidence in the task's exec plan.
- New budget rules land in `budget:check` with fixtures (probe both directions) before they are
  described here.
