---
name: package-extensibility
version: 1.3.0
last_updated: 2026-08-04
description: Use when extracting, refactoring, reviewing, or designing a package meant to be reused by a second consumer, to measure whether a second host can change its behavior without forking it. Produces a fork-distance ledger backed by executable behavioral probes plus diagnostic findings; it does not produce an extensibility score.
---

# Skill: Package Extensibility

A reusable package has two independent freedoms, and a package can pass one while
failing the other:

- **Host freedom** — can a second host take this package *without* dragging a host
  layer in with it? Measured transitively over the dependency graph. Owned by
  `<AI_DEV_SHOP_ROOT>/skills/hexagonal-architecture/SKILL.md` and
  `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/dependency-structure.md`.
- **Extension freedom** — can a second host *change this package's behavior*
  without forking it? **That is what this skill measures.**

A package with zero host coupling and zero seams is perfectly portable and
perfectly unextendable. Do not read a clean dependency graph as an extensibility
result.

## When To Use This Skill

Activate only when a second consumer is **recorded**, not imagined. One of:

- a second consumer exists,
- a named prospective host is arriving, with its owner identified,
- a fork, a `patch-package` entry, a vendored copy, or a `// TODO: upstream this`
  already exists — those are extension failures that already happened,
- an implementation-outline or CIC constraint declares an extensibility
  requirement that needs a check.

"Make this generic", "make it pluggable", and "we might reuse this later" are
**not** activation triggers. Without a recorded second consumer the demand
inventory below cannot be populated, the ledger goes `INCONCLUSIVE` by
construction, and the only possible output is speculative seams —
`<AI_DEV_SHOP_ROOT>/skills/refactor-patterns/references/rule-of-500.md` warns
against removing abstractions that protect real variation, and adding
abstractions that protect imagined variation costs the same maintenance with none
of the return.

Every agent wire for this skill repeats that precondition verbatim. An agent that
cannot name the second consumer does not run the ledger.

**No exceptions, including for reuse assessment.** An earlier version carved out a
named `PRE_ASSESSMENT` mode for CodeBase Analyzer. It forbade an extensibility
*verdict* but not an extensibility-driven *change* — diagnostics without a host,
then an architect applying M1 or M12 "for reuse", which is speculative-seam work
with the word "verdict" carefully avoided. A mode that blocks the label and not the
consequence is a bypass with a label on it.

What CodeBase Analyzer may do without a recorded second consumer is narrow and
stated in its Ownership bullet below: report the internal-shotgun observation, the
primary abstraction it chose, and the files touched. No ledger row, diagnostic
finding, refactor move, seam recommendation, or delta.

## The Headline: Fork-Distance Ledger

Write down concrete deviations a second host would realistically want. Then, per
deviation, record whether it is satisfiable **by wiring alone** or requires an
edit to package source.

`4 of 5 satisfiable by injection` is a real number. `we have lots of ports` is
not. Diagnostics D1–D13 below tell you *why* a deviation failed; only the ledger
tells you *whether* it did.

Five rules keep the ledger from becoming another self-assigned score. Each exists
because dropping it collapses the ledger into a claim about intentions.

**1. The demand inventory is independently owned and enumerated first.**

Before any row is scored, build the candidate inventory — and build it from
sources the package author does not control:

- **Mandatory, mechanical:** every existing fork, `patch-package` entry, vendored
  copy, patched `node_modules` path, host-side re-implementation, and
  `TODO: upstream` in the tree. These are extension failures that already
  happened. Each one becomes a row. **An omitted known instance is itself a
  finding**, and it is checkable — grep for `patches/`, `vendor/`, `resolutions`,
  `overrides`, and copied constants.
- Filed requests, design-review objections, and the requesting host owner's
  stated needs.
- Author-proposed deviations, capped at two, marked as such.

The inventory, not the ledger, is the object that must be complete. **A high
fork-distance fraction over a short inventory is the primary gaming vector**, and
it is invisible from the ledger alone. Report inventory size and provenance
alongside the fraction, always.

**2. `INJECTED` requires an executable probe, not a compiling snippet.**

