# REF-001 Steps B–D — decision-ready proposal

**Agent:** Refactor. **Mode:** propose-only — nothing under `packages/` or `Tovu/` was
edited. One file written: this report.
**Repo:** `/Users/la/Programming/Jini`, branch `refactor/jini-admin-extraction`, HEAD `74d7569d`
(clean except for BYOK's in-flight edit, see "Ordering" below — verified with `git status`,
not assumed).
**Baselines reproduced, not trusted from the dispatch brief:** `pnpm guard` → **71** violations
(confirmed by running `npx tsx ./scripts/guard.ts`, not copied from the brief). Step A commit
`4db1e6b2` confirmed on `git log`.

Read each of the four sections below as **independently approvable**. Section 0 is a hard gate;
everything after it can be approved/rejected on its own.

---

## 0. Packaging diagnosis (read this first — it gates Steps B and C)

**The gate is real, and it is not hypothetical.** `packages/chat/package.json`'s `exports` map
declares exactly three subpaths:

```json
"exports": {
  ".":      { "types": "./dist/core/index.d.ts",  "import": "./dist/core/index.js",  "default": "./dist/core/index.js" },
  "./core": { "types": "./dist/core/index.d.ts",  "import": "./dist/core/index.js",  "default": "./dist/core/index.js" },
  "./react":{ "types": "./dist/react/index.d.ts", "import": "./dist/react/index.js", "default": "./dist/react/index.js" }
}
```

