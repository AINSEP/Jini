# Diagnostics D1–D13

These explain why a deviation failed. None of them is the result. A diagnostic
sweep with no deviation ledger is `INCONCLUSIVE` — see `SKILL.md`.

**Use these as per-row causal tags, not as package-wide ratios.** Tag row D-04 as
"failed for D6 reasons"; do not report "D6 = 0.4" as a measurement. Every
denominator below — "exported symbols", "total behaviors", "extension points",
"features", "seams a host would use" — admits several competent inventories, so
two careful reviewers will compute different numbers from the same package. That
is tolerable for a causal label and not tolerable for a measurement. If you do
compute a ratio, enumerate its denominator in the report, and never present one as
a result on its own.

There is no threshold at which a package is extensible. D1 has no correct value; a
package can hit any number on it and fork on every deviation.

---

## D1 — Seam density

**Compute:** named injection points ÷ exported symbols. An injection point is a
port, deps object field, or options field the *host supplies*. Count the point,
not the symbol that consumes it.

**Reads well when** a small number of seams carries the entire host-specific
surface — one `EditTarget` port plus two injected deps (`HtmlRegionParser`,
`HtmlDocumentStore`) is a better result than twenty scattered options, because a
host can see the whole contract at once.

**Failure signature:** host-specific behavior with no named owner — the package
decides something only the host could know, and there is no parameter where that
decision could arrive.

**Why it is not the headline:** it counts seams, not coverage. A package can have
high density and still hardwire the one decision every deviation needs. It is
also the easiest number to inflate: split one options object into five and the
ratio triples.

---

## D2 — Data-in vs list-owned

**Compute:** for each collection the package renders, dispatches on, or iterates —
is it a parameter or a module the host must edit? Count owned lists.

**Failure signature:** `import { panels } from './panels'` where the correct shape
is `buildNav(panels)`. Registries the host must call `register()` on at import
time are a softer version of the same problem: better than editing an array,
worse than passing one, because registration order becomes load-order-dependent.

**Every owned list is a fork point.** This is the highest-frequency failure in
practice and usually the cheapest to fix — the list becomes a parameter with the
current contents as the default.

**Also check:** switch statements and object maps keyed by a package-owned union.
Those are often owned lists wearing a different hat.

**Arbitration with D6 — read this before filing either finding.** D2 and D6 both
have something to say about a `switch` over a package-owned union, and they can be
made to give opposite verdicts on identical code. The boundary is *whose*
completeness the union serves:

- The package needs the set closed to reason correctly — exhaustiveness drives its
  own logic, and an unknown member would make its behavior undefined
  (`sortDirection: 'asc' | 'desc'`). **D6 governs, closed is correct, no D2
  finding.**
- The host needs to add a member the package does not yet know about, and the
  package only looks the value up or passes it through
  (`fieldType: 'text' | 'select'` where a host wants `'date'`). **D2 governs, this
  is an owned list, propose M1.**

If both are true — the package genuinely switches on it *and* a ledger row needs a
new member — the row is a real `FORK` and the move is neither M1 nor M2 alone: the
package must accept a host-supplied handler for unknown members, or the closed set
must move behind an open registry. File it as D2+D6 with that note, not as one or
the other.

---

## D3 — Default-swap ratio

**Compute:** exported behaviors reachable through an options or deps override ÷
total exported behaviors. "Behavior" means a decision with more than one
defensible answer: sort order, formatting, retry policy, validation strictness,
storage target, error rendering.

**Failure signature:** a decision with a sensible default and no way past it.
Hardwired behavior is a fork waiting for the first host that disagrees.

**Caution:** overrides that exist but cannot express what a host needs still count
here and fail at D6. Run D3 and D6 together — D3 alone rewards the closed-enum
pattern.

---

## D4 — Vocabulary freedom

**Compute:** user-visible labels, entity names, route segments, CSS class
prefixes, copy, and error strings — how many are overridable vs literal in engine
code?

**Failure signature:** product identity compiled into a reusable module. The
second host renames one entity and cannot.