A row is `INJECTED` only when a test **observes the requested behavior change** —
wire the deviation, run it, assert the new behavior. Compilation is not proof.

This is the rule the earlier version of this skill got wrong, so state the failure
plainly: a package exporting `options?: Record<string, unknown>` and ignoring the
contents makes *every* host snippet typecheck. Under a compile-only standard that
package scores 5/5 while changing no behavior at all.

**Evidence is a paired differential test.** Treatment is the host wiring with the
deviation; baseline is identical wiring with only that deviation replaced by the
shipped default or its absence. Hold every other input constant. **Both runs must
reach the assertion** — no throw, timeout, or skipped assertion — and the treatment
must match the requested behavior while the baseline does not. Record both observed
values.

Three failure modes this closes, each found by a reviewer after the previous
version looked sufficient:

- *Compiles, does nothing.* `options?: Record<string, unknown>` ignored wholesale —
  every snippet typechecks, 5/5, no behavior.
- *Differs for the wrong reason.* A baseline that throws during setup "fails" by
  construction, so the row passes without the seam ever being exercised. Hence:
  both runs must reach observation.
- *Asserts the input, not the output.* Asserting that the options object you passed
  in equals what you passed in has a baseline that fails for certain and proves
  nothing. **The assertion's subject must be something the package produced** — a
  return value, rendered output, a persisted record, an emitted event — never the
  injected value echoed back, and never an incidental side channel.

**And one named judgment, deliberately not mechanized.** Attach a sentence naming
the behavior the probe verifies and why the baseline's difference is attributable
to *that* behavior. Code Inspection checks the sentence, not only the pass/fail. If
the sentence cannot be written, there is no probe.

This mirrors `INT-9` in
`<AI_DEV_SHOP_ROOT>/harness-engineering/quality/gate-validation-status.md`, which
governs the identical problem for tests generally — code that *executes* behavior
it does not *verify* — and which resolves it the same way: "this is the one member
of the closed set that leans on reviewer judgment — a real cost, accepted
deliberately… The finding must name the behaviour now unverified; if it cannot,
there is no finding." Probe fidelity was patched three times here, each fix landing
one level deeper, before this skill re-derived a conclusion the harness had already
written down. Do not add a fourth mechanical carve-out; name the judgment.

A wiring snippet with no passing treatment, a baseline that also matches, or a
baseline that never reached the assertion, is `UNPROVEN` — scoring identically to
`FORK`.

**3. Every inventory row is scored. There is no uncounted outcome.**

A deviation the package does not intend to serve is recorded as
`Scope decision: not intended to support — <reason>` **beside** its scored row. The
note never moves the numerator or the denominator.

This rule replaced three earlier attempts at an exclusion category, each of which
was the worst defect in the design at the time it existed:

- an author-declared `UNSUPPORTED` that was also *required* as a negative control —
  so the cheapest route was to move every hard row into it and report 4/4;
- its replacement, which let a scored `FORK` become uncounted "on the next run"
  once someone wrote a scope line — the same hole one release later and quieter;
- its replacement, which demanded the scope boundary be approved by "someone other
  than the package author" — a condition no reviewer can audit in a five-person
  team, where the architect, reviewer, and delivery lead all share the package's
  outcome.

Three rounds of adversarial review, three top-severity findings, one subsystem. The
pattern is the lesson: **an exclusion category is a place for demand to go and stop
being counted, and every guard on it is a process assertion rather than a
verifiable artifact.** Deleting it removes the highest-value gaming path and the
unanswerable question of who is sufficiently independent, at the cost of a fraction
that sometimes reads worse than the team's intent. That is the correct trade — the
fraction answers "what must a second host do today", which does not depend on what
anyone intended.

Intent is not lost, it is relocated: it sits next to the number, where a reader can
weigh it, instead of inside it, where it silently changes the result.

**4. The author does not own the measurement.**

Custody follows the sensor model in
`<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/dependency-structure.md`: the
measured party must not author the measurement. **Code Inspection or the
requesting host's owner authors the authoritative inventory and ledger.** The
package author may submit candidate rows, probes, and diagnostics as an advisory
preview, and may not restate them as the result.

