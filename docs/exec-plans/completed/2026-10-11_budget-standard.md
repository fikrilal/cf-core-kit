# Free-tier budget standard

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0010 (deployment environments and rollback); roadmap Phase 6 follow-up

## Objective

`docs/standards/free-tier-budget.md` lands: the normative budget rules this kit has been
enforcing since Phase 1, each mapped to its enforcement (budget:check rule id, ADR, or the
standard itself), plus the measured envelopes from the recorded evidence — closing the
`free-tier-budget` row on the standards index.

## Content

- Platform facts (verified 2026-10-11), with the free-tier numbers this kit is built around:
  requests 100k/day, CPU 10ms per request and per cron trigger, 50 subrequests/request, 5 cron
  triggers/account, D1 100k rows written/5M read per day, DO 100k requests/day + 13k GB-s/day,
  KV 1k writes/day, queues 10k ops/day with fixed 24h retention, 64 MiB worker size cap.
- The kit's budgets (self-imposed, stricter than the platform) with enforcement:
  bundle ≤ 2048 KiB (`budget:check` `bundle`), one cron (`crons`, per scope), ≤ 10 subrequests
  per request by design, one enqueue per write path, KV writes allowlisted (`kv`), ≤ 2–3 rows
  written per API write (ADR-0004, review-enforced), retention/latency envelopes.
- Measured envelopes (from 1.13 and 3.8 evidence): startup 17ms preview lane, bundle 1218 KiB,
  per-route p50 wall-clock 3–10ms local, sweep batch 50 rows, queue consumer default bounds
  (10 messages / 5s / 3 retries).
- How to keep the numbers honest: run `npm run verify:ci` (budget step), re-measure when the
  credentialed lane allows, and update this standard with the measurement, never with a guess.

## Acceptance Criteria

1. The standard exists, every rule names its enforcement or marks itself advisory, numbers
   carry their source (measured where measured, platform-documented otherwise).
2. The standards index marks `free-tier-budget` normative; `verify:ci` green.

## Steps

- [x] Write the standard + index row

## Verification

```bash
npm run drift:check   # links + map + ADR index green with the new standard
npm run verify:ci     # ci profile green
# platform numbers re-verified against the live pages this session: workers limits
#   (100k requests, 10 ms CPU per request/cron, 50 subrequests, 5 crons, 64 MiB, 256 KB logs),
#   D1 pricing (5M rows read / 100k rows written per day, 5 GB, index writes count),
#   queues pricing/limits (10k ops/day, fixed 24h retention)
- [x] Verify + bookkeeping

## Decision Log

- 2026-10-11: rules name their enforcement. -> a standard that cannot be checked is advice; this kit's are gates
```
