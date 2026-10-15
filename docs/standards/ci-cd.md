# CI/CD (normative)

Status: normative (landed 2026-10-11). The pipeline exists; these are its invariants.

## The pipeline

- One workflow (`.github/workflows/ci.yml`) runs on push and pull requests and executes exactly
  `npm run verify:ci` — the `ci` verify profile (fast steps + coverage + duplication + build +
  the runtime boot smoke + the scaffold smoke). CI does not run a hand-picked subset.
- Actions are **pinned to 40-hex commit SHAs** with the released tag in a comment; the workflow
  declares least-privilege `permissions` (`contents: read` only) and cancels superseded runs.
  `scripts/ci/workflow.test.mjs` fails when a pin floats or a permission widens.
- Dependencies install with `npm ci --include=dev` — an environment that sets
  `NODE_ENV=production` must not silently skip devDependencies (this workspace hit exactly that
  during Phase 5).
- CI must never: receive secrets beyond the checkout token, publish or deploy anything, or
  weaken a gate to go green. Gate changes land in the owning script with fixtures and a recorded
  probe, per the testing-strategy standard.

## Profiles and lanes

- Profiles: `fast` (developer loop), `full` (fast + coverage + duplication + build), `runtime`
  (boot smoke), `smoke` (scaffold cycle), `ci` (full + runtime + smoke). Step ids are stable and
  pinned by `tools/cfkit/cfkit.test.ts`; advisory duration budgets warn without failing.
- Deployment is manual and credentialed (ADR-0010): `npm run deploy` targets `dev`;
  `wrangler deploy --env staging|prod` targets the other lanes, each with its own Worker name,
  D1 database, queues, and secrets. The first-deploy runbook lives in `README.md`.
- Local verification precedes pushes: `npm run verify` for the loop, `npm run verify:ci` before
  publishing. Credentialed evidence lanes (dashboard CPU, live R2 upload, first deploy) are
  tracked in their task plans, never simulated in CI.

## Lanes (normative)

The workflow is a set of lanes, not one job, and the classifier decides which of them are load-bearing:

| Lane         | Runs when                    | What it runs                                                                                            |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `risk`       | always                       | `ci classify` over the diff; publishes `effective_risk` and `runtime_required`                          |
| `full`       | always                       | `verify --profile full` plus the coverage artifact (7 days)                                             |
| `runtime`    | `runtime_required == 'true'` | `verify --profile runtime` and `verify --profile smoke`                                                 |
| `governance` | pull requests                | dependency review (`fail-on-severity: high`), a history/diff secret scan, `secrets:check`, `audit:prod` |
| `required`   | always (`if: always()`)      | aggregates the four: a conditional lane may be `skipped`, nothing else may fail                         |

Branch protection points at **`required`**. The lanes never inline a profile's internals: every `run:` is
`npm ci`, a profile invocation, or the small shell that resolves a base revision or aggregates results — the
workflow fixture parses the YAML and fails if that stops being true. Actions are pinned by commit with their tag
in a comment, and every checkout sets `persist-credentials: false`.

Two honest gaps are recorded rather than implied: the history/diff secret scan uses `gitleaks-action`, which is
free for public repositories but needs a `GITLEAKS_LICENSE` secret for an organisation (the tracked-file scan
remains the gate without it), and `@scarf/scarf` arrives as a transitive dependency of commitlint whose
postinstall is deliberately **not** allowed by the repository's install-script gate, so no telemetry runs.

## Baseline governance

Two baselines are review artifacts, not escape hatches: the architecture-smell baseline
(`tools/smells-baseline.json`) can only be written with `SMELLS_BASELINE_APPROVED=true` set deliberately, and
every entry carries the rule, the file and the review date; the duplication allowlists name **both** files in a
pair with a reason. `remove feature` prunes entries whose paths are gone, so a baseline cannot silently outlive
the code it excused, and `verify:gates` proves the gates that read them still bite.

## Contract changes and the changelog expectation

A change that alters the wire contract — an operation, a DTO, an error code, a header — must, in the same pull
request: regenerate the emitted document (`npm run contract:emit`), keep the parity manifest in step
(`tools/parity/coverage.json`), pass `contract:check` and `contract:lint`, and say in the pull-request template
which operations changed and how the manifest moved. "Contract" here means what the reference family serves; the
kit follows it and never invents surface (ADR-0009). Write the paragraph a reviewer would otherwise have to
reconstruct.
