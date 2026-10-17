# cf-core-kit — Readability Proposal

**Status:** accepted (2026-10-15) — ruler for the readability program; a section note is still required before any production edit
**Date:** 2026-10-15
**Revision:** r1 — ruler and section order from the taste discussion
**Scope:** implementation taste of hand-written TypeScript in this repository, judged against `mobile-core-kit`
**Authority:** none — advisory design record; no implementation is authorized by this document
**Graduation:** a rule that survives several accepted section notes may move into `docs/standards/` in its own change. This proposal does not authorize that move, an ADR, or an execution plan.

## 1. Summary

Feature code in `mobile-core-kit` stays easy to read because the shared core already owns the repeated work. A datasource method does one thing in one shape. A repository runs one sequence and hands errors to a mapper. A use case states the policy and stops. The next feature looks like the last one.

cf-core-kit already chose that architecture. [ADR-0001](../docs/adr/0001-single-worker-and-progressive-feature-tiers.md) keeps a heavy platform and progressive feature tiers, with mobile-core-kit ADR 0009 as the family source. The gates already enforce the high level: contract parity, budgets, boundaries, complexity, and function length. They do not enforce local taste. A handler can stay under the line cap and still be a shape the next handler does not repeat.

This proposal defines how we judge whether the TypeScript actually reaches that taste, one section at a time. The peak is predictability at the function, not a uniform folder tree.

No production code changes until a section note for that section is accepted.

## 2. The bar

The reader is a developer who can read TypeScript and still gets lost when ownership or branches hide. Junior, mid, and senior should all be able to follow a function without recovering unstated context. Workers constraints stay visible. A line that hides a D1 batch rule, a clock injection, or a budget limit fails the bar even when a shorter line would compile.

Four habits from the mobile kit are the ruler. Paths below are in `/home/fikrilal/workspace/devs/core/mobile-core-kit`.

### 2.1 A state decision is an exhaustive switch

`AppAsyncStateView.build` switches on `AppAsyncStatus`. Each arm is one named builder. The compiler forces every status to appear.

`PasswordResetConfirmPage._mapStatusToViewState` does the same for page status. Token failure is decided first. The remaining statuses map in one switch.

This kit has no widget tree. The same habit applies wherever one value picks an outcome: a `kind` discriminant, a session state, a job result, an OIDC verification result. The reader sees every arm. Each arm names what happens. A stringly fallback that turns an unknown kind into some other product outcome fails the habit.

### 2.2 The repository is the sequence. Mapping lives next to it

`AuthRepositoryImpl.login` does four things, in order: load device identity, build the request, call the remote source, convert the result. `mapAuthFailure` lives beside the repository. The mapper file states the rule: the repository stays orchestration-only. A light feature may keep a tiny map inline. A separate file is for a real table, not for one line.

On this kit the repository function is the sequence: one Drizzle read or one allowed batch, then a view or a `kind`. HTTP status and problem details do not live in that function. Row-to-payload mapping sits next to the sequence when the table is real.

### 2.3 The service is the policy

`LoginUserUseCase.call` builds credentials, rejects invalid input, and calls the repository. Nothing in that function knows HTTP, JSON, or device identity.

[ADR-0001](../docs/adr/0001-single-worker-and-progressive-feature-tiers.md) already says a service exists only when the operation has logic worth isolating. A pure pass-through is forbidden; the handler calls the repository. This proposal keeps that rule. A service that only forwards arguments is a taste failure. A handler that also owns rate-limit policy, a write sequence, a job enqueue, and the response is a taste failure in the other direction.

### 2.4 Platform is why the next feature is readable

Those short mobile functions exist because `ApiHelper`, the failure vocabulary, and validation already did the hard part. A new datasource copies the method. It does not invent a second way to call HTTP.

Here the platform modules in `src/platform` are that core. A feature function shows the product rule. Envelope, problem details, request id, validation shape, idempotency, clock, logging, and queue retry belong to platform. The next handler of the same kind matches the last handler.

## 3. What this is not

- Copying Dart, Flutter, Freezed, Cubit, `Either`, or a datasource class into Workers. Mobile methods look the same because each one is HTTP-out through `ApiHelper`. A D1 batch, an R2 presign, a queue send, and an OIDC verify are different jobs. One fake shape across those jobs adds debt.
- Forcing `app/` and `infra/` onto slices that have not hit an ADR-0001 promotion trigger. Landed features use routes, an optional service, a repository, jobs, and shared errors. Taste work judges that shape.
- Treating a short name, a `Readonly` wrapper, or a top-to-bottom Drizzle chain as a defect when the function is still obvious. Functions stay the house style. ADR-0001 rejected a DI container.
- Splitting a one-line map into a new file.
- Reviewing generated artifacts as authorship. `docs/openapi/openapi.yaml`, `worker-configuration.d.ts`, and generated Drizzle migrations stay generated. Review the hand-written route metadata, the callers, and the schema the feature owns.
- Changing the wire contract, error codes, token semantics, schema, or budget profile as part of a taste edit. [ADR-0002](../docs/adr/0002-wire-contract-parity-with-backend-core-kit.md) stays shut. A real bug is recorded in the note's bug bucket and fixed only when a bug note says so.
- Reopening ADR-0001, ADR-0005, or ADR-0007. Platform owns cross-cutting work. Free-tier budgets stay architecture. Queue, cron, Durable Object, KV, and R2 policy stays where ADR-0007 put it.
- Mixing this program with harness parity. `tools/cfkit` and `scripts/` already have their own proposal.

