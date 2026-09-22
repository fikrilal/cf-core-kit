# Observability (normative)

Status: normative (landed 2026-10-11, task 4.4). Pins the logging behavior this kit already
has; every rule below is either budget-enforced or spec-asserted.

## Logging

- One structured JSON line per unit of work, through the single platform logger
  (`src/platform/logging/logger.ts`). `console.*` outside that module fails `budget:check` —
  leveling and redaction cannot be bypassed.
- Levels: `debug` for internal detail (per-message job processing), `info` for lifecycle
  (request, job, batch summary, sweep run), `warn` for client errors and retryable noise,
  `error` for server errors, failed jobs, and dead letters.
- Economy: exactly one line per HTTP request, one per processed job, one summary line per queue
  batch and per sweep run. Probe paths (`/health`, `/ready`) log nothing. No per-entity logging
  inside loops. The platform caps log data at 256 KB per request.
- Redaction: fields whose lowercased key is in `SENSITIVE_KEYS` (credentials, tokens, signing
  material, the R2 secret) are replaced with `[Redacted]` centrally; never log request or
  response bodies, tokens, or secrets.

## Trace continuity

- Every line carries `requestId` (HTTP) or `traceId`/`jobId` (jobs); nothing logs without one.
- `X-Request-Id` is honored when supplied (bounded, safe charset) and generated otherwise; the
  same value is echoed on the response, rendered as the problem `traceId`, and logged.
- Jobs carry the originating id in the envelope: request ids for request-originated work,
  `cron:<scheduledFor>` for scheduled ticks; the DLQ logs each dead letter with its envelope
  identity and attempt count.

## Workers and jobs

- Handlers build the logger from the runtime config (`APP_ENV`, `LOG_LEVEL`) per invocation;
  `LOG_LEVEL=debug` is rejected in prod by config validation.
- Queue batches log one summary line (`queue batch processed`) with per-outcome counts and
  duration; individual failures log one error line each with job, jobId, traceId, and attempt.

## External export (off by default)

The kit ships **no** external telemetry destinations; Workers Logs (the `observability.enabled`
block in `wrangler.jsonc`) is the only sink. Adoption paths, in the order Cloudflare recommends:

- **OpenTelemetry export (preferred)**: `observability.traces` / `observability.logs` with
  `destinations` names configured in the dashboard, an explicit `head_sampling_rate`, and
  `persist: false` unless Cloudflare-side storage is wanted — persisted data starts contributing
  to Cloudflare Observability ingestion and storage usage from 2026-12-01, so the free-tier
  answer is export-without-persist or nothing. Destination credentials live in the dashboard
  configuration, never in this repository.
- **Tail Workers (not available here)**: the docs state Tail Workers are "available to all
  customers on the Workers Paid and Enterprise tiers", so a hand-rolled OTLP forwarder on the
  free tier is not an option. `SENSITIVE_KEYS` already covers `otel_exporter_otlp_headers` in
  case a paid deployment adds one.
- What stays in-repo either way: structured one-line logs with `requestId`/`traceId` (above), so
  any destination receives correlated events without extra instrumentation.

Turning export on is a deployment decision per environment (ADR-0010); it is not wired in any
`wrangler.jsonc` scope today, and a task enabling it must update this section with the measured
cost envelope.

## Definition of done for new logging

- The rule the log line serves is visible in its level and message; no free-form debug output
  ships.
- Any new line-count or level behavior is covered by a spec assertion (counts, not presence)
  or it does not exist yet.
