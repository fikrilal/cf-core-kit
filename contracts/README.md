# Contracts

The pinned and emitted wire-contract artifacts. The contract itself is owned by `backend-core-kit` (ADR-0002); this kit follows it and never invents or changes contract surface.

## Artifacts

- `backend.openapi.yaml` — byte-identical copy of `backend-core-kit`'s committed snapshot (`docs/openapi/openapi.yaml`), pinned at the commit recorded in `provenance.json`.
- `provenance.json` — where the pin came from: repo, branch, HEAD and file commits, upstream version, SHA-256, byte size, pin date, and the artifact path.

Once the emit task lands, this repository also commits its own `docs/openapi/openapi.yaml`, generated from route definitions and drift-checked (`npm run contract:emit` writes it; `npm run contract:check` fails when it is stale).

## Re-pin procedure

1. In `backend-core-kit`, confirm the tree is clean and note `git log -1 --format=%H` plus the file's last commit (`git log -1 --format=%H -- docs/openapi/openapi.yaml`).
2. Copy `docs/openapi/openapi.yaml` to `contracts/backend.openapi.yaml` byte-for-byte (no reformatting).
3. Update `provenance.json` (commits, version, SHA-256 via `sha256sum`/`shasum -a 256`, byte size, pin date).
4. Update `tools/parity/coverage.json`'s source block once it exists.
5. Run `npm run verify`; the provenance check recomputes the hash and fails on any mismatch.

## Downstream retarget

`frontend-core-kit` and `mobile-core-kit` locate a kit's contract by reading `provenance.json` and syncing the referenced snapshot; pointing them at this repository is a provenance swap in their existing sync, not a new integration. The implemented surface differs (password operations are descoped here — ADR-0006), which the parity manifest declares explicitly.

`npm run contract:check` verifies the pin offline: the artifact exists and matches the recorded SHA-256 and byte size, with every required provenance field present.
