# ADR: Free-Tier Budget as a First-Class Standard

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

cf-core-kit optimizes for the smallest possible operating cost: a modest project runs entirely on the Workers Free plan. The budgets are tight and shared account-wide (verified 2026-10 against Cloudflare docs):

| Resource         | Free allowance                                 | Implication                                                                |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Workers requests | 100,000/day, account-wide                      | Scarcest resource; CDN cache hits that don't invoke the Worker don't count |
| CPU              | 10ms per invocation (HTTP, cron)               | Auth-heavy requests typically use 10–20ms — hard CPU diet required         |
| Subrequests      | 50/request                                     | Per-request fan-out must stay lean                                         |
| Cron triggers    | 5 per account                                  | One fan-out cron per project                                               |
| D1               | 5M rows read / 100k rows written / 5GB per day | ~1 write/request is the sustainable envelope                               |
| KV               | 100k reads / 1k writes per day                 | Read-cache only                                                            |
| Queues           | 10k ops/day (~3.3k messages, 24h retention)    | Fast, idempotent handlers                                                  |
| Durable Objects  | 100k req/day, 13,000 GB-s/day                  | ≈ one always-active object; hibernation-first                              |
| R2               | 10GB, monthly op allowances                    | Direct client transfers via presign                                        |
| Workflows        | 3,000 steps/day                                | Adopted only when a saga needs it                                          |
| Workers Logs     | 200k events/day                                | Structured, redacted, sampled                                              |

## Decision

The budget is a versioned, normative standard (`docs/standards/free-tier-budget.md`, landing with platform core) with ten conformance rules:

1. **Request efficiency** — public GETs are CDN-cacheable by default; health checks are not polled aggressively.
2. **Write amplification** — ≤ 2–3 rows written per API write request (indexes included); batch writes; deletes count as writes.
3. **KV is read-only** — writes only via allowlisted maintenance paths, never per request.
4. **Durability via D1/DO only** — no KV, queue, or cache may be a source of truth.
5. **CPU diet** — crypto allowlist (Ed25519/ES256 first-party; RS256 verify for OIDC ID tokens; no RSA signing), zod ≥ 4.5, lazy per-route imports, no heavyweight deps.
6. **Subrequest discipline** — ≤ 10 subrequests per request by design.
7. **Cron economy** — one cron trigger per project; the account's 5 are shared.
8. **DO economy** — hibernation-first; no always-on patterns; ≤ 1 DO request per auth operation.
9. **Log economy** — structured, redacted, sampled where noisy.
10. **Budget awareness is measured** — deployed dev environment records CPU/writes per route class as evidence for medium/high-risk changes.

Mechanically checkable rules (KV write allowlist, cron count, crypto allowlist, `env` confinement, bundle size) become verify-gate checks (ADR-0008); the rest are review/evidence requirements.

## Rationale

Budgets decide architecture (state placement, background design, auth method). Making them normative with mechanical checks keeps the kit operable on free as it grows, and makes deviations explicit rather than accidental.

## Consequences

Positive: designs are validated against real limits; regressions surface in the gate or in measured evidence; the standard is re-verified when Cloudflare changes limits.

Negative: rules constrain some convenient patterns (per-request KV writes, chatty D1 writes); evidence recording is ongoing work for risk-bearing changes.

## Alternatives Considered

- Design for paid plans and document free-tier caveats — rejected: inverts the kit's goal.
- Ignore limits until they are hit — rejected: failures would surface in production, not CI.

## Links / References

- Related ADRs: ADR-0004, ADR-0007, ADR-0008
- Related docs: `docs/standards/README.md` (free-tier-budget lands with platform core)
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
