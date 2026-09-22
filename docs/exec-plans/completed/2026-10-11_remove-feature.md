# Remove feature (task 5.2)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0009 (cfkit CLI and the verify gate); roadmap task 5.2

## Objective

`cfkit remove feature <name>` reverses 5.1 exactly: deletes the feature directory and any
endpoint routes it owns, unwires `src/app.ts` and `tools/contract/emit.entry.ts`, and returns
any owned operations in the parity manifest to `pending`. A scaffold → remove cycle must leave
the tree byte-identical to before (asserted by `git diff --exit-code`).

## Behavior reference

backend-core-kit's removal is bracket-aware (imports + array elements, nested/comment-aware),
refuses protected core features (`auth`, `users`, `admin` behind `--force-core`), refuses dirty
targets unless `--force`, and verifies cleanliness only textually — its own smoke checks
substring absence, not byte restoration. We hold a higher bar: byte-identical restoration.

## Design

- Reverse the 5.1 edit shapes precisely: remove the exact import + call lines the scaffold
  added (matching the generated symbols), then assert the file text equals the pre-scaffold
  text — the scaffold records nothing; instead removal _detects_ generated artifacts by their
  markers (the generated route files export a known `register` naming pattern and carry a
  generated header marker) and refuses when those markers are missing (hand-modified files).
- Manifest: operations owned by the feature's route files move back to `pending` (implemented →
  pending), refusing if the op was hand-moved elsewhere.
- Protected features: `auth` and `users` are refusable without `--force-core` (they pre-exist
  the scaffold and hold implemented operations); their scaffolded endpoint files are still
  removable through the endpoint path — the guard only blocks deleting the whole directory.
- Refusals: unknown feature, dirty target paths (unless `--force`), generated files that were
  edited beyond markers (the header marker stays but body markers were replaced → allow;
  missing header → refuse), operations in the manifest that are not owned by the removed files.
- Tests: the pure planner plus a fixture-repo cycle asserting byte-identical restoration of the
  three edited files and full deletion of generated paths.

## Acceptance Criteria

1. On a fixture repo: scaffold endpoint → remove → `git diff --exit-code` clean, generated
   paths gone, manifest back to its original state.
2. Refusal matrix tested (protected features, dirty paths, unknown feature, foreign operations).
3. Live cycle evidence on the real repo recorded in the plan; `verify:ci` green.

## Steps

- [x] Detection + planner + writer + CLI wiring
- [x] Fixture-repo cycle tests + refusal matrix
- [x] Live evidence + bookkeeping

## Decision Log

- 2026-10-11: byte-identical restoration as the bar, not textual absence. -> the previous kit's smoke found substring absence acceptable and could leave residual formatting; here `git diff` is the assertion
- 2026-10-11: generated markers own the removal contract. -> hand-written features are never removed by this tool; only artifacts it can prove it created

## Impact Areas

- Harness: `tools/cfkit/` (+ `scripts/` for the smoke); Docs/guides change with 5.6; no product
  or contract surface changes outside the manifest moves the endpoint scaffold performs.

## Verification

```bash
# unit/fixture suite:
node --test tools/cfkit/remove.test.ts    # 4 tests: endpoint scaffold->remove byte-identical
                                          # restoration of every seed, marker refusal,
                                          # feature scaffold->remove zone-wiring restoration,
                                          # refusal matrix (protected / unknown / hand-edited)
npm run test:scripts                      # 83 fixtures (scaffold 11 + remove 4 via the list)

# live round trip on the real repository (scaffold both, remove both, compare):
npm run cfkit -- scaffold endpoint users.me.pushToken.revoke
npm run cfkit -- scaffold feature billing
npm run cfkit -- remove endpoint users.me.pushToken.revoke
npm run cfkit -- remove feature billing --yes
# cmp against pre-scaffold copies: src/app.ts, tools/contract/emit.entry.ts,
# tools/parity/coverage.json, eslint.config.mjs, docs/openapi/openapi.yaml
#   -> all five IDENTICAL (byte-for-byte), including the emitted contract spec
npm run verify:ci                         # full profile green after the change
```

## Completion Notes

Removal is the exact inverse of 5.1 and the byte-identical claim is proven live: after
scaffolding two artifacts and removing them, `cmp` reports all five touched artifacts
(`src/app.ts`, the emitter entry, the parity manifest, the eslint zone config, and the emitted
`docs/openapi/openapi.yaml`) identical to their pre-scaffold bytes.

Two design points the round trip forced:

1. **The manifest is now canonicalized (both arrays sorted).** Appending moved operations to
   the end of their target array, so a scaffold->remove cycle returned the operation to a
   different position and `git diff` was never empty. Sorting both arrays on every move (and
   normalizing the file once, with the sorting change landing in this task) makes the moves
   position-stable and the round trip exact. The manifest is a set of operation ids; ordering
   carries no meaning and the contract checks treat it as such.
2. **Marker-checked removal only.** Endpoint removal refuses routes without the generated
   header marker; feature removal refuses directories containing files it cannot prove it
   created (the trio with scaffold markers, generated route/spec pairs) unless `--force`, and
   protected core features (`auth`, `users`) unless `--force-core`; `remove feature` also
   requires `--yes`. Zone blocks referencing the removed feature are stripped from
   `eslint.config.mjs` by block boundaries, and `contract:emit` runs after any removal that
   returns operations to pending.

The hermetic test suite covers the same invariants without prettier in the loop (removal
restores the workspace's own seed bytes), so the guarantees are pinned regardless of the
formatter.