## 4. Where the same jobs live today

| Mobile habit | Mobile home | cf-core-kit home |
| --- | --- | --- |
| Shared response and failure machinery | `lib/core/infra/network` | `src/platform/http` (`envelope`, `problem`, `validation`, idempotency, list query) |
| Shared small primitives | `lib/core/foundation`, `lib/core/platform` | `src/platform/config`, `clock`, `logging`, `crypto`, `cache` |
| Token issue, verify, guard | session core plus feature adapter | `src/platform/auth` |
| Persistence sequence | repository over a remote datasource | feature repository over `src/platform/db` (D1 + Drizzle) |
| Thin policy | `domain/usecase` | optional feature service, or the handler when ADR-0001 says there is no policy |
| Side effects that outlive the request | not the datasource method | `src/platform/queue`, feature `*.jobs.ts`, the one cron in `src/jobs.ts` |
| Process entry | `lib/core/di` | `src/app.ts`, `src/worker.ts` |

This table names owners. It is not a score. The Cloudflare side has not been reviewed yet.

## 5. The shapes a reader should predict

Folder depth may graduate. These shapes may not. A reader who has learned one example of a shape should find the next example in the same place, with the same steps.

| Shape | What one example contains | What varies |
| --- | --- | --- |
| Route module | OpenAPI route, operation metadata, handler factory, `register*` function | path, schema, error codes |
| Handler | read principal and body, reject unknown keys, call one function, write through the platform success helper | the one function it calls |
| Service | the product rule only, returned as data or a `kind` | present only when ADR-0001 says the rule is worth isolating |
| Repository function | one read, or one batch inside the write budget, then a view or a `kind` | the statement |
| Error table | named builders for the feature's problem details, beside the caller | the codes |
| Job | one payload, one sequence, platform retry left alone | the sequence |

`src/features/users/me` is the copy target for the handler and repository shapes, after the platform HTTP note has settled the success helper. Later feature notes copy that settled shape. They do not invent a third one.

## 6. Seeds

These lines were read while writing the ruler, so the first notes do not start from zero. They are questions for those notes. They are not permission to edit.

Success JSON has two dialects. `data()` in `src/platform/http/envelope.ts` is what `src/app.ts` returns for `/`. Feature handlers build the envelope by hand: `session.routes.ts` refresh, `oidc.routes.ts` exchange, `me.routes.ts` get and patch, `profile-image.handlers.ts` upload and url. `noContent()` is the 204 path. Session list uses `listPayload` inside `context.json`, while `list()` also exists on the envelope module. The HTTP note decides the one success dialect. Recommended direction: every feature success path calls one platform helper. The note picks the signature Hono handlers can return without building `{ data }` themselves.

File placement is not yet a shape. The refresh handler lives in `session.routes.ts`. Profile-image splits routes and handlers. `me.ts` is query functions with no service. ADR-0001 allows a missing service. The reader still cannot guess the file. The `users/me` note names the copy target. Later notes either match it or record why a promotion trigger moved the file.

`createUploadProfileImageHandler` rates the limit, checks the live user, builds the plan, enqueues expiry, and writes the response. That is five jobs. The profile-image note sorts them into handler, service, and platform. It does not do that until the earlier notes exist.

`kind` results already appear in `profile-image.service.ts` and `account-deletion.repository.ts`. Named problem builders already appear in `auth.errors.ts`. Other handlers throw `new AppError` inline, including me profile sanitizing and session revoke. The notes judge whether each inline throw is a one-line map that should stay, or a table that should sit beside the caller.

## 7. Invariants a taste edit keeps

Taste work may move code and names. It keeps behavior.

**Contract.** Operation ids, envelopes, problem `code`, `traceId`, `errors[]`, and idempotency headers stay. Backend-core-kit owns the wire. Emitted OpenAPI and `tools/parity/coverage.json` stay in lockstep. A route move that changes a published response is a contract change and stops.

**Auth.** No password material appears (ADR-0006). Refresh reuse, token hashing, session revoke, and Durable Object rate-limit decisions stay, including fail-open where the current code fails open. A taste edit does not log tokens or raw authorization material. Redaction stays as the observability standard already states it.

**Data.** D1 is the store. A repository does not grow an interactive transaction across awaits. The write budget stays at most two or three rows per API write. A split that adds a query or a subrequest is not a taste improvement.