**5. Rows have stable IDs.**

A deviation keeps its ID across ledger runs, or the delta rule below cannot see a
regression.

Row outcomes, in decreasing order of quality:

| Outcome | Meaning |
|---|---|
| `INJECTED` | Satisfied by host-supplied config, deps, or ports, with a passing behavioral probe attached. |
| `SUBCLASSED` | Satisfied only by wrapping/decorating an export the package did not design for the purpose. Probe passes; nothing protects it across versions. |
| `FORK` | Requires editing package source, patch-package, or vendoring. |
| `UNPROVEN` | Claimed satisfiable; no probe, baseline also matches, or baseline never reached the assertion. Counts as unsatisfied. |

Every inventory row lands in one of these four. Headline figure:
`INJECTED ÷ (INJECTED + SUBCLASSED + FORK + UNPROVEN)` — which is simply *every
row* — reported **only** alongside the inventory size, its provenance breakdown,
and the raw rows. A bare percentage is not a permitted output of this skill. The template, sourcing
protocol, and worked example are in `references/deviation-ledger.md`.

## Diagnostics

These explain failures. **None of them is the result.** Diagnostics run without a
ledger are seam-count theater and report as `INCONCLUSIVE` — the packages that
look best on D1 are frequently the ones that fork worst, because a package can
export many ports that all sit behind one hardwired decision.

**Use them as per-row causal tags, not as package-wide ratios.** Every denominator
here ("exported symbols", "total behaviors", "extension points") admits several
competent inventories, so two reviewers can compute different numbers from the
same package. That does not matter when the diagnostic's job is to name why row 4
forked; it matters a great deal if the number is presented as a measurement.
Compute a ratio only when you enumerate its denominator in the report, and never
report one as a result on its own.

| # | Diagnostic | Question | Failure signature |
|---|---|---|---|
| D1 | Seam density | Named injection points vs exported symbols | Behavior with no named owner the host can supply |
| D2 | Data-in vs list-owned | Does the package own a list the host must edit? | `import { panels }` instead of `buildNav(panels)` |
| D3 | Default-swap ratio | Behaviors reachable through an options/deps override | Hardwired behavior with no override path |
| D4 | Vocabulary freedom | Labels, class names, routes, copy overridable | Product identity compiled into engine code |
| D5 | Entry granularity | Subpath count, runtime tags, peer-dep posture | Forces React/Node/a router on a consumer that needs none |
| D6 | Seam openness | Points taking host behavior vs a package-owned enum | `mode: 'compact' \| 'cozy'` — the host cannot add a third |
| D7 | Seam reachability | Hops from the host's composition root; number of roots | A port threaded through four layers, or injected in six places |
| D8 | Type-level openness | Seam types generic/extensible vs sealed | Host must `as any`, declaration-merge, or widen a type |
| D9 | Instance isolation | Two configured instances, concurrently, without collision | Singleton, global registry, shared literal resource key |
| D10 | Escape-hatch ladder | Rungs per feature: component → hook → pure function → types | Only the top rung; needing 80% forces forking 100% |
| D11 | Extension-surface stability | Are the used seams documented, contract-tested, in semver? | A working seam that is not a promise |
| D12 | Change-set locality | Files and directories touched per satisfied deviation | One extension smeared across six files |
| D13 | **Lifecycle and protocol authority** | Can the host act at the phase it needs, with ordering, cancellation, and error-recovery authority? | `onSuccess` exists; the host needs to act after validation, before commit |

D6–D13 are additions to the original five. D6 is the highest-yield: a closed
option set passes D1 and D3 cleanly and still fails every deviation needing a
value outside the union. D9 is the cheapest to run. **D13 catches the class none
of the others can see** — a seam that exists, accepts host behavior, has an open
type, and still cannot be used because it fires at the wrong moment or gives the
host no authority to cancel, reorder, or recover.

Compute recipes, worked examples, and failure implications are in
`references/diagnostics.md`.

## Grouping Of Related Files

