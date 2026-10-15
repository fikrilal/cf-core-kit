# Engineering (harness documentation)

Status vocabulary: **written** here, **planned** (named with the plan that owns it), or **family** (a topic the
reference family owns; we follow the contract and do not restate it).

## The harness itself

| Document                           | What it answers                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `cfkit.md` (written)               | every command, flag, exit code, and what it delegates to                        |
| `guardrails.md` (written)          | which gate owns which rule, the escalation ladder, the suppression policy       |
| `runtime-evidence.md` (written)    | the artifacts a runtime-affecting change owes, and the redaction table          |
| `duplication-harness.md` (written) | both jscpd profiles, the categories, the allowlists, the `--fatal-found` policy |
| `operating-evidence.md` (written)  | what the ledger records, and what it may never contain                          |

## How the machinery is used

| Document                               | What it answers                                                           |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `loop-engineering.md` (written)        | how to pace a long task without drifting                                  |
| `agent-loop.md` (written)              | the attempt → verify → repair → escalate cycle, and what each phase costs |
| `parallel-agent-workflow.md` (written) | when to prepare a workspace, and what two tasks in one tree would break   |
| `hill-climbing.md` (written)           | how a "same failure twice" repeat becomes an automated check              |

## Feature notes

| Document                                            | What it answers                                       |
| --------------------------------------------------- | ----------------------------------------------------- |
| `auth/oidc-google.md` (written)                     | the Google sign-in path, its seams and its evidence   |
| `auth/session-management.md` (written)              | sessions, revocation, the JWKS surface                |
| `auth/token-refresh-and-request-retry.md` (written) | refresh rotation, reuse detection, idempotent retries |
| `auth/email-verification.md` (written)              | the verification token lifecycle and delivery         |
| `users/profile-images.md` (written)                 | the presign/attach/replace/expire lifecycle           |
| `users/account-deletion.md` (written)               | request, cancel, sweep, finalize, scrub               |
| `email/resend.md` (written)                         | the provider port and the fetch adapter               |
| `push/port-and-fcm-deferral.md` (written)           | why push is a port and FCM is deferred                |

`admin/*` and `merchantOnboarding/*` are **out of scope** (ADR-0013); the family keeps notes for both.

## Planned

Nothing is planned for this folder right now. The review-skill alignment (proposal row 8.9) is tracked in the
F19 plan: the repository's `review-change` skill already carries four phases and the ten review dimensions, and
the honesty section ("checks not run") the family requires is the one item still to be reconciled there.
