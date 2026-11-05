# Refactor Moves

Each move maps a failed ledger row to the **smallest** structural change that
flips it. Report these through the proposal format in
`<AI_DEV_SHOP_ROOT>/skills/refactor-patterns/SKILL.md` — this file supplies the
move, not the proposal shape, the risk assessment, or the blast-radius rule.

The package-specific mechanism that keeps these moves inside the refactor
boundary: **the current behavior becomes the default**, so the primary host's
output is unchanged. The boundary itself — what counts as behavior-preserving, and
where a change stops being a refactor — is owned by `refactor-patterns` and is not
restated here.

## Ordering

Run in this order when several apply. It is roughly cheapest-and-highest-yield
first, and the early moves often eliminate later rows.

1. **M6 singleton → factory** — unblocks everything else and is testable immediately
2. **M1 owned list → parameter** — highest frequency, smallest diff
3. **M2 closed union → open** — the failure most often mistaken for a solved one
4. **M8 rung split** — the usual fix for rows nothing else can reach
5. everything else, driven by the ledger

---

## M1 — Owned list → parameter (D2)

**Symptom:** the host must edit an array, object map, or index file inside the
package to add an item.

```ts
// before
import { panels } from './panels'
export function AdminShell() { return <Nav items={panels} /> }

// after
export const defaultPanels = panels
export function AdminShell({ panels = defaultPanels }: { panels?: Panel[] }) {
  return <Nav items={panels} />
}
```

**Cost:** one parameter, one exported default. **Risk:** low — the default
preserves behavior exactly.

**Do also:** export the item *type*, or the host cannot construct a valid entry
(D8). Exporting the list without its type converts a D2 failure into a D8 one.

**Variant — registry:** if the package uses `register()` at import time, the same
move applies and additionally removes load-order dependence, which is a latent bug
independent of extensibility.

---

## M2 — Closed union → open, or hybrid (D6)

**Symptom:** an option is typed as a package-owned union and the host wants a
value outside it.

```ts
// before
density: 'comfortable' | 'cozy'

// after — hybrid keeps the common path terse
density: Density | ((row: Row) => number)
```

**Decide first whether the set should be open at all.** If the package `switch`es
on the value to make a decision, exhaustiveness is load-bearing and the closed set
is correct — the finding is elsewhere. If the value is only looked up in a
constant map and passed through, the closed set has no justification.

**Cost:** one type widening plus a resolver at the point of use. **Risk:** low.
**Watch:** every open value must still produce a valid render/result; add a
validation path or the failure moves to runtime (D11 failure legibility).

---

## M3 — Hardwired decision → deps field (D3)

**Symptom:** a behavior with more than one defensible answer has exactly one, in
package source.

**Move:** lift it to a named field on the existing deps or options object with
the current implementation as the default. **Do not create a new deps object per
decision** — that inflates D1 and makes the contract unreadable. One deps object
per package, or one per port.

**When not to:** the decision is an invariant the package must guarantee
(validation that protects a data contract, an auth check). Do not open a seam
there.

**But the row is still scored.** There is no uncounted outcome — see Step 3 of
`deviation-ledger.md`. A host that already patched the package to bypass an auth
invariant has a `FORK` row; "we consider this an invariant" is a scope note recorded
beside it, not a label that removes it from the denominator.

---

## M4 — Literal copy → injected vocabulary map (D4)

**Symptom:** entity names, labels, routes, or class prefixes are string literals
in engine code.

```ts
// after
const defaultVocabulary = { organization: 'Organization', member: 'Member' }
createAdmin({ vocabulary: { ...defaultVocabulary, organization: 'Account' } })
```

**Cost:** one map, one merge at the boundary. **Risk:** low, mechanical.

**Do not build an i18n framework to satisfy this diagnostic.** A flat overridable
map is the whole move. If the package genuinely needs localization, that is a
separate feature with its own spec.

---

## M5 — Sealed type → generic or meta carrier (D8)

**Symptom:** the host's domain object has fields the seam's type does not permit,
so the host reaches the seam through `as any`, a declaration merge, or a parallel
type.

