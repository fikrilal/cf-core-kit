# ADR: Auth Rate Limiting via Durable Object Counters

- Status: Accepted
- Date: 2026-10-11
- Decision makers: Core kit maintainers

## Context

Auth endpoints are the abuse surface of the kit: an unauthenticated OIDC exchange plus token refresh/logout. The free-tier budgets forbid the usual counter stores — KV writes are capped at 1k/day and are not a write path; D1 counters would add a write row (with index amplification) to every auth request; in-isolate counters survive neither isolate lifetime nor cross-colo traffic and are trivially bypassed. ADR-0007 already scoped Durable Objects to "rate-limit counters for auth paths; ≤ 1 DO request per auth operation; no always-on patterns".

## Decision

- One hibernating `AuthRateLimiter` Durable Object class holds fixed-window counters entirely in memory — no `storage.*` writes. Each policy-and-address bucket is addressed as its own small object (exactly one bucket per object), so memory stays trivially bounded without a shared registry. An eviction or hibernation resets counters; limiting is best-effort by construction and documented as such. Requests without a client address (non-edge callers, local development) are skipped rather than pooled into a shared bucket; the edge always sets `CF-Connecting-IP`.
- Each auth operation costs at most one DO request. The middleware asks one policy bucket per request; when the object errors it **fails open** with an error-level log — an auth outage caused by a limiter outage is worse than a temporary abuse window.
- Policies are per route and per client address (`CF-Connecting-IP`; no emails, tokens, or other PII in DO keys): exchange/connect 20 per minute, refresh/logout 60 per minute. These are behavior-layer constants, adjustable without contract impact. JWKS is not rate-limited (public, cacheable).
- Exceeding a window returns the dialect's `429 RATE_LIMITED` problem with `Retry-After`. That 429 is a platform-safety response and is intentionally **not** added to the operations' `x-error-codes` — exact parity with the pinned snapshot is preserved, in the same spirit as Cloudflare's own 1027/1015 responses.

## Rationale

Budgets decide placement (ADR-0007): counters need atomic coordination that neither KV nor D1 can provide within the free tier, and the abuse surface is small and well-defined (four auth routes, per-IP windows). One DO request per auth call keeps the cost bounded and predictable, and failure isolation keeps the auth path itself independent from the limiter.

## Consequences

Positive: abuse ceilings with zero per-request storage writes; a known, small budget delta — one DO request per auth operation against the shared 100k/day Durable Object request allowance, and no always-on duration, so the 13k GB-s/day budget is untouched; the dialect stays exactly spec-shaped while still shedding abuse traffic.

Negative: counters reset on eviction (best-effort); the undeclared 429 is a documented platform-safety deviation.

## Alternatives Considered

- KV counters — rejected: 1k writes/day, eventual consistency, and KV is read-only territory (ADR-0007).
- D1 counters — rejected: doubles write amplification on every auth request.
- In-isolate counters — rejected: no cross-isolate or cross-colo coordination; trivially bypassed.
- Native rate-limiting binding — deferred: tracked as the cross-cutting swap candidate; the `RateLimiterPort` seam keeps the swap local.

## Links / References

- Related ADRs: ADR-0005, ADR-0006, ADR-0007, ADR-0008
- Related docs: `docs/standards/README.md` (free-tier-budget standard follow-up), `README.md`
