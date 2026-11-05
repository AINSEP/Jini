# Deviation Ledger — Protocol And Template

The ledger is the headline result of `package-extensibility`. It answers one
question per row: **would a second host get this by wiring, or by editing our
source?**

## Step 1 — Build the demand inventory (before any row is scored)

**The inventory is the object that must be complete, not the ledger.** A high
fraction over a short inventory is the cheapest way to fake this assessment, and
it is invisible from the ledger alone. So the inventory is enumerated first, by
someone other than the package author (custody rule 4 in `SKILL.md`), and its size
and provenance are reported next to every fraction.

**Sweep the tree first. These rows are mandatory, not optional:**

```bash
# extension failures that already happened — each becomes a row
ls patches/ 2>/dev/null                     # patch-package
rg '"(resolutions|overrides)"' -A5 package.json */package.json
fd -t d 'vendor|third[-_]party|forked'
rg -n 'TODO:? *upstream|@ts-expect-error.*package|patched|monkey.?patch'
```

Every hit is a deviation the package already failed to serve. **An omitted known
instance is itself a finding** — it is grep-checkable, so omission is detectable
and must be reported as such rather than argued about.

Then add, in descending order of evidentiary value:

| Source | Why it counts |
|---|---|
| An existing fork, `patch-package` entry, vendored copy, or monkey-patch | The extension already failed. Free, undeniable data. **Mandatory row.** |
| A host-side workaround in the tree — a wrapper that re-implements package behavior, a copied constant, a CSS override sheet | Same, one step earlier. **Mandatory row.** |
| A named prospective host's stated need | Real demand, not yet attempted. |
| A filed request, issue, or design review comment | Real demand, weaker specificity. |
| A comparable package's supported extension | Market evidence the axis matters. |
| Authored by the package's own team | Weakest. Cap at two rows, and mark them. |

Five to eight scored rows is the usual working size, but **the cap applies to the
easy sources, never to the mandatory ones**. If the sweep turns up nine patches,
the ledger has at least nine rows. Trimming the inventory to reach a comfortable
count is the failure this whole protocol exists to prevent.

A ledger built entirely from authored rows is `INCONCLUSIVE`. The author's
imagination of what a second host wants is the thing being tested, not the input.

**Assign each row a stable ID** (`D-01`, `D-02`, …) and keep it across runs. The
ratchet in `SKILL.md` compares by ID; renumbered rows make regressions invisible.

**Write deviations as concrete behavior changes, not as capabilities.** "Support
custom auth" is a capability and is unfalsifiable. "Swap Clerk for a host-supplied
session provider that returns `{userId, roles}` from a cookie" is a deviation — you
can try to wire it and find out.

## Step 2 — Probe each one

For each deviation, write the composition-root code a host would actually write,
against the package's **current** exports and types. Not pseudocode. Not "you'd
pass a `renderRow` here" — the snippet, with the real symbol names.

**Then run it and assert the behavior changed.** A compiling snippet is not
evidence. This is the standard the first version of this protocol got wrong, and
the counterexample is trivial to build: a package that accepts
`options?: Record<string, unknown>` and ignores the contents makes *every* host
snippet typecheck, and would score 5/5 under a compile-only rule while doing
nothing. Type compatibility proves the host can call the seam. Only an assertion
on observed output proves the seam does anything.

The probe is a normal test — same design rules as
`<AI_DEV_SHOP_ROOT>/skills/testable-design-patterns/SKILL.md`. It wires the
deviation, exercises the package, and asserts the *requested* behavior, not merely
that nothing threw.

**Use a paired differential test.** "Asserts something observable" is not the
standard. The standard is *the injected value, and not the default, caused the
observed result*:

1. **Treatment** — the host wiring with the deviation.
2. **Baseline** — identical wiring with only that deviation replaced by the shipped
   default or its absence. Hold the stimulus and every non-deviation input
   constant.
3. **Both runs must reach the assertion.** No throw, timeout, or skipped assertion
   on either side.
