# Pin the backend contract snapshot (task 2.1)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0002 (three-layer parity; mechanism 5 provenance swap), ADR-0009 (contract:check); roadmap task 2.1

## Objective

Pin backend-core-kit's committed OpenAPI snapshot into `contracts/backend.openapi.yaml` (byte-identical) with `contracts/provenance.json` (repo, branch, commit, file last-commit, version, SHA-256, byte size, pin date), document the artifact set and the downstream retarget procedure in `contracts/README.md`, and make the provenance verifiable: the new `scripts/contract/check.mjs` fails when the pinned file's SHA-256 no longer matches the manifest. The check is wired into the cfkit fast profile and exposed as `cfkit contract:check`.

## Facts pinned at recon

- backend-core-kit HEAD `670d9bc62e6ac3c0a5d1dc5dec3a9900b1840aa1` (branch `development`, clean tree); spec at `docs/openapi/openapi.yaml`, last touched by `4a8c63cff941bcb7480d55a163f2ed8585592a2c` (2026-09-26).
- File: 61,571 bytes, SHA-256 `6ae079adec93303ae3db3dee3ec13c2d1999f6b3367e800688469d4a780cff8c`, `openapi: 3.0.0`, `info.version 0.1.0`, 32 paths / 34 operations, 58 schemas.

## Constraints

- The snapshot is copied byte-for-byte (no reformatting, no edits). Provenance is data, not a claim: SHA-256 + byte size must verify in the gate.
- Repository + commit give downstream kits the retarget handle (swap `provenance.json` in their contract sync); the file hash is what our gate can verify offline.
- `scripts/contract/check.mjs` follows the budget/drift script pattern (Node ESM, fixture-tested with `node:test`, non-zero exit with named violations); it will grow (emit drift in 2.2, parity in 2.3) but only provenance checks now.
- Wiring: `contract:check` npm script, cfkit passthrough command + fast profile step, cfkit fixture step-list update; AGENTS.md map gains `contracts/`; docs/README contract section updated.
- Gate honesty: flipping a byte in the snapshot must fail the check (live probe); fixtures cover hash mismatch, missing file, malformed provenance.

## Impact Areas

- API / contract: yes — the pinned snapshot lands
- Budget / free-tier footprint: no
- CI / release: yes (fast + full profiles gain `contract:check`)
- Docs: yes (contracts/README.md, docs/README.md, AGENTS.md map)

## Acceptance Criteria

1. `contracts/backend.openapi.yaml` is byte-identical to backend-core-kit's file (verified by SHA-256 comparison during pinning).
2. `npm run contract:check` verifies provenance (hash, size, required metadata) and passes; a mutated snapshot fails with a named violation.
3. `npm run cfkit -- contract:check` delegates; fast profile includes the step; `npm run verify` green.
4. `contracts/README.md` documents the artifact set, re-pin procedure, and downstream retarget; roadmap 2.1 checked; plan filed to `completed/`.

## Steps

- [x] Copy the snapshot; write provenance.json + contracts/README.md
- [x] scripts/contract/check.mjs (provenance verification) + fixtures
- [x] Wiring (npm script, cfkit command + profile, AGENTS map, docs/README)
- [x] Live probe (mutate → fail → restore) + verify + bookkeeping

## Decision Log

- 2026-10-11: provenance records both the repo HEAD at pin time and the file's last-touching commit. -> HEAD churns; the file commit locates the exact upstream state
- 2026-10-11: the gate verifies the file against its recorded SHA-256 only; no git dependency at check time. -> the snapshot is the source of truth; matching upstream is the re-pin procedure, not a CI job

## Verification

Exact commands and outcomes:

```bash
npm run verify            # fast profile green (9 steps; contract:check 0.1s)
npm run test:scripts      # 30 fixtures (6 provenance fixtures added)
node scripts/contract/check.mjs
# clean tree  -> "[contract] provenance check passed" (exit 0)
# tamper probe (appended a byte) -> sha256 mismatch + exit 1; restored from source -> exit 0
sha256sum contracts/backend.openapi.yaml
# 6ae079adec93303ae3db3dee3ec13c2d1999f6b3367e800688469d4a780cff8c == provenance.sha256

# En route: prettier must ignore the byte-identical pin and the future emitted spec
# (it reformatted the YAML once during wiring; .prettierignore now covers both).
```

## Completion Notes

The pinned snapshot lives in `contracts/` byte-identically (hash verified against the source copy) with provenance recording repo URL, branch, HEAD and file commits, upstream version, SHA-256, byte size, and pin date. `scripts/contract/check.mjs` verifies provenance offline (file present, hash and size match, required metadata present; 6 fixtures) and is wired as `contract:check` in the npm scripts, the cfkit CLI (passthrough) and the fast profile; AGENTS map and docs/README updated. Live probe: appended byte fails with sha256 + size violations (exit 1), restored copy passes. .prettierignore now excludes the byte-identical pin (and the future emitted spec) from formatting.

## Follow-ups

- [ ] Re-pin procedure stays manual until a contract-sync tool exists (documented in contracts/README.md)
