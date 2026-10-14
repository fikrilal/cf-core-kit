# Commit conventions

Status: guide (landed 2026-10-13). CI does **not** run this check — it is a local hook, by design: the
convention shapes the history, and a failing pipeline is not the place to learn it.

## Shape

```
<type>(<scope>): <subject>
```

- Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Scopes (enforced by `.githooks/commit-msg` → `commitlint.config.mjs`): `platform`, `auth`, `users`,
  `contract`, `harness`, `budget`, `queue`, `storage`, `email`, `push`, `ci`, `docs`, `deps`, `build`, `test`,
  `release`. A commit that fits no scope is usually two commits.
- Subject: imperative, lower case, no trailing period, ≤ 100 characters including the header.
- Body: what changed behaviourally and why, not a file list. Verification evidence belongs here when it is not
  in the plan.

## Install the hook

```bash
npm run setup:hooks   # git config core.hooksPath .githooks
```

The hook runs `commitlint --edit` on the message file. `--no-verify` is not an escape hatch we use: the
handoff's refusal set already forbids it, and a message worth skipping the check for is worth rewriting.

## Trailers

Commits created by the harness carry the co-author trailer:

```
Co-authored-by: CommandCodeBot <noreply@commandcode.ai>
```

## Why CI stays out of it

A message convention is a shared habit, not a correctness property. Holding a pipeline hostage to a subject
line trains people to bypass the pipeline; the hook keeps the feedback where the commit is written.