4. **Treatment matches the requested behavior; baseline does not.** Record both
   observed values on the row.
5. **The assertion's subject must be something the package produced or observed** —
   a return value, rendered output, a persisted record, an emitted event. Never the
   injected configuration echoed back, never a prop or options passthrough, never an
   incidental side channel (an unset-env throw, timing, an unrelated mock's call
   count).

Each numbered rule closes a hole a reviewer found after the previous version looked
sufficient. Rule 3 exists because a baseline that throws during setup "fails" by
construction — the row scores without the seam ever being exercised. Rule 5 exists
because `expect(wrapper.prop('overrides')).toEqual({organization:'Account'})` is a
real assertion with a baseline that fails for certain, and proves only that you
passed an object to a component; whether anything ever rendered from it is
untouched.

**Then write the sentence.** Name the behavior this pair verifies, and why the
baseline's difference is attributable to *that* behavior rather than a side
channel. Code Inspection checks the sentence, not only the pass/fail. **If the
sentence cannot be written, there is no probe.**

That last rule is deliberately a judgment call, and it is where mechanization
stops. Probe fidelity was patched three times in this skill — compile-only, then
control-run, then assertion-subject — each fix one level deeper than the last, which
is the signature of trying to fully specify something that cannot be. The harness
already settled this for tests generally in `INT-9`
(`<AI_DEV_SHOP_ROOT>/harness-engineering/quality/gate-validation-status.md`), which
governs code that *executes* behavior it does not *verify*, accepts reviewer
judgment as "a real cost, accepted deliberately", and guards it with exactly this
device: the finding must name the behavior, and if it cannot, there is no finding.
Do not add a fourth mechanical carve-out here.

Then classify:

- **`INJECTED`** — the wiring uses only documented, exported, intentional extension
  points, and the differential pair passes all five rules. Attach wiring, treatment,
  baseline, both observed values, and the sentence.
- **`SUBCLASSED`** — the pair behaves as above, but only via wrapping, decorating,
  re-exporting, or reaching into an export not designed for this. Attach the same
  evidence and name what makes it fragile: usually "nothing prevents a minor version
  from changing this."
- **`FORK`** — it requires editing package source, a patch file, or a vendored
  copy. Record the smallest edit that would work; that edit is the refactor
  proposal.
- **`UNPROVEN`** — believed satisfiable, but no pair; a pair that only typechecks;
  a baseline that also matches; a baseline that never reached the assertion; an
  assertion on echoed input; or no attributability sentence. **Scores identically to
  `FORK`.** The failure mode defended against is a confident claim about a seam
  nobody exercised.

Four outcomes, and **every inventory row lands in one of them.** Do not soften a
`FORK` into a `SUBCLASSED` because a wrapper *could* be written — if it does not
exist and pass a pair, it is `UNPROVEN`.

## Step 3 — Every row is scored; scope is a note, not an outcome

There is no uncounted outcome. A deviation the package does not intend to serve
gets `Scope decision: not intended to support — <reason>` recorded **beside** its
scored row. The note never touches the numerator or the denominator.

This replaced three successive attempts at an exclusion category, each of which was
the worst defect in this protocol while it existed:

1. `UNSUPPORTED` as an author-declared, uncounted outcome that was also *required*
   as a negative control — so the cheapest available move was to shift every hard
   row into it and report 4/4.
2. Its replacement, which said the right response to a `FORK` was "a stated
   boundary in the spec, which then makes the row `UNSUPPORTED` on the next run" —
   the same hole one release later and quieter.
3. Its replacement, which required the scope boundary to be "approved by someone
   other than the package author" — unauditable in a five-person team, where the
   architect, reviewer, and delivery lead all share the package's outcome, and no
   reviewer can check the relationship from the artifact.

Three rounds of adversarial review produced three top-severity findings, all in
this one subsystem. **An exclusion category is a place for demand to go and stop
being counted, and every guard on it turned out to be a process assertion rather
than a checkable artifact.** So it is gone.

