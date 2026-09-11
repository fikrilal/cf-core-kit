# Parity Manifest

`coverage.json` classifies every operation in the pinned backend snapshot (`contracts/backend.openapi.yaml`) into exactly one bucket:

- **implemented** — mounted here and shape-checked against the pinned snapshot by `npm run contract:check`.
- **pending** — in the family contract, not yet implemented here; each later phase moves operations to `implemented` in the same change that ships the route.
- **descoped** — deliberately out of scope, with the reason, the revisit note, and the ADR reference (currently `auth.password.*` — ADR-0006). Descoped operations are never mounted, not even as stubs.

The check fails when an operation is unclassified, classified twice, when a pattern matches nothing, when an emitted operation is not declared implemented, when an implemented operation drifts in shape from the snapshot (path, method, operationId, tags, error codes, response statuses and schemas, `$ref`-resolved), or when a descoped entry lacks its ADR reference.
