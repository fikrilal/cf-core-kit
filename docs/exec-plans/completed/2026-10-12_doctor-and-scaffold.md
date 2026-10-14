# Doctor checklist and scaffold tiers (harness parity F18)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.7 (rows 7.1-7.4), §7 batch F

## Objective

Make the doctor answer "what would stop a task?" for the whole harness, and make scaffolding cover the two
feature shapes the repository actually uses — with removal that prunes what the gates read.

## Behaviour reference (backend-core-kit)

Row 7.1 (tools present, canonical root, private state ignored, policy schemas, task/workspace state schemas, a
stale-task warning, a tools warning), rows 7.2-7.4 (scaffold tiers and flags, removal that prunes baselines,
`baseline-pruner.ts` and `removal-confirmation.ts` extracted).

## Design

- `doctor.ts` grows from five checks to twelve: hard failures for git, the canonical root
  (`realpath(git rev-parse --show-toplevel)` versus the working directory), `node_modules`, `wrangler.jsonc`,
  `.cfkit/` being git-ignored, the policy schemas (plans, oracles, ledger — the existing validators, reused) and
  the task/workspace state files; warnings for node-version drift, the `wrangler` toolchain, a missing
  migrations directory, and tasks that have gone quiet for more than a week. `readTaskStateReport` is exported
  (and fixture-covered) separately from `gatherDoctorFacts`, and a **superseded state schema is a warning, not a
  failure** — `readTaskState` migrates it on read.
- `scaffold feature <name>` gains `--tier simple|clean`, `--with-queue`, `--dry-run` and `--force`. `simple`
  keeps the trio; `clean` emits the ADR-0001 shape (composition root with a `// cfkit:capabilities` anchor, an
  operations aggregate, an `index.ts` surface). `--with-queue` adds `<name>.jobs.ts` **and two edits** to
  `src/jobs.ts` — the import at the `// cfkit:job-factories` anchor and the factory spread into
  `createJobRegistry([` — so the module can be neither orphaned (the `uncomposed_job_module` smell rule checks
  the import) nor unused (lint checks the composition).
- `scaffold endpoint` **refuses** a clean-tier feature instead of flattening it, with the capability path and
  anchor in the message.
- `removal-confirmation.ts` owns the semantics (features need `--yes`; the protected core features need
  `--force-core`), and `baseline-pruner.ts` prunes the smell baseline and both duplication allowlists for every
  removed path — planned and printed _before_ the removal, applied after it. Removal also drops the two
  `src/jobs.ts` lines the queue scaffold inserted, and recognizes every scaffolded shape (simple trio, clean
  trio, jobs module) so it never demands `--force` for its own output.
- The scaffold smoke now covers the new flags: two dry runs (simple, and `clean --with-queue`) must write
  nothing, then the real cycle scaffolds **with** `--with-queue` and must restore every touched file — including
  `src/jobs.ts` — byte-identically.

## Constraints

- The doctor's state reader reports; it never repairs. Hard failures are what the harness cannot work around;
  everything else is a warning a maintainer can read.
- Dry runs write nothing, and the smoke asserts it (a plan that prints is not a plan that applies).
- A generated job module that is not composed is a bug the harness already had a rule for — the fix was to make
  the generator produce both halves, not to relax the rule.
- Removal prunes only entries that point at the removed paths; a baseline or allowlist group that survives the
  removal keeps its reason.

## Acceptance Criteria

1. The doctor's checklist is exact (twelve named checks), each hard failure and each warning case is pinned, and
   a state file with an unknown phase, a foreign task id, unreadable JSON or a foreign workspace manifest is
   reported (fixtures).
2. The clean tier emits the three ADR-0001 files with the capability anchor, and `--with-queue` emits the module
   plus both `src/jobs.ts` edits (fixtures).
3. An unknown tier and a force-less collision are refused; `--force` scaffolds into an existing directory
   (fixtures).
4. `scaffold endpoint` refuses a clean-tier feature with an actionable message (fixture).
5. The pruner removes smell keys and allowlist pairs for a removed file or directory, writes only when told to,
   skips untouched baselines, and the confirmation refuses features without `--yes` and core features without
   `--force-core` (fixtures).
6. The smoke covers both dry runs (writing nothing) and a real `--with-queue` cycle that restores byte-identically.
7. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `doctor.checklist` plus
   `scaffold.tiers` flip to `present` (42 of 46).

## Steps

- [x] the doctor checklist (facts, state reader, twelve checks, fixtures)
- [x] scaffold tiers, queue jobs, dry-run and force (generator + command + fixtures)
- [x] the clean-tier refusal in the endpoint scaffolder
- [x] `baseline-pruner.ts` + `removal-confirmation.ts` + wiring the pruner into removal
- [x] smoke coverage for the new flags, manifest flips, bookkeeping

## Decision Log

- 2026-10-12: a superseded task state schema warns instead of failing. -> the harness migrates schema 1 on read,
  so failing would block work over a file that works; the two pre-existing states are now named in the warning.
- 2026-10-12: the doctor reuses the plans/oracles/ledger validators instead of re-implementing them. -> one
  definition of each schema, and the doctor's job is readiness, not a second opinion.
- 2026-10-12: `--with-queue` emits **two** edits. -> the smoke's lint run caught the first version importing a
  factory it never used; the import satisfies the smell rule and the spread satisfies lint, and the generator
  now produces both.
- 2026-10-12: removal recognizes the scaffolded shapes and prunes its own `src/jobs.ts` lines. -> otherwise
  `scaffold feature --with-queue` followed by `remove feature` left a dangling import (the smell gate caught
  exactly that on a leftover reproduction).
- 2026-10-12: the smoke's real cycle uses `--with-queue`. -> the flag's generation, composition, removal and
  restore are now proven by the same byte-identical check the simple tier already had, for one extra file.
- 2026-10-12: the endpoint scaffolder refuses clean-tier features rather than writing a flat file into them. ->
  the layout would contradict itself; an actionable message keeps the capability/anchor convention teachable.

## Verification

```bash
node --test tools/cfkit/cfkit.test.ts tools/cfkit/scaffold.test.ts \
  tools/cfkit/scaffold-endpoint.test.ts tools/cfkit/baseline-pruner.test.ts tools/cfkit/remove.test.ts
                                        # doctor checklist + state reader, both tiers, queue edits, the clean-tier
                                        # refusal, pruning both baseline shapes, confirmation semantics, apply/remove
npx --no-install cfkit doctor            # live: 12 checks, [warn] task recency naming the two 2026-10-11 states
                                        # (schema 1, migrated on read), exit 0
npm run scaffold:smoke                  # dry runs write nothing; a --with-queue cycle restores byte-identically
npm run verify                          # fast profile green (261 script fixtures)
npm run verify:gates                    # 8/8 gates bite
npm run verify:ci                       # ci profile green
```

## Completion Notes

The doctor now answers the harness's own readiness question in twelve checks, and scaffolding covers both
feature shapes with removal that keeps the gates honest (baseline keys and allowlist pairs for removed paths go
with them, and the queue import the scaffold inserted is taken back out). The work earned three fixes from its
own gates: the smell rule caught an uncomposed job module, lint caught the unused factory import (both fixed by
making `--with-queue` emit two edits), and the smoke caught a generated identifier that was invalid TypeScript
for feature names containing digits — the camelizer now uses the existing helpers. The scaffold smoke also grew
the two dry-run assertions, so "prints a plan and writes nothing" is checked rather than assumed.