**Jobs.** One cron trigger. Retry, backoff, and dedup stay in `src/platform/queue`. A job function shows its sequence. Partial failure stays visible: an enqueue that the request already treats as best-effort must not become a hard failure inside a rename.

**Security boundary.** Features keep receiving typed ports. Raw `env` and KV writes stay inside the allowlists ADR-0008 already enforces. A readability helper does not become a new place that reads secrets.

## 8. How the work proceeds

1. This proposal is the ruler.
2. One section note per pass, written before any edit in that section. The note cites file and function, and sorts each observation into three buckets:
   - hard to read, with the mobile habit it misses;
   - correct TypeScript that should stay, including Workers constraints that look odd and keep the function honest;
   - a real bug, kept separate from taste.
3. The note answers one design question: which repeated mechanic still sits in the feature and should move into platform, and which policy must stay so the function still says what the product does.
4. A platform helper needs a second call site, or a function that stays hard to read without it. One call site is not enough.
5. An accepted note is the only permission to edit that section. The edit stays inside the note. Behavior stays unless the note's bug bucket was accepted as a bug fix.
6. Verify with the tests that cover the section. When the edit touches routes, operation metadata, or `src/platform/http`, also run `npm run verify`. Record the command and the result on the note.
7. The next section starts only after that. No batched cleanup across unreviewed folders.

Section notes live in `_WIP/readability/`. They are investigation notes, same status as this folder: not source of truth.

A feature note that finds the unread platform module is why the function is hard to read stops there. That module is the next note, before the feature is edited. Modules that are already obvious wait until a note needs them.

`src/features/auth/shared/` opens with the sessions note, because sessions is the first auth section that depends on it. Later auth notes judge their own calls. They reshape `shared/` only when they find a habit the sessions note missed, or a bug.

A section that does not fit one sitting splits on the first note, by file group, before any edit.

## 9. Section order

Order follows the reason the mobile features are readable, narrowed to the sequence agreed for this kit. Judge the response machinery first. Judge `users/me` next and make it the copy target. Then walk auth, then the rest of users, then jobs.

1. `src/platform/http` — envelope, problem details, validation, request id, logging, OpenAPI metadata. Idempotency (`idempotency.ts`, `idempotency.core.ts`, `idempotency.service.ts`, `idempotency.jobs.ts`) splits into its own note before any feature edit if the first note cannot hold it. `src/shared/list-query` opens before sessions, which is the first list in this sequence.
2. `src/features/users/me` — the copy target for handler and repository shape.
3. `src/features/auth/sessions` — refresh, logout, list, revoke, JWKS. Includes `src/features/auth/shared/`.
4. `src/features/auth/oidc`.
5. `src/features/auth/email-verification` and `src/features/auth/push-tokens` — the rest of auth, one note each, so the shared layer is not judged again from scratch.
6. `src/features/users/profile-image`.
7. `src/features/users/account-deletion`.
8. Jobs — feature `*.jobs.ts` and `src/jobs.ts`. Platform queue code is the deferred-module rule in §8 when a job note cannot read the sequence without it.

`src/platform/auth`, `db`, `storage`, `rate-limit`, `email`, and `push` are not a preface. They open under the §8 rule when a section above is hard to read because of them.

`tools/cfkit`, `scripts/`, generated OpenAPI, and generated migration SQL stay out of this program.

## 10. Acceptance

The program is done when all of the following hold for the hand-written surface in §9:

- A reader who has learned `users/me` can predict the handler, the repository function, and the error table of the next feature.
- A feature function shows policy. Platform code shows the repeated mechanic.
- Each boundary has one obvious place that translates a `kind` or a failure into a problem. Callers of that translation read as a straight sequence.
- Outcome branches the caller must handle are exhaustive and named.
- Taste edits do not move the wire contract, the schema, auth semantics, or the budget profile.

## 11. Risks

- A taste pass becomes a rewrite that fights ADR-0001 or hides a Workers constraint behind a helper.
- Every mapping gains a file, including maps mobile would have left inline.
- Platform grows a helper that only one call site uses.
- A readability edit changes a status code, an error code, a token, a row count, or a retry without a separate bug note.
- Two success dialects get "unified" by a wrapper that still builds `{ data }` in the feature. The HTTP note has to leave one dialect.
- The correctness track gets pulled into the same edit. Bugs recorded in a taste note stay in the bug bucket until a bug fix is accepted on their own.

## 12. Open questions

- **Correctness program.** Recommended default: this proposal does not schedule it. A section note may record a bug. The fix waits for its own accepted bug note. A dedicated pass over refresh reuse, idempotency replay, the deletion saga, and R2 orphans is a later proposal. Taste notes do not wait for that proposal.
- **Standards promotion.** After `src/platform/http` and `users/me` are accepted, and the same rule has appeared in a third note, decide whether it belongs in `docs/standards/`. Not before that evidence.
