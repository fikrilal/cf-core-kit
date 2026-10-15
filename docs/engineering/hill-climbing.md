# Hill climbing: from a repeat failure to a gate

The escalation ladder from `guardrails.md`, applied to harness work itself: a toolkit that grows a new check
every time the same class of mistake appears.

**1. Fix it, and write down what it was.** The plan's Decision Log gets the finding, not just the fix: "the live
probe caught `authorized → running` skipping the `preparing` hop" is what the next person needs.

**2. Fixture it.** The smallest test that fails if the mistake returns. A fixture that cannot fail is worse than
none — the mutation pilot exists to check the assertions themselves, and it caught a real gap on its first run
(the unknown-rule id was asserted through the constant it was supposed to pin).

**3. Gate it when it is structural.** If the rule is about shape rather than behaviour — a dependency direction, a
budget ceiling, a schema — it belongs in a gate with a fixture for both directions and a probe proving the gate
bites. `scripts/gates/check.mjs` plants a violation for every custom gate, asserts its marker and restores the
tree byte-identically; a gate that passes with a violation planted fails the suite.

**4. Prefer automating the _class_.** "Same failure twice ⇒ automate it" is literal here: a repeated review
finding (an untracked secret, a stale baseline entry, a job module with no composition) becomes a rule, a
fixture, and a row in the guardrails map.

**5. Recalibrate rather than relax.** When a sensor's threshold stops being useful, measure a clean run and record
the new baseline with its date and method (the duration budgets and coverage floors do exactly this). Loosening a
threshold without a measurement is how a gate quietly stops meaning anything.

**6. Record what was deliberately not ported.** The parity manifest and the plans carry the "recorded non-ports"
list — Docker lanes, DI stubs, Stryker, tracked-ID stacks. A silent gap looks like parity; a written one is a
decision.