The package's `build` script (`package.json:35`) runs `tsc ... && mkdir -p dist/react/styles &&
cp src/react/styles/reference.css dist/react/styles/` — it produces a fourth artifact,
`dist/react/styles/reference.css`, that is **not listed in `exports`**. `npm pack --dry-run`
confirms the file ships in the tarball (`dist/react/styles/reference.css`, 9.3kB, in the file
list). I reproduced the actual consumer-side failure, not just the missing map entry:

```
$ node -e "require.resolve('@jini-ai/chat/react/styles/reference.css', {paths:[process.cwd()]})"
FAILS: ERR_PACKAGE_PATH_NOT_EXPORTED  Package subpath './react/styles/reference.css' is not
defined by "exports" in .../packages/chat/package.json
```

This fails identically whether resolved through the workspace symlink or a real install — Node's
own `exports` enforcement doesn't care how the package got onto disk, so this specific instance
isn't the "pnpm symlink is more lenient than a tarball" trap the brief warned about. It's simpler
and worse: **the file is unreachable through the published API from anywhere, including inside
this workspace.**

**Currently latent, not yet load-bearing** — I checked whether anything imports it by path and
nothing does. Tovu's `apps/admin/src/styles/assistant.css` *mentions* `@jini-ai/chat-react`'s
reference stylesheet in a comment (`assistant.css:386`, and note it uses the **pre-consolidation
package name** `@jini-ai/chat-react`, not `@jini-ai/chat` — a stale reference worth a separate
one-line doc fix, not part of this proposal) but Tovu hand-maintains its own copy rather than
importing the packaged one. So this bug has shipped silently since whenever the CSS-copy step was
added, and nothing has hit it yet.

**Root cause:** the build script and the `exports` map were edited independently; nobody re-derived
one from the other. This is exactly the general risk the locked plan's C4 named
(`ADS-memory/reports/jini-port/extraction-plan.md:221-222`): *"publish compiled ESM + `.d.ts` +
compiled/extractable CSS only... The packed-tarball boot is the CI neutrality gate."* This is a
concrete, reproducible instance of that named risk, not a new one.

**Smallest fix (not applied — Programmer/Refactor-on-dispatch territory):** add
`"./react/styles/reference.css": "./dist/react/styles/reference.css"` to `exports`. One line.
Then re-run `npm pack --dry-run` and the `require.resolve` probe above as the regression check —
both are two-minute checks and should be a permanent pre-Step-B gate, per the locked plan's C4 and
today's `ADS-memory/reports/findings/2026-08-05-refactor-audit-verification.md:46-50`, which
independently arrived at "packed-tarball verification... should be treated as a hard gate" for
this exact package.

**Why this blocks Steps B and C specifically:** Step B removes exports (new omissions in the same
map that just proved it can silently drift from what's built) and Step C adds a new subpath (the
same map, under more load). Landing either without first closing this gap means the next drift
gets discovered by a real consumer instead of by this check. **Recommend: fix and re-verify this
one line before Step B's PR, as its own tiny, isolated, zero-risk commit** — not bundled with the
narrowing work, so a broken build script fix never gets attributed to (or blocked by) an export
surface debate.

---

## 1. Escalation: Steps B–D reconcile a named architecture prohibition — they don't lift it

**This needs an explicit answer before Step D is implemented; it isn't something I can resolve
by writing better code.**

The locked extraction plan's C3 (`extraction-plan.md:218-219`) says, verbatim: *"Export small
controllers (session/composer/transcript/run-status/confirmation/attachment), **NOT** a
product-like `ChatPane`."* The original REF-001 finding
(`ADS-memory/reports/refactor/REFACTOR-aug3-4-commit-audit-2026-08-05.md:9-16`) is ranked **High**
specifically because of this, routes `ARCHITECTURE_REVIEW_REQUIRED`, and its own recommended fix
was: *"Move the opinionated workspace pane to `examples/reference-web`... do not retain it as the
generic engine export."* Today's independent audit-verification
(`ADS-memory/reports/findings/2026-08-05-refactor-audit-verification.md:15`) confirms this finding
stands and calls it "the strongest of the five."

Step A's commit message and this dispatch's own "design context" section take a **different**
position: keep `ChatPane` exported, and instead of removing it, make it provably non-privileged —
Step D's "`ChatPane` may only use public exports" invariant. That is a coherent alternative
resolution (it satisfies the *reason* C3 exists — a non-React or minimal-controller host isn't
locked out, because everything `ChatPane` does is independently reachable) but it is **not the
same decision** as C3/REF-001's literal text, which is "don't export it." Nothing in the materials
I was given records the user (or Architect) explicitly overriding C3 in favor of the
worked-example framing — Step A's commit message asserts it, but a commit message is the author
narrating their own decision, not a recorded architecture sign-off.

**I am not re-opening the "no multiple `ChatPane` variants" decision** — that's a different
question (how many compositions to ship) from this one (whether the one composition belongs in
the generic package's public surface at all), and the brief is explicit that the variants question
is closed.

**What I'm asking for:** before Step D's implementation is dispatched, get an explicit
Architect/user confirmation that "keep `ChatPane` exported + prove it's not privileged" is the
accepted final resolution of REF-001's `ARCHITECTURE_REVIEW_REQUIRED` finding, superseding C3's
literal text. If that confirmation exists already outside what I was given, this section is a
no-op — restate it in the Step D dispatch so the next agent doesn't have to re-derive this chain
of documents. If it doesn't exist yet, that's a five-minute decision, not a redesign, and it
should happen before Step D's guard is built around an assumption nobody signed off on.

---

## 2. Consumer map (Step B evidence)

**Method:** independently re-derived, not copied from any prior report. `pnpm-workspace` + the two
Codebase Memory MCP indexes already fresh at this HEAD (`Users-la-Programming-Jini-packages` at
`74d7569d`, matching current HEAD exactly; `Users-la-Programming-Tovu-src` for the `src/` tree)
confirmed the shape, then every claim below was checked against raw source with `rg`/Python, not
trusted from the graph alone, per the graph skill's own "output is a hypothesis" rule.

### 2.1 Who imports `@jini-ai/chat/react` at all

| Consumer class | Result |
|---|---|
| Other `@jini-ai/*` packages (`packages/**`, excluding `chat` itself) | **Zero.** No package in the Jini monorepo imports `@jini-ai/chat/react`. |
| Jini `examples/` | Only `examples/reference-web` (`minimal-host`, `nlweb-demo`, `reference-desktop`, `sample-projects` — zero hits each, checked individually). |
| Tovu | `apps/admin` (5 files) and `apps/site-chat` (2 files). Nothing in Tovu's bare `src/` imports it. |

7 consumer files total, outside the package itself. This is a small, enumerable set — I read
every import statement in all 7 rather than sampling.

### 2.2 What those 7 files actually import (by name, verified by reading the import statements, not regex-only)

- **`examples/reference-web`** (14 symbols): `A2uiSurfaceCard`, `ChatFab`, `ChatPane`,
  `ChatPaneAgent` (type), `ChatPaneRuntimeAccess` (type), `ChatTransport` (type), `RunHandlers`
  (type), `StartRunInput` (type), `createDaemonAttachmentUploader`, `createDomPageDriver`,
  `createFrontendSessionBridge`, `registerExtEventRenderer`, `registerToolRenderer`,
  `FrontendSessionBridge` (type).
- **Tovu `apps/admin` + `apps/site-chat`** (15 symbols): `A2uiSurfaceCard`, `ChatFab`, `ChatPane`,
  `ChatTransport`, `ConversationList`, `JiniChatProvider`, `RunHandlers`, `StartRunInput`,
  `createDaemonAttachmentUploader`, `createFrontendSessionBridge`, `createMcpUiToolCaller`,
  `registerExtEventRenderer`, `registerMcpUiSurfaceRenderer`, `ChatPaneAgent` (type),
  `FrontendSessionBridge` (type).

**Union: 17 distinct symbols with a directly-provable external consumer.** These are unconditional
**KEEP**.

### 2.3 Why "17 of 193" is the wrong headline number — and the corrected method

A raw name-sweep of all 193 exported symbols against Jini `examples/`, every other Jini package,
and Tovu's `apps/`+`src/` (full-text scan, not import-statement-only, so it's a strict superset of
2.2) found **146 of 193 symbols with zero raw text hits anywhere.** Treating that as "146 REMOVE
candidates" would be wrong for three separate, independently-verified reasons, and I want to be
explicit about which symbols each reason covers rather than asserting a number:

**(a) Explicitly locked by the design context this dispatch already settled.** The brief names
these as the composability seam the whole strategy depends on, regardless of current adoption:
`useChatPane`, `useChatPaneAgentControl`, `useChatPaneWorkingDirectory`,
`useChatPaneRuntimeInventory`, `defaultChatPaneSelection`, `orderChatPaneAgents`,
`resolveChatPaneSelection`, `ModelAgentPickerSlot`, `ComposerSlots`, `AttachmentTraySlot`,
`FilePreviewSlot`, `AnnotationAdapter`, `AnalyticsAdapter`, `I18nAdapter`, `MentionSource` (+ their
associated `Options`/`Result` types). All zero-hit under 2.3's sweep. **KEEP — cite the design
context, not usage evidence.**

**(b) Required by Step D's own invariant.** I read `ChatPane.tsx`'s and its transitive imports'
source (not inferred) to find what `ChatPane` depends on inside its own package:
`ChatPane.tsx:4-6` imports `Composer` and `MessageList` by relative path;
`components/MessageList.tsx:16` imports `MessageRow`; `components/MessageRow.tsx:36-44` imports
`ExtEventErrorBoundary`, `Markdown`, `ToolCard`, `QuestionForm`, plus the hooks `useToolTimeline`
and `useExtEventGroups` and the registry function `getExtEventRenderer`;
`components/Composer.tsx:17` imports `AttachmentTray`. Separately, `JiniChatProvider.tsx:23-24` —
itself directly consumed by Tovu (2.2) — types its context value with `RendererRegistry` (from
`artifact-types.ts`) and the full slot-type list.

If Step D's guard is "`ChatPane` may only reach things a consumer could also reach," then every
symbol on this dependency chain **must stay public**, full stop, independent of whether any host
happens to import it directly today: `MessageList`, `MessageRow`, `Composer`, `AttachmentTray`,
`ExtEventErrorBoundary`, `Markdown`, `ToolCard`, `QuestionForm`, `getExtEventRenderer`,
`useToolTimeline`, `useExtEventGroups`, `RendererRegistry`, plus each one's `Props`/`Result` type.
Removing any of these would either break `ChatPane` or force it into a private import — which is
precisely the bug Step D exists to catch, just discovered by hand instead of by the guard that
doesn't exist yet.

**(c) Intentional slot-fill companions with no adopting host yet, not orphans.** `ConversationList`
is documented in its own barrel comment (`index.ts:243-248`) as designed to "drop into `ChatPane`'s
`leadingAccessory` slot; it needs no changes to `ChatPane` itself" — i.e., its whole point is to be
usable *without* `ChatPane` importing it. `TodoCard`, `QuestionsPanel`, `NextStepActions` read the
same way (storage/callback-driven, not wired into `ChatPane`'s own render tree per (b)'s trace).
These aren't proven necessary the way (a)/(b) are, but "zero adopters yet" is the expected state
for a composability seam nobody has needed yet, not evidence of dead code. I'm flagging these as
**KEEP for now, revisit if still zero-adoption at the next audit** rather than asserting either
verdict — recommend Architect/Coordinator judgment call, not mine to make unilaterally.

### 2.4 The one real, fully-evidenced Step B candidate: the `model-picker` re-export block

`index.ts:82-112` re-exports the *entire* `features/model-picker` slice — 13 values + 14 types, 27
symbols — through a comment explaining why: *"an independent slice... re-exported here for a
consumer that wants everything from one barrel"* (`index.ts:79-81`). I checked this claim two ways:

1. **Zero external consumer.** All 27 names: zero hits in `examples/`, zero in Tovu `apps/`+`src/`.
2. **Zero internal consumer either.** `features/chat-pane/**` (including `AgentRuntimePicker`, the
   component that plausibly would compose a model picker) has zero references to `ModelPicker`,
   `useModelPicker`, or any other model-picker export — confirmed by reading
   `AgentRuntimePicker.tsx`'s full import list, not just grepping the name.

A handful of the 27 names showed *nonzero* raw hits elsewhere in the monorepo
(`AgentDefinition`: 5, `AgentDiagnostic`: 24, `CredentialStatus`: 5, `ModelOption`: 12,
`ModelProvider`: 5) — I did not take these at face value. Tracing them: they resolve to
**`@jini-ai/protocol`'s own same-named types**, re-exported independently by
`packages/agent-runtime/src/model-registry.ts:40,81`. That's the exact "raw name match ≠ real
consumer" trap the alias-trap lesson generalizes to, and it's why I traced every apparent hit
rather than reporting the sweep numbers directly.

**Proposal:** the model-picker re-export block is a genuine, fully-evidenced **REMOVE** candidate —
zero consumers by any account, and its own barrel comment concedes it's there for hypothetical
convenience, not a proven need. **Route recommendation: DEPRECATE first (re-export with a
`@deprecated` JSDoc tag pointing at `@jini-ai/chat/react/model-picker` or wherever `features/
model-picker` should live if it needs its own subpath — TBD by whoever owns Step C's subpath
design), REMOVE in a follow-up once one deprecation cycle has passed with zero regressions.**
This keeps Step B itself a strict export-surface *narrowing* with a paper trail, consistent with
one-refactor-type-at-a-time.

---

## 3. The alias trap — verification method for Steps B/C (not optional)

**This happened once already and would happen again silently if Step B/C verification is done by
name-diff alone.** `checker.getExportsOfModule` returns `Alias` symbols for every re-export; an
Alias carries `SymbolFlags.Alias`, not `SymbolFlags.Value`. Classify by raw flags without first
calling `checker.getAliasedSymbol()` and every re-exported *value* gets misclassified as type-only
— which typechecks clean and passes a name-only diff while silently emitting real functions/classes
under `export type`, erasing them at the JS output. Step A's own commit message
(`4db1e6b2`) documents that this is exactly what happened during that step's first attempt, caught
only by the package's test suite, not by typechecking or a name diff.

**I did not take Step A's "74 values / 119 types" claim on faith** — the user's standing
instruction is to verify evidence-shaped claims in commit messages, not repeat them. I wrote a
small read-only script (TS compiler API, resolves every export's alias before classifying,
`/Users/la/.claude/harness-tmp/.../scratchpad/verify-export-kinds.cjs` — scratchpad only, not
committed) and ran it against the current `index.ts`:

```
Total exported symbols: 193
Value: 74
Type: 121   (not 119)
Both value+type: 2
```

**This is not a contradiction of Step A — it's a counting-convention gap worth naming precisely so
it doesn't look like a regression to the next person who runs a diff script.** The 2-symbol delta
is exactly `ExtEventErrorBoundary` and `RendererRegistry` — both classes, and a TS class is
legitimately *both* a value (the constructor) and a type (the instance shape) at the symbol-flag
level. My script counts a class in both buckets (74 value + 121 type, with 2 counted twice);
Step A's tally apparently counted each symbol once, by which `export` clause it came from (`export
{ X }` → value bucket) rather than by resolved flags, landing it as a value only (74 + 119 = 193,
consistent). Both totals independently reconcile to 193 — neither is wrong, they're different valid
conventions for dual-kind symbols, but if Step B's verification script uses one convention and
someone diffs against the other convention's number, it will look like a 2-symbol loss that isn't
one.

**Concrete method for Step B/C verification (recommend building this once, reusably, not
re-deriving it live for every step):**
1. Load `index.ts` through the real `tsconfig.json`, call `checker.getExportsOfModule` on its
   module symbol.
2. For every result with `SymbolFlags.Alias` set, resolve via `checker.getAliasedSymbol()` **before**
   reading any other flag.
3. Classify by the resolved symbol's flags: `Value` and `Type|Interface|TypeAlias|Enum` are not
   mutually exclusive — report both counts and the both-count explicitly, per symbol, so a class
   showing up in both buckets is legible instead of looking like double-counting error.
4. Diff the **per-symbol table** (name → isValue, isType), not just the aggregate counts, against
   the pre-change baseline. The aggregate can accidentally net out even when individual symbols
   flip kind (one symbol wrongly demoted to type-only, a different one promoted, same totals).
5. This script does not exist as a committed tool yet — Step A's verification was ad hoc and not
   saved. Recommend committing it (e.g. `scripts/verify-export-kinds.ts`) as part of Step B's PR so
   Steps B, C, and any future barrel edit reuse it instead of re-deriving the alias-resolution logic
   under time pressure again.

---

## 4. The 65 deep-path violations — independent of Steps B/C, and Step A did not touch them

**Corrects a claim in Step A's own commit message.** That message calls the 65 `R2-deep-path`
violations "the likeliest root" of the grab-bag barrel and implies narrowing the barrel is the fix.
I traced every one of the 71 current `pnpm guard` violations to its rule and file
(`scripts/check-engine-boundaries.ts:373-444` is the actual rule implementation — read, not
assumed) and the claim doesn't hold:

| Rule | Count | What it actually is |
|---|---|---|
| `R2-deep-path`, `@jini-ai/chat/core` | 61 | See breakdown below |
| `R2-deep-path`, `@jini-ai/ui/mcp-ui` | 3 | A **different package's** subpath (`@jini-ai/ui`), unrelated to `chat` |
| `R2-deep-path`, relative import | 1 | `packages/ui` reaching into `agent-runtime`'s `src/` — unrelated to `chat` entirely |
| `R5-neutrality` ("Tovu" in comments) | 6 | Unrelated rule, unrelated fix (debranding sweep) |

**65 total `R2-deep-path`, but only 61 involve `@jini-ai/chat/core` at all, and none of the 65
involve `@jini-ai/chat/react`'s export list — the thing Step B changes.** The rule
(`check-engine-boundaries.ts:399-441`) flags any `@jini-ai/<pkg>/<subpath>` import where `<subpath>`
isn't one of three hard-coded exceptions (`@jini-ai/core/internal`, `@jini-ai/agentic/dom`,
`@jini-ai/agentic/a2ui`) — `@jini-ai/chat/core` is not exempted, so **every** import of that
specifier trips it, regardless of what `@jini-ai/chat/react`'s barrel exports. Breaking the 61
down by location:

- **41 files are *inside* `packages/chat/src/react/` itself** — e.g. `index.ts:28-36`,
  `hooks/useComposer.ts`, `hooks/context.ts`, `message-blocks.ts`. These are the `react` half of
  the package importing its own sibling `core` half **by package-qualified specifier** instead of
  a relative import (`'../core/...'`). This is a self-import: Node resolves it correctly today
  (scoped packages with `exports` support self-reference), but it also means these files'
  *source* type-checks/runs against `core`'s **built `dist/` output**, not its `src/` — a real,
  separate risk (stale-dist drift between editing `src/core` and re-running `src/react`'s tests)
  that's independent of the guard violation itself and worth its own ticket.
- **4 files are genuinely external** to `packages/chat`: `packages/http-kit/src/__tests__/
  attachments.test.ts`, `packages/renderers-react/src/registry.ts`, `packages/renderers-react/src/
  types.ts`, `packages/sqlite/src/db/chat-history/store.ts`. These import the sibling `/core`
  subpath directly instead of the bare `@jini-ai/chat` specifier — which resolves to the exact
  same file (`"." ` and `"./core"` are identical entries in the `exports` map, confirmed above).

**Verdict on the brief's question:** Step A did not make any of these fixable (I checked: the
sample file `hooks/useComposer.ts` had the same `@jini-ai/chat/core` import before Step A's parent
commit — Step A only touched `export` statements, never `import` statements). **Step B would fix
zero of the 65**, because narrowing `react`'s export *list* cannot change what `core`'s files (or
other packages) import — that's a different axis entirely. **This is a separate, already-actionable,
mechanical Type-A fix, safely decoupled from Steps B–D:**
- The 4 external files: change `from '@jini-ai/chat/core'` → `from '@jini-ai/chat'` (identical
  resolution target, confirmed above — zero behavior change).
- The 41 internal files: change `from '@jini-ai/chat/core'` → the equivalent relative path into
  `../core/...` (same-package self-import replaced with a normal relative import — also zero
  behavior change, and removes the source→dist coupling flagged above as a bonus).

**Recommend filing this as its own REF-00X, sequenced independently of B–D** — it clears 61 of the
71 current guard violations by itself, needs no architecture decision, and doing it separately
means Step B's diff stays legible as "what changed in the barrel" instead of being buried under 45
unrelated import-specifier edits.

---

## 5. Step-by-step proposals

### Step B — narrow the surface

```
ID:           REF-001-B
Type:         D — structural mismatch (public surface includes unproven-necessary exports)
Priority:     Medium
Affected:     packages/chat/src/react/index.ts:82-112 (model-picker block)
```
**Finding:** the `features/model-picker` re-export block (27 symbols) has zero consumers anywhere
in Jini or Tovu, by any account, including inside `ChatPane`'s own implementation (§2.4).
**Proposed fix:** deprecate the block (JSDoc `@deprecated`), remove after one cycle. No other
symbol in the 193 has evidence strong enough to propose removal — §2.3 explains why the "146
zero-hit" number overstates what's actually removable; §2.4 is the one group where all three of
those exemptions (locked design context, `ChatPane`'s own dependency graph, plausible unshipped
slot-fill) don't apply.
**Risk:** Low. Deprecation is additive (JSDoc only); actual removal is a later, separately-gated
step.
**Tests required before refactor:** `chat` suite green at baseline (67 files / 958 tests per the
dispatch's stated baseline — re-confirm at execution time, not assumed from this report).
**Blast radius:** 1 file for the deprecation pass. Zero consumers means zero downstream breakage
risk for the eventual removal, but Section 0's packaging gate must be re-verified after **any**
export-map-adjacent change, and Section 3's per-symbol value/type diff must run before/after.
**Route recommendation:** Programmer to implement the JSDoc pass; Refactor to re-run the Section 3
verification script; do not implement the follow-up removal in the same PR.

### Step C — move `ChatPane` to its own subpath

```
ID:           REF-001-C
Type:         D — structural mismatch (packaging: subpath split)
Priority:     Medium — blocked on Section 1's confirmation
```
**Do not implement until Section 1 is resolved.** Moving `ChatPane` to a distinct subpath (e.g.
`@jini-ai/chat/react/chat-pane`, exact name TBD by whoever resolves Section 1) while keeping the
old path as a deprecated alias is a reasonable **mechanism** either way — it makes "neutral engine
vs. opinionated preset" a real package-boundary fact instead of a comment, and it's what lets a
minimal-controller host tree-shake `ChatPane` out entirely, which is the actual thing C3 cares
about. But whether `ChatPane` is *also kept* reachable from the bare `react` root (as this dispatch
implies) or *only* reachable from the new subpath (closer to what REF-001's original finding
recommended) is exactly Section 1's open question, and changes what "deprecated alias" even means
here.
**Packaging note:** any new `exports` subpath must be added and packed-tarball-verified in the same
commit — Section 0 is the concrete proof this package's `exports` map can drift from what's built
without anyone noticing until a real consumer hits it. Use the `npm pack --dry-run` +
`require.resolve` probe from Section 0 as the literal regression check for the new subpath, not
just for the CSS fix.
**Tests required:** full `chat` suite, plus a packed-tarball boot smoke test (does not currently
exist for this package — recommend building it as part of this step, since it's the same tooling
Section 0's fix needs verified anyway).
**Blast radius:** `index.ts`'s `ChatPane`-related export block (`index.ts:113-158`), `package.json`
`exports`, both Tovu apps' and `examples/reference-web`'s `ChatPane` import (all currently import
from the bare `react` root — 3 files total, per §2.2, so switching their import path if the old
route is only a temporary alias is a small, enumerable change).
**Route recommendation:** Architect confirms Section 1 first. Then Programmer implements; Refactor
re-verifies Sections 0 and 3.

### Step D — "`ChatPane` may only use public exports" guard

```
ID:           REF-001-D
Type:         D — structural mismatch (missing enforcement for an existing invariant)
Priority:     Medium — sequenced after B and C land
```
**Finding:** the invariant is currently true by inspection (§2.3(b) traced `ChatPane`'s full
internal dependency chain and every symbol on it is already exported) but nothing enforces it going
forward — the next person who has `ChatPane` reach for a not-yet-public helper won't get caught
until someone notices by hand again.
**Proposed fix:** a script (same shape as `scripts/check-engine-boundaries.ts`) that walks every
relative import inside `features/chat-pane/**`, resolves it to the containing module's exported
symbol, and checks that symbol appears in `index.ts`'s (or, post-Step-C, the new subpath's) export
list. Flag anything `ChatPane` reaches that a consumer couldn't reach the same way.
**Open edge case worth deciding explicitly, not silently:** `message-blocks.ts`'s
`interleaveMessageBlocks` is used by `MessageRow` (`MessageRow.tsx:38`) but is **not** re-exported
from `index.ts` anywhere today. Under a strict reading of the invariant this is already a violation
and should either be exported or the guard should explicitly carve out "pure internal formatting
helpers with no independent swap value" as a named exception — I'd rather flag this now than have
Step D's first real run immediately need an undocumented exception.
**Risk:** Low to the guard itself (it's additive tooling); the risk is entirely in Section 1's open
question, since the guard's whole premise is "keep `ChatPane` exported, prove it's not privileged."
**Tests required:** the guard needs its own test fixture (a deliberately-non-exported helper that
`ChatPane` reaches for, to prove the check catches it) before it's trusted as a gate.
**Blast radius:** one new script + a `pnpm guard`-equivalent CI wire-up. Zero production code
changes unless the `interleaveMessageBlocks` edge case above resolves toward "must be exported."
**Route recommendation:** Refactor or Programmer implements after Architect resolves Section 1;
this step has the least urgency of the three since its invariant already holds today by
inspection — it only starts protecting against regression once built.

---

## 6. Ordering — what must land first

1. **Section 0's one-line `exports` fix**, alone, verified with `npm pack --dry-run` +
   `require.resolve`. Zero dependency on anything else in this report.
2. **Section 1's Architect/user confirmation.** Blocks Step C's design (subpath-only vs.
   subpath-plus-alias) and Step D's entire premise.
3. **Wait for BYOK's in-flight edit to land.** `git status` right now shows
   `packages/chat/src/react/features/chat-pane/**` and `packages/chat/src/react/features/
   model-picker/**` mid-restructure (untracked `components/`, `hooks/`, `styles.ts` at the feature
   root, replacing the old `react/components/`, `react/hooks/` nesting — confirmed by `git status`,
   not assumed from the dispatch brief alone). Step B's model-picker deprecation and Step C's
   `ChatPane` subpath move both touch exactly the directories BYOK owns right now. Doing either
   before that lands means re-doing it against a moved target.
4. **Section 4's import-specifier fix** (61 of 71 guard violations) has no dependency on 1–3 and
   can run in parallel with any of them, or first — it's the least contested, most mechanical item
   in this whole report.
5. **Step B** (after 1–3).
6. **Step C** (after 1–3, and specifically after Step B if Step B's model-picker deprecation is
   meant to also get its own subpath — worth deciding at Step C design time, not now).
7. **Step D** (after Step C, since its guard's shape depends on where `ChatPane` ends up living).

## 7. Suggested Coordinator classification

- Section 1 → `ARCHITECTURE_REVIEW_REQUIRED` (re-affirms, does not newly discover, the existing
  REF-001 classification — routes to Architect/user, not a fresh finding).
- Section 0 (packaging fix) → Programmer, trivial, no architecture sign-off needed.
- Section 4 (import-specifier fix) → Programmer, mechanical, no architecture sign-off needed,
  can be dispatched immediately and independently of everything else in this report.
- Steps B/C/D → Refactor-proposed here; implementation dispatch to Programmer once Section 1
  resolves and BYOK's edit lands, per Section 6.