Declaring something out of scope remains a real and often correct decision. It is
simply not a scoring move: say plainly in the report that this deviation is `FORK`,
that you do not intend to serve it, and why. The fraction answers "what must a
second host do today", which does not depend on what anyone intended — and intent
sits next to the number where a reader can weigh it, rather than inside it where it
silently changes the result.

The credibility check `UNSUPPORTED` was originally meant to provide is carried by
the inventory's provenance record in Step 1: mandatory rows the author did not
choose.

## Step 4 — Diagnose the failures

For every `FORK`, `SUBCLASSED`, and `UNPROVEN` row, name the diagnostic that
explains it (D1–D13, see `diagnostics.md`) and the smallest structural move that
would flip it (see `refactor-moves.md`). A failed row with no named cause is a
complaint; a failed row with a named cause is a refactor proposal.

Tag the diagnostic **per row**. Do not compute package-wide D-ratios here — they
are causal labels, and their denominators are not agreed enough between reviewers
to survive being presented as measurements (see the note at the top of
`diagnostics.md`).

## Step 5 — The second-host fixture (strongest form)

Hand-run probes rot silently. If the package matters enough, promote them: keep a
**second-host fixture** in the repo — a minimal, buildable example consumer that
differs from the primary host along the ledger's deviations, whose probes run in
CI.

This is the same discipline as the conformance fixtures in
`<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/dependency-structure.md`: a claim
about a seam that is never exercised fails silently and completely. Once a fixture
exists, `INJECTED` rows it covers are proven mechanically rather than by review,
and a change that breaks one fails the build instead of the next reviewer's
attention.

A single fixture app that exercises four deviations is worth more than four
carefully worded ledger rows.

## Template

````markdown
# Extensibility Ledger — <package>

- Date: <YYYY-MM-DD>
- Commit: <sha>
- Ledger author: <must not be the package author — custody rule 4>
- Package author (advisory input only): <agent/human>
- Fixture: <path to second-host fixture, or "none">
- Previous ledger: <path, or "first run">

## Demand Inventory

- Size: <n> candidate deviations
- Provenance: <n> fork/patch/workaround (mandatory), <n> named-host stated need, <n> filed request, <n> comparable-package, <n> authored (cap 2)
- Tree sweep: <n> patches/vendored copies/TODO-upstream found → <n> scored as rows
- Omitted known instances: <none, or list — each is a finding>

## Fork Distance

**<injected>/<all rows>** injected — <subclassed> subclassed, <fork> fork, <unproven> unproven. Every inventory row is scored; there is no uncounted outcome.

Probe evidence: <n> of <n> INJECTED rows have a passing treatment AND a completed baseline that differs at the recorded behavioral assertion. Both observed values attached per row.
Delta vs previous (by row ID): <improved / regressed / first run>

## Deviations

| ID | Deviation | Source | Outcome | Pair | Baseline differs? | Scope note | Files | Diag | Smallest move |
|---|---|---|---|---|---|---|---|---|---|
| D-01 | <concrete behavior change> | <fork/workaround/named host/request/authored> | INJECTED | <test path> | yes | — | 1 | — | — |
| D-02 | ... | ... | FORK | — | — | not intended to support: <reason> | 3 | D6 | <move> |

## Evidence

### D-01 — <deviation>

Wiring:
```ts
// host composition root
```
Probe (asserts the behavior, not that it compiles):
```ts
// test path — expect(<observed behavior>).toBe(<requested behavior>)
```
Baseline (identical wiring, deviation replaced by the shipped default):
```ts
// must REACH the assertion and NOT match
// observed: <value>   |  treatment observed: <value>
// did not reach the assertion, or also matched -> row is UNPROVEN
```
Attributability: <one sentence — the behavior this pair verifies, and why the
difference is caused by that behavior rather than a side channel. If it cannot be
written, there is no probe.>

