# Standards completion: kit-owned standards + honest statuses

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0009 (cfkit and the verify gate); standards index (`docs/standards/README.md`)

## Objective

Close the gap between the standards index and reality: land the standards whose normative
content is fully this kit's (and therefore missing), and re-status the rest honestly instead of
leaving decade-old "planned" labels on behaviors that already exist or are family-owned.

## What landed

- `testing-strategy.md` (normative): the tier table (source specs, integration specs, script
  fixtures with the explicit-list trap, the contract suite, the runtime and scaffold smokes,
  coverage), determinism rules (injected `Clock`, no `Date.now()` assertions, injected
  randomness), real-state-over-mocks (pool bindings, queue consumers), probe requirements
  (ADR-0011), fixture hygiene, and the explicit-registration traps.
- `database.md` (normative): schema/drizzle ownership and generated-migration discipline, the
  2–3 rows-per-write budget with index amplification, batch-not-transactions, `meta.changes` /
  `RETURNING` outcomes, `timestamp_ms` + injected time, bounded reads/sweeps, and per-table
  retention semantics.
- `ci-cd.md` (normative): the single workflow contract (SHA pins, least privilege, concurrency,
  `npm ci --include=dev`, exactly `verify:ci`), profile/lane mapping with stable ids and advisory
  budgets, manual credentialed deploys per ADR-0010, and the never-do list (no secrets, no
  deploys from CI, no gate weakening — gate changes ship with fixtures and probes).

## Index refresh (the honest vocabulary)

The table now distinguishes three cases instead of one stale one: `normative` (six standards,
including the three landed here), `guide` (`configuration`, whose practical rules and key table
live in `docs/guide/config.md` with the zod schema as machine truth), and `family` (the five
wire-contract topics owned by backend-core-kit and enforced here by `contract:check`, the parity
manifest, Spectral, and the dialect suite rather than by duplicated prose). The legend explains
each status in the index itself.

## Verification

```bash
npm run drift:check   # links + map + ADR index green with the new standards and refreshed table
npm run verify:ci     # ci profile green (documentation-only change)
```