```ts
// before
interface Row { id: string; name: string }
// after
interface Row<TMeta = unknown> { id: string; name: string; meta?: TMeta }
```

**Prefer a generic parameter with a default** over an index signature — a default
keeps every existing call site compiling, while `[k: string]: unknown` disables
excess-property checking for everyone and hides real typos.

**Cost:** generic threading through the seam's call chain, which can be wide.
**Risk:** medium — this is the one move here that reliably touches many files.
Scope it to the types the ledger actually crosses, not to every type in the
package.

---

## M6 — Singleton → factory + instance (D9)

**Symptom:** two configured instances cannot coexist. Module-level `let`, a global
registry, an import-time env read, an unkeyed shared cache.

```ts
// before
export const client = new Client(process.env.API_URL!)
// after
export function createClient(config: Config) { return new Client(config) }
export const defaultClient = /* temporary lazy compatibility export */ createClient(configFromEnv())
```

**Keep a lazy default export only as a temporary compatibility step** so existing
consumers do not change during migration. Lazy matters: an eager default
re-introduces the import-time env read the move exists to remove. Add a removal
note naming the remaining consumers and the migration to composition-root
injection; remove the export when they have migrated. The final dependency rule
is Core Rule 1 in `<AI_DEV_SHOP_ROOT>/skills/coding-foundations/SKILL.md`.

**Cost:** a factory plus threading the instance to its use sites, which frequently
surfaces a D7 reachability problem underneath. **Risk:** medium, and it is the
highest-value medium-risk move in this file — it usually converts a package from
untestable to testable at the same time.

---

## M7 — Prop-drilled port → one composition root (D7)

**Symptom:** a seam exists but must be threaded through several layers the host
does not own, or injected at six separate call sites.

**Move:** a single `createX(deps)` / provider / container the host configures
once; internals read from it.

**Tradeoff, stated honestly:** this trades explicitness for reachability, and
`<AI_DEV_SHOP_ROOT>/skills/coding-foundations/SKILL.md` prefers explicit
dependencies. Prefer explicit passing at one or two hops. Introduce a root when
the hop count exceeds that or when the same dep is injected in three or more
places — below that threshold the container costs more clarity than it buys.

---

## M8 — Rung split (D10)

**Symptom:** a host needs most of a feature but must own part of it, and only the
composed top-level entry is exported. Usually the fix for ledger rows that no
option can reach.

**Move:** split one export into rungs and export at least two.

```ts
// before: <CrudPanel entity="user" />
// after
export function usePanelData(entity: string) { /* fetch, paginate, sort */ }
export function PanelShell(props) { /* chrome, layout, empty/error states */ }
export function CrudPanel(props) { /* composes the two — unchanged behavior */ }
```

**Cost:** moderate; the split is mechanical but the seam between rungs must be
designed, not just cut where the file happened to break.

**Constraint:** every rung you export is public surface with a version contract
(D11). Export deliberately and say which rungs are supported — an accidental rung
is a `SUBCLASSED` row waiting to happen.

---

## M9 — Barrel-only exports → subpath entries (D5)

**Symptom:** a consumer needing pure logic must take React; a consumer needing the
client must take a Node driver; the whole package loads to use one function.

**Move:** subpath exports with per-entry runtime tags, splitting along the runtime
boundary the consumer actually cares about (browser / node / edge /
framework-free), not along internal folder structure.

**Also:** move framework packages to `peerDependencies`, and remove module-scope
imports that pin a framework (`next/navigation` at module scope makes the package
Next-only regardless of its seams).

**Cost:** build and packaging config, plus a subpath-resolution test. **Risk:**
low functionally, but it is a public-surface change — coordinate with
`<AI_DEV_SHOP_ROOT>/skills/api-contracts/SKILL.md`.

---

## M10 — Deep import → documented entry + contract test (D11)

**Symptom:** the wiring snippet for an `INJECTED` or `SUBCLASSED` row imports from
`dist/`, `src/internal/`, or an undocumented path.

**Move:** promote the symbol to a documented entry point and add a test that fails
when its shape changes. Then it is a promise rather than an accident.