The intuition that "related files should be grouped" is real, but folder taxonomy
is the wrong thing to measure — a package can have immaculate folders and still
force a six-file edit per extension. Measure the change, not the tree. **D12 owns
all three measures and their recipes**; they are named here, not restated:

1. **Change-set locality** — files and directories touched per ledger row. The
   direct measure; comes free with the ledger.
2. **Internal shotgun ratio** — the cost of adding one instance of the package's
   own primary abstraction.
3. **Co-change coupling** — git-derived, and therefore owned by
   `<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/change-history.md`, which
   computes it. Read its pairs as evidence; do not add a second git detector here.

## Findings And Routing

Severity rubric and disposition definitions are owned by
`<AI_DEV_SHOP_ROOT>/skills/function-quality-assessment/references/finding-rubric.md`.
Do not restate them. Only the package-specific mapping lives here:

```text
inventory absent, author-owned, probe-free, ledger missing,
     or D9/D13 cross-check not performed                       -> INCONCLUSIVE
else a scored row fails against an extensibility requirement
     declared in a spec invariant, implementation-outline
     contract, or Binding CIC constraint                       -> REQUIRED  -> BLOCKED
else any RECOMMENDED finding                                   -> PASS_WITH_ADVISORIES
else                                                           -> PASS
```

`BLOCKED` is reachable **only** through the middle branch, and the report must
cite the declared requirement by name. A low fork-distance fraction on a package
whose spec declares no extensibility requirement is information, not a defect, and
routes `PASS_WITH_ADVISORIES` at most.

**This skill holds no independent blocking authority.** It is inferential, not a
detector-plus-threshold pair, so it is not registered in
`<AI_DEV_SHOP_ROOT>/harness-engineering/quality/gate-validation-status.md` and has
no `unvalidated`→`validated` promotion path. Its ceiling is permanent by design,
which is a weaker claim than the mechanical gates make — do not describe it as
having parity with them.

**Ratcheting.** Delta-based, as elsewhere in this harness: compare rows by stable
ID against the previous ledger. **Any transition from `INJECTED` to any other
scored outcome is a regression** — including `SUBCLASSED` and `UNPROVEN`, not only
`FORK`. A release that removes a documented seam but leaves a working wrapper
lowers the fraction while every row still "works", and a rule watching only
`INJECTED → FORK` would report no regression. Newly surfaced independent demand
that scores unsatisfied is also a regression. Pre-existing `FORK` rows are
grandfathered — refactor input, not a block.

**Re-running is mechanical; nobody classifies impact.** While a ledger is active,
CI runs **every treatment/baseline pair on every change under the package root**.
Regenerate the inventory and publish a ledger delta only on a public-surface
change, a change in independent demand, or any pair failure.

Do not ask a patch author whether a change is "along a seam a row depends on" —
that requires a row-to-code impact map nobody maintains, and it degrades into
either an asserted exemption or a full re-run anyway. Running every pair *is* the
full re-run, and it costs a test suite rather than a judgment. Moving
`beforeCommit` to after persistence changes no export and no type; only executing
the pairs catches it.

**Cross-row guarantees need their own pair.** An ordering, mutual-exclusion, or
always-runs-after guarantee is invisible to both rows' individual probes — each
handler's own assertion still passes after a reorder. Tag such rows co-dependent
and add one interaction pair exercising them together.

## Ownership

- **Software Architect** authors the initial deviation set when a package is being
  designed or extracted, as part of the implementation outline. Deviations decided
  here are cheap; deviations discovered after the API ships are forks.
- **Code Inspection** — or the requesting host's owner — **authors the
  authoritative inventory and ledger**, per custody rule 4. It sources demand
  independently, verifies each `INJECTED` row's pair actually observes the behavior,
  and downgrades compile-only or baseline-also-passing rows to `UNPROVEN`. For D9
  and D13 it **must record its own** entry-to-terminal-effect trace and
  literal-resource sweep — naming the paths and commands used, and listing what it
  added to any author-supplied map. **If it cannot perform that cross-check, D9 and
  D13 are `NOT_ASSESSED` and the ledger is `INCONCLUSIVE`** — reviewing the author's
  list and writing "confirmed" is not a cross-check, and reporting it as one is how
  the custody rule gets satisfied on paper and defeated in practice.