**Partly enforced elsewhere** where a repo has a guard rule blocking product
identity in engine code (e.g. an `R5`-style rule in a `check:architecture`
script). Where such a rule exists, this diagnostic reads its output rather than
re-deriving it. For UI packages, the token and naming side is owned by
`<AI_DEV_SHOP_ROOT>/skills/interface-design/SKILL.md`.

**Cheap fix pattern:** a single injected `vocabulary`/`copy` map with the current
strings as the default. Do not build an i18n framework to satisfy this.

---

## D5 — Entry granularity and runtime posture

**Compute:** subpath export count; per-entry runtime tags (browser / node / edge /
react / framework-free); dependency posture — hard `dependencies` vs
`peerDependencies` vs adapter.

**Failure signature:** a consumer that needs the pure logic must take React; a
consumer that needs the client must take a Node driver; a module-scope
`import 'next/navigation'` makes the package Next-only regardless of how many
seams it has.

**Why this is an extensibility axis and not just packaging:** a host that cannot
*load* the package in its runtime has a fork distance of zero satisfiable
deviations, and no seam count changes that. Check this first for any package
crossing a runtime boundary — it can invalidate the rest of the assessment.

**Also check:** side effects at module scope — env reads, singleton construction,
CSS imports, registry mutation. These make the package unusable in runtimes and
test harnesses that never call its API.

---

## D6 — Seam openness (open vs closed extension points)

**Compute:** extension points that accept **host-supplied behavior** (a function,
an interface implementation, a component) ÷ all extension points. Points that
accept only a value from a package-owned union or enum are **closed**.

```ts
density: 'comfortable' | 'cozy'          // closed — the host cannot add a third
rowHeight: (row: Row) => number          // open
variant: Variant                         // closed
renderCell: (cell: Cell) => ReactNode    // open
```

**Failure signature:** the host wants a value outside the union. There is no
escape, and the option's existence made the gap harder to see — it looked
addressed.

**This is the most commonly missed failure.** A closed option passes D1 (it is a
named injection point), passes D3 (the behavior is overridable), is documented,
is typed, and still forks. Any assessment that runs D1 and D3 without D6 will
overstate the package.

**Not every option should be open.** Closed sets are correct where the package
must reason about the value — a `sortDirection` of `'asc' | 'desc'` is closed
because the package's own logic depends on exhaustiveness. The finding is a closed
set on a decision the package does *not* reason about, only passes through.

**See the arbitration rule under D2** before filing a finding on a `switch` over a
package-owned union. "Does the package switch on it?" is not sufficient on its own
— the question is whether the package's own correctness needs the set closed, or
whether it merely looks the value up while a host needs a new member.

**Hybrid form worth preferring:** accept the union *or* a function —
`density: Density | ((row: Row) => number)`. Keeps the common path terse and the
uncommon path possible.

---

## D7 — Seam reachability

**Compute:** two numbers per seam. (a) Hops from the host's composition root to
the point of use — how many intermediate layers must thread the value. (b) Number
of places the host must inject the same dependency.

**Failure signature:** a port that exists but must be passed through four
component or call layers, so the host prop-drills or gives up; or a dependency the
host must supply in six separate call sites, so the six drift.

**An unreachable seam is not a seam.** Hosts do not thread values through layers
they do not own; they fork or they wrap. This diagnostic catches the case where
D1–D6 all look good and adoption still fails.

**Target shape:** one composition root per package — a single `createX(deps)`,
provider, or container that the host configures once, with internals reading from
it rather than receiving it. Note the tradeoff honestly: a container improves
reachability and weakens explicitness, which
`<AI_DEV_SHOP_ROOT>/skills/coding-foundations/SKILL.md` prefers. Prefer explicit
passing at one or two hops; introduce a root when the count exceeds that.

---

## D8 — Type-level openness

**Compute:** of the types crossing a seam, how many are extensible by the host —
generic parameters, index signatures, open unions, or a `meta`/`extra` carrier —
vs sealed concrete shapes?

```ts
interface Row { id: string; name: string }                 // sealed
interface Row<TMeta = unknown> { id: string; meta: TMeta } // open
```

**Failure signature:** the host's domain object has three fields yours does not.
It reaches the seam as `as any`, a declaration merge, a parallel type, or a
`@ts-expect-error`. All four are unsupported extensions — nothing tells the
package author they exist, and the next release breaks them silently.