### D-02 — <deviation> (FORK)

Smallest package edit required:
```ts
// packages/<name>/src/<file>.ts:NN
```

## Scope Decisions

Rows the package does not intend to serve. **These are scored normally above** — this section records intent, and changes no count.

- **D-0n <deviation>** (scored `<outcome>`) — not intended to support. Reason: <why>. Reference: <spec/outline/CIC, if any>

## Findings

- `<severity>:<tag>` — <claim> at <location>. Consequence: <what a host hits>.
````

## Worked Example — an admin package

Primary host: Tovu. Second host: an internal ops console, owner named. Ledger
authored by Code Inspection, not the package team.

**Demand inventory: 7 candidates** — 2 mechanical from the tree sweep (one
`patches/` entry, one host wrapper), 2 from the named host's stated needs, 1 filed
request, 2 authored (at the cap). All 7 scored — there is no uncounted outcome.

| ID | Deviation | Source | Outcome | Pair | Baseline differs? | Files | Diag | Smallest move |
|---|---|---|---|---|---|---|---|---|
| D-01 | Swap Clerk for a host session provider returning `{userId, roles}` | named host | INJECTED | `session.ext.test.ts` | yes — default returns Clerk's `sub`, probe asserts the cookie's `userId` | 1 | — | — |
| D-02 | Add a nav item Tovu does not have | host workaround — console wraps and re-sorts nav | FORK | — | — | 4 | D2 | `buildNav(items)` instead of an owned `navModule` |
| D-03 | Rename the `Organization` entity to `Account` in all UI copy | filed request | SUBCLASSED | `vocab.ext.test.ts` | yes | 2 | D4 | Route labels through an injected `vocabulary` map instead of literals |
| D-04 | Denser table rows than Tovu's default | authored | FORK | — | — | 1 | D6 | `density` is `'comfortable' \| 'cozy'`; take a row-height resolver instead |
| D-05 | A panel that is not CRUD — a read-only report with a chart | named host | FORK | — | — | 6 | D10 | Export the panel *shell* and data hook separately from `CrudPanel` |
| D-06 | Run a host authorization check between validation and commit | `patches/` entry | FORK | — | — | 2 | D13 | `onSuccess` fires post-commit; expose a `beforeCommit` hook that can reject |
| D-07 | Replace the persistence layer with the host's own API client | authored | FORK | — | — | 3 | D2 | *Scope note: not intended to support — the `EditTarget` port already spans this. **Still scored.*** |

**Fork distance: 1/7.** One injected, one subclassed, five fork. Probe evidence:
1 of 1 claimed `INJECTED` rows has a passing treatment and a completed baseline that
differs at the assertion.

Read what the example demonstrates:

- D-01 passing tells you the *auth* seam was designed. It says nothing about the
  other six, which is exactly why D1 seam density cannot be the headline — this
  package has real ports and still forks five times out of seven.
- D-02 and D-05 are the expensive ones, and the two the package's own team was
  least likely to author: both are shaped by the second host's product, not the
  first's. That asymmetry is why the inventory is sourced independently.
- **D-06 only exists because of the tree sweep.** A `patches/` entry was already in
  the repo. Nobody would have proposed this row from memory, and it is the row that
  most clearly proves the package forces forks — the host had already written one.
  This is what the mandatory-sweep rule buys.
- D-04 is the D6 pattern in its purest form: a `density` option exists, is
  documented, typed, and overridable — and cannot express the value the host wants.
  It would read as a seam under both D1 and D3.
- **D-07 carries a scope note and is scored anyway.** The team does not intend to
  serve it and says so — next to the row, not instead of it. Earlier versions of
  this protocol would have moved D-07 out of the denominator and reported 1/6
  instead of 1/7. The note is the honest form: a reader sees both what a second host
  faces and what the team intends, and neither one silently edits the other.
- D-05's file count (6) is the change-set locality signal. Even if the fork were
  accepted, an extension costing six files is a liability for whoever rebases it.
