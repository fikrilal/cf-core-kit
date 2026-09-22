# Tail Worker / OTLP export hook, documented off by default (roadmap follow-up)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0005 (budget), ADR-0010 (deployment); roadmap Phase 6 follow-up

## Findings (live docs, pages dated 2026-10-02)

- Tail Workers: "available to all customers on the Workers Paid and Enterprise tiers" — not a
  free-tier option, so the kit cannot ship a hand-rolled OTLP forwarder.
- Workers OpenTelemetry export is the supported native path: `observability.traces`/`logs` with
  `enabled`, dashboard-configured `destinations`, `head_sampling_rate`, and `persist` (default
  true; persisted data starts contributing to Cloudflare Observability usage on 2026-12-01,
  `persist: false` exports without storing). The Tail Workers page itself recommends OTLP export
  over Tail Workers for Sentry/Grafana/Honeycomb-style destinations.

## Decision

Document, do not wire. The observability standard gains an "External export (off by default)"
section with the config sketch, the sampling and persist caveats, the paid-only Tail Worker
note, and the existing redaction anticipation (`otel_exporter_otlp_headers` is already in
`SENSITIVE_KEYS`). No `wrangler.jsonc` scope declares a destination; enabling export is a
deployment decision that must update the standard with the measured cost envelope.

## Verification

```bash
grep -c "destinations" wrangler.jsonc   # 0 — off by default in every scope
node --test scripts/ci/workflow.test.mjs   # unchanged gates green
npm run verify:ci                          # ci profile green (documentation-only change)
```