**Why it earns a slot:** a runtime seam with a sealed type is only half a seam.
The behavior is injectable and the data is not, so the host can change *how* but
never *what*. In typed languages this is where "we have ports" and "we forked it"
most often coexist.

**Also check:** are the seam's types exported at all? A host that must
re-declare a parameter type because it is not exported is already forking the
contract.

---

## D9 — Instance isolation

**Compute:** three checks, all required. The first alone passes packages that
still collide in production.

1. **Two instances, sequentially.** Construct two differently-configured instances
   in one process and use both. Binary.
2. **Two instances, interleaved.** Drive them concurrently with distinct
   observable configurations and assert neither sees the other's. A package with a
   clean factory can still route one host's request through the other's policy via
   an async-local context, a shared interceptor list, or ambient config mutated per
   call. Sequential use never reveals it.
3. **External identifier sweep.** Grep for string-literal resource names —
   `localStorage`/`sessionStorage` keys, cache prefixes, DB table or collection
   names, IPC/BroadcastChannel names, global custom-event names, CSS class
   prefixes, temp file paths, metric names. Each must be parameterized or
   instance-derived.

Check 3 exists because check 1 runs in-process and cannot see it: two instances
with a perfectly clean factory both write `localStorage['app-cache']`, pass every
unit test, and corrupt each other the first time two real hosts run side by side.

**Failure signature:** module-level singletons, global registries, import-time env
reads, a shared cache keyed without instance identity, a `let` at module scope
holding config, hardcoded external resource names, async context leaked across
instances.

**This is the cheapest and least fakeable diagnostic in the set.** It is a test
someone writes in ten minutes and it either passes or does not. Run it early.

**What it predicts:** it is the runtime analogue of fork distance. A package that
cannot hold two configurations at once cannot serve two hosts inside one
application — multi-tenant, embedded preview, a migration running old and new side
by side, or simply a test suite that needs a second configuration. Failures here
also make every other seam untestable in isolation, which is why this overlaps
with `<AI_DEV_SHOP_ROOT>/skills/testable-design-patterns/SKILL.md`: the test seam
and the extension seam are usually the same seam.

---

## D10 — Escape-hatch ladder

**Compute:** per feature, count the exported rungs:

1. composed component / facade / one-call entry
2. hook / controller / orchestration function
3. pure function / policy / reducer
4. types and constants

**Failure signature:** only rung 1 is exported. A host needing 80% of the behavior
must reimplement 100% of it, and will — usually by copying the source, which is
the worst kind of fork because it never reports itself.

**Ratio to report:** features exposing ≥2 rungs ÷ total features. Rungs 1 and 3
are the highest-value pair: the easy path and the "I need to own the rendering
but not the logic" path.

**This is often the correct fix for the hardest ledger rows.** A deviation that
cannot be expressed as an option frequently *can* be expressed as "use our hook,
render your own body" — a lower rung costs the package nothing to expose and
removes a whole class of fork.

**Caution:** every exposed rung is public surface with a version contract (D11).
Expose rungs deliberately, and say which are supported.

---

## D11 — Extension-surface stability

**Compute:** of the seams a host would actually use, how many are

- exported from a documented entry point (not deep-imported from `dist/`),
- covered by a contract test or type test that fails when the shape changes,
- named in the changelog and inside the semver promise?

**Failure signature:** a seam that works today and is not a promise. The host
extends through it; the next minor changes it; the host pins the version and then
forks anyway. `SUBCLASSED` ledger rows are almost always this.

**Ownership:** the versioning and compatibility policy itself belongs to
`<AI_DEV_SHOP_ROOT>/skills/api-contracts/SKILL.md` and
`<AI_DEV_SHOP_ROOT>/skills/api-design/SKILL.md`. This diagnostic only asks whether
the seams the ledger relies on are inside that policy's scope. Do not restate
compatibility rules here.

**Related, cheap, worth one line in the ledger — failure legibility:** when a host
injects something wrong, does it fail at wiring time with an actionable message,
or three layers deep at render time with a null dereference? This does not change
whether a deviation is satisfiable; it changes whether a host completes the
attempt. Record it as adoption cost on the row.