- **Programmer** submits candidate rows, probes, and diagnostics as an advisory
  preview alongside a public-surface change, and reports the fork-distance delta in
  the handoff. It does not own the result and must not restate its preview as one.
  It **may** attach an internal phase list (D13) and an external-identifier map
  (D9 check 3) as **navigation aids. They establish no completeness claim** — an
  author-supplied inventory of what the author might have gotten wrong is the
  custody problem wearing a helpful hat, and the omission that matters is the
  error-recovery phase or the rarely-touched cache key nobody thought to list.
- **Refactor** consumes `FORK` and `SUBCLASSED` rows as targeted proposals, using
  the move catalog in `references/refactor-moves.md`, and reports them in the
  format defined by `<AI_DEV_SHOP_ROOT>/skills/refactor-patterns/SKILL.md`.
- **CodeBase Analyzer** runs the full skill when a second consumer is recorded.
  Without one, it may report **only** the internal-shotgun observation (D12), the
  primary abstraction it measured against, and the files touched — in its own
  reuse-assessment format. Not a ledger row, diagnostic finding, refactor move,
  seam recommendation, outcome, or fork distance.

## Report Shape

Write the ledger to
`<ADS_MEMORY_ROOT>/reports/extensibility/EXT-<package>-<YYYY-MM-DD>.md` using the
template in `references/deviation-ledger.md`.

When run inside a review, add this section to the existing code review report
rather than creating a second artifact:

```text
## Package Extensibility

- Package: <name>
- Ledger author: <must not be the package author>
- Outcome: PASS | PASS_WITH_ADVISORIES | BLOCKED | INCONCLUSIVE
- Declared requirement cited (BLOCKED only): <name, or n/a>
- Demand inventory: <size> (<n> mechanical/fork-derived, <n> named-host stated need, <n> filed, <n> comparable-package, <n> authored)
- Known forks/patches in tree: <count found> / <count scored as rows>
- Fork distance: <injected>/<all rows> (<subclassed> subclassed, <fork> fork, <unproven> unproven)
- Probe evidence: <n>/<n> INJECTED rows have a passing treatment AND a completed baseline differing at the recorded behavioral assertion; both observed values attached per row
- Scope decisions: <n> rows carry a "not intended to support" note (scored regardless)
- D9/D13 cross-check: <own trace and sweep recorded — paths/commands> | NOT_ASSESSED
- Delta vs previous ledger: <rows regressed by ID / improved / n/a first run>
- Failing diagnostics: <D-numbers with one-line cause per failed row>
- Change-set locality: median <n> files, worst row <id> at <n> files
- Findings: <severity:tag:one-line, per finding>
- Suggested Coordinator classification: REFACTOR_RECOMMENDED | ARCHITECTURE_REVIEW_REQUIRED | SPEC_REVISION_REVIEW_REQUIRED | NONE
```

## References

- `references/deviation-ledger.md` — inventory sourcing, probe standard, template, worked example
- `references/diagnostics.md` — D1–D13 recipes and failure implications
- `references/refactor-moves.md` — failure → smallest structural move that fixes it

## Related Skills

- `<AI_DEV_SHOP_ROOT>/skills/hexagonal-architecture/SKILL.md` — port and adapter vocabulary; the host-freedom axis
- `<AI_DEV_SHOP_ROOT>/skills/api-contracts/SKILL.md` — owns whether a seam is a versioned promise (D11)
- `<AI_DEV_SHOP_ROOT>/skills/testable-design-patterns/SKILL.md` — a test seam and an extension seam are usually the same seam; owns the probe's test design
- `<AI_DEV_SHOP_ROOT>/skills/refactor-patterns/SKILL.md` — owns proposal format, behavior-preservation boundary, and risk assessment for the moves
- `<AI_DEV_SHOP_ROOT>/skills/interface-design/SKILL.md` — vocabulary and token overridability underlying D4 for UI packages