**Or take the other branch deliberately:** decide the seam is *not* supported and
tell the host. An honest "no" is a better result than an undocumented "yes" that
breaks on the next minor. **The row stays scored** — there is no uncounted
outcome (Step 3 of `deviation-ledger.md`). Record the decision as a scope note
beside the row; Refactor proposes the decision, it does not remove the row.

---

## M11 — Module-scope side effect → lazy init (D5, D9)

**Symptom:** importing the package reads env, constructs a client, mutates a
registry, or imports CSS. The package is unusable in runtimes and test harnesses
that never call its API.

**Move:** move the work behind the first call or into the factory from M6.
**Cost:** low. **Risk:** low, with one real exception — anything depending on
import-order side effects breaks, and that dependency was a latent bug.

---

## M12 — Notify-only callback → decision point (D13)

> **M12 is not a Refactor move.** It adds a control-flow path and a new public
> commitment, which is an API change — Refactor may *identify* and propose it, but
> it routes to Software Architect (contract) and Programmer (implementation), not
> into a refactor batch. Every other move in this file preserves behavior by making
> the current behavior the default; a rejection path cannot fully do that, because
> the ability to reject is the feature. Shipping it as a "refactor" is how a new
> API arrives without the review an API deserves.
>
> **Try M8 first.** Per the D10/D13 arbitration in `diagnostics.md`, exposing a
> lower rung often lets the host compose the behavior at the level below and retires
> the row with no new control point at all. File M12 only after M8 has been
> considered and rejected in writing.

**Symptom:** the host must act at a phase the package does not expose, or must be
able to stop/alter an operation and can only observe it. `onSuccess` exists; the
host needs to reject between validation and commit.

```ts
// before — notify-only, fires after commit
onSuccess?: (result: Result) => void

// after — a phase the host can reach, with authority to stop
beforeCommit?: (ctx: Ctx) => void | { reject: string }
onError?: (err: PackageError, ctx: Ctx) => 'retry' | 'fallback' | 'rethrow'
```

**Cost:** the package must name its internal phases and commit to them as a
protocol — the most expensive move in this file, and the one most likely to be a
real API change rather than a refactor. **Risk:** medium-high; adding a rejection
path changes control flow, so the "current behavior becomes the default" rule
means the new hook must default to a no-op that cannot alter the outcome.

**Do the smallest version first.** One `beforeCommit` that a ledger row actually
needs beats a full lifecycle API. A general hook system built before a second
consumer exists is the "plugin system with no plugins" anti-pattern below.

---

## Moves That Look Like Extensibility And Are Not

Refactor should reject these when proposed, and Code Inspection should flag them
when they appear in a diff:

- **Config explosion.** Twenty boolean options is not a seam; it is twenty
  behaviors the package still owns, plus a combinatorial test surface. If two
  options are never independently set, they are one decision.
- **A plugin system with no plugins.** A registry, lifecycle, and hook API built
  before a second consumer exists encodes guesses about the extension points and
  is usually wrong at exactly the points that matter. Ship the second consumer's
  wiring first; generalize from two real cases.
- **An interface with one implementation and no second host.** A port extracted
  speculatively is indirection with a cost and no benefit. Two implementations, or
  a named prospective host, or it waits.
- **Renaming and re-foldering.** Moving files to look cohesive changes no ledger
  row. See D12: the measure is files touched per extension, not folder shape.
- **Widening every type to `unknown` or adding index signatures everywhere.** This
  clears D8 by deleting the contract. The host can now pass anything, including
  things that break. Prefer generics with defaults.

`<AI_DEV_SHOP_ROOT>/skills/refactor-patterns/references/rule-of-500.md` warns
against removing extensibility abstractions that protect real variation. These
five are the inverse failure — abstractions that protect imagined variation — and
they cost the same maintenance with none of the return.

**The governing rule: a move needs a ledger row.** Every proposal from this file
cites the deviation it unblocks and the source of that deviation. A move with no
row behind it is speculative generality, and the correct disposition is to leave
the code alone.
