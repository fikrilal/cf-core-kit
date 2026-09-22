# Harness docs currency: AGENTS.md, maps, review skills, READMEs

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0009 (cfkit and the verify gate), ADR-0011 (gate honesty); review skills in `.commandcode/skills/`

## Objective

Three artifacts still described the Phase 3/4-era harness; a reviewer (human or skill-driven)
following them would miss every gate added since. This pass makes them describe reality.

## What was stale and is now fixed

- **AGENTS.md verification section** claimed CI runs "the full profile, adds the dry-run build"
  and that `scaffold`/`remove` and the `runtime`/`ci` profiles "land in later phases". It now
  documents the `ci` profile correctly (fast steps + coverage floors + duplication gate +
  dry-run build + runtime boot smoke + scaffold smoke) and lists the real cfkit surface
  (`scaffold feature|endpoint`, `remove feature|endpoint`, `task begin|verify|status`,
  `handoff dry-run|<action>`, five verify profiles, `secrets:check`).
- **AGENTS.md architecture map** was missing the `scripts/security`, `scripts/ci`,
  `scripts/duplication`, and `scripts/scaffold` families and the `tools/contract` entry; the
  `tools/cfkit` line understated the CLI. Both maps now match the tree.
- **docs/core/project-architecture.md** tree gained `scripts/`, `db/migrations/`, and
  `contracts/` (previously absent entirely) and the accurate cfkit description.
- **Both review skills** (`.commandcode/skills/review-change`, `review-test`) pre-dated the new
  gates. Updates: the budget dimension now names all eight `budget:check` rule families; the
  testing/gate dimensions carry the specific probe shapes (duplication allowlist emptying,
  coverage threshold raise, workflow pin float, runtime-built scanner fixtures, byte-compared
  scaffold restoration); a new dimension covers harness state and tooling semantics (marker-owned
  scaffold artifacts, `.cfkit` state, expiring per-action handoff approvals, presign scoping);
  the test skill's tier table gained the coverage and boot/smoke tiers, the wiring section notes
  coverage's include scope, and the fixture-quality rules record the captured-bytes restoration
  rule and the live-scaffold-derived pre-state rule; the Phase 3 command lists in both skills
  now include `secrets:check`, `duplication:check`, `test:coverage`, the scaffold smoke, and the
  workflow meta-test.

## Second pass: the remaining documentation surfaces

The first pass covered the reviewer-facing maps and skills; this pass swept the entry-point
docs, which were lying in more visible ways:

- **Top-level README** claimed "platform core complete; the contract pipeline is next" (five
  phases stale) and described `verify:ci` as "adds the dry-run build". It now states the real
  status (Phases 0–5 complete; remaining work product-deferred or credentialed), the ci profile
  composition, and the cfkit surface (scaffold/remove, task, handoff) with guide pointers. The
  free-tier bullet was corrected too: D1 + Queues + the DO limiter are wired; R2 presigning
  needs no binding (no KV/R2 bindings exist).
- **docs/README.md** described the standards index as "free-tier-budget lands first" (six
  standards have landed) and omitted the guides entirely; it now lists the status vocabulary,
  the six normative standards, the guides, and a Harness section (profiles and cfkit).
- **docs/exec-plans/README.md** gained the machine-read header conventions: `Status` values
  including `queued`, the `Risk` the task tooling classifies against, and where `.cfkit/` state
  lives.
- **docs/exec-plans/_template.md`** said `- Status: active | completed` while plans actually
  start queued; it now matches, and carries the optional Review Round section the later plans
  use.
- **docs/core/project-stack.md** caught up: the CLI line (task/handoff, five profiles), the
  testing line (script fixtures, coverage through the pool), the gate set (secrets scan,
  duplication, coverage floors, workflow invariants), and the R2 signer fact.

## Verification

```bash
npm run lint && npm run drift:check   # maps, links, ADR index green
npm run verify                        # fast profile green (documentation-only change)
npm run verify:ci                     # ci profile green (documentation-only change)
```