---

## D12 — Change-set locality

**Compute:** per satisfied ledger row, the distinct **files** and **directories**
the host touches. Report the median and the worst row.

**Reference values:** a well-formed `INJECTED` row touches one file — the host's
composition root. Two is acceptable when one is a type declaration. Four or more
means the concern is smeared and the package's folder layout is not the reason.

**Internal shotgun ratio (run this even with no second host):** add one instance
of the package's own primary abstraction — a new panel, field type, provider,
rule — and count files touched inside the package. This is the internal analogue
of fork distance, it is available before any second consumer exists, and it is the
best available leading indicator: a package costing its own author five files per
new instance will cost a host at least that.

**Co-change coupling:** files that historically change together but live in
different modules is the empirical version of "related files should be grouped."
It is git-derived and therefore belongs to
`<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/change-history.md`, which owns
git-derived signals. That sensor now computes it — see its Co-Change Coupling
section for the definitions and the reference implementation. Read its pairs;
do not add a second git detector inside this skill, because a rule with two
homes drifts.

**A `hidden` pair is evidence for D12, not a D12 finding.** The sensor measures
the whole repository over a time window; D12 scores one package against ledger
rows. A pair the sensor reports inside this package is a place to look for the
change-set locality D12 actually measures — it does not substitute for counting
the files a ledger row touches.

**Do not measure folder taxonomy.** "Are related files in the same directory" is
not the question and rewards reorganizations that change nothing. A package with
immaculate folders can still cost six files per extension; a flat package can cost
one.

---

## D13 — Lifecycle and protocol authority

**Compute:** for each seam a ledger row uses, ask four questions the other
diagnostics never ask:

1. **Phase** — does the hook fire at the moment the host needs to act? List the
   package's internal phases (validate → authorize → persist → commit → notify)
   and mark which are host-reachable.
2. **Ordering** — when several host-supplied handlers exist, is the order defined
   and controllable, or incidental to registration or object-key order?
3. **Authority** — can the host *stop* things: reject, cancel, veto, short-circuit,
   or substitute a result? Or is the hook notify-only?
4. **Error and recovery path** — can the host intercept a failure, retry with
   different parameters, or supply a fallback? Or does the package own recovery and
   swallow, log, or rethrow on its own terms?

**Failure signature:** the seam exists, accepts a host function, has an open type,
is reachable, is documented — and still cannot serve the deviation, because
`onSuccess` fires after commit while the host must act between validation and
commit. Nothing in D1–D12 detects this. Every one of them passes.

**This is the class the other twelve are structurally blind to.** D1–D12 all
examine the seam's *shape* — where it is, what it accepts, what type it carries,
who can reach it. D13 examines *when it runs and what it is allowed to do*, which
is invisible from the signature. A package can score perfectly on shape and be
unextendable on protocol.

**Cheapest probe:** take the package's own primary operation and ask "could a host
prevent this from completing, based on its own rule, without editing our source?"
If the answer is no, every deviation involving host policy is a fork, whatever the
seam count says.

**Typical moves when it fails:** promote a notify-only callback to a
decision-returning one (`onBeforeCommit(ctx) => void | Rejection`); expose the
phase list as explicit named hooks rather than one terminal callback; give the host
the error object and let it choose retry/fallback rather than owning recovery
internally.

**Arbitration with D10.** Both can be read onto the same failure — a package
exporting only a facade with a post-commit `onSuccess` looks like a missing rung
(D10) *and* a missing decision point (D13). Split them by what the host lacks:

- **D10 — access.** The host cannot *reach* the logic at all; the phase exists
  internally but no export exposes it. Fix by exposing a lower rung (M8).
- **D13 — authority.** The host can reach it and still cannot *act*: the hook
  fires at the wrong phase, or is notify-only, or cannot reject, reorder, or
  recover. Fix by promoting the control point (M12).

A row failing both is tagged **D10+D13**, and **M8 runs first** — exposing the rung
often reveals that the host can already achieve the deviation by composing at the
lower level, which retires the row without a new control-flow API. Do not file M12
before M8 has been considered and rejected in writing.
