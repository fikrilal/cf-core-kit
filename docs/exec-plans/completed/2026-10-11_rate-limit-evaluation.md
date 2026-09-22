# Native rate-limiting binding evaluation (roadmap follow-up)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0012 (auth rate limiting via DO counters); roadmap Phase 6 follow-up

## Objective

Evaluate Cloudflare's native Rate Limiting binding as a swap candidate for the
`AuthRateLimiter` Durable Object counters and record the decision with sources.

## Findings (live docs, page dated 2026-04-23)

Facts that support a swap:

- No network round trip in the request path — "the underlying counters are cached on the same
  machine that your Worker runs in"; the binding is faster than a DO hop, which for far-away
  clients crosses colos.
- Config is declarative per binding (`simple: { limit, period }`), and multiple bindings per
  Worker are supported (one per policy would be possible).
- The binding shares the WAF rate-limiting infrastructure and needs no storage writes.

Facts that block a swap at this bar:

- **Locality**: "Rate limits … are local to the Cloudflare location that your Worker runs in
  … For each unique key you pass to your rate limiting binding, there is a unique limit per
  Cloudflare location." A per-address auth limit therefore multiplies with the number of
  locations an attacker spreads across — the opposite of what protects credential endpoints.
- **Accuracy**: "the Rate Limiting API is permissive, eventually consistent, and intentionally
  designed to not be used as an accurate accounting system." Our limiter is a security control
  for auth operations; "permissive and eventually consistent" is a documented downgrade.
- **No retry signal**: `limit()` returns only `{ success }`; there is no `Retry-After` value, and
  ADR-0012's 429 contract carries `Retry-After`. Substituting a fixed or fabricated value would
  be dishonest.
- **Key guidance**: the docs recommend against IP-address keys ("many users may share a single
  IP"); the auth limiter is deliberately address-keyed because the endpoints are
  unauthenticated — a documented tension, not a blocker, but it means the binding's best
  practices and our threat model do not line up.
- The page states no free-plan gating; it also does not promise plan availability, so no
  free-tier claim is made either way.

## Decision

Keep the Durable Object counters (ADR-0012). The binding stays a documented swap candidate for
non-security rate limiting (per-user product quotas) where per-location eventual consistency is
acceptable, and the evaluation should be revisited if any of these change:

1. Cloudflare documents account-wide (non-per-location) counters for the binding;
2. `limit()` exposes a retry/timeout signal that can back a `Retry-After` header honestly;
3. the DO budget (requests/day or GB-s/day) becomes the binding constraint for the limiter.

## Costs of the status quo (recorded for the revisit)

- One DO request per auth operation (ADR-0007 budget note); cross-colo hop for far clients.
- DO SQLite-backed class + migration in `wrangler.jsonc` (the only DO in the kit).

## Verification

```bash
# Evaluation only: no code changed. Evidence: the fetched documentation quotes above
npm run verify:ci   # unchanged and green (nothing touched by this task)
```
