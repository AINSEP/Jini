# HANDOFF — REQ-1 `@jini-ai/vibecoding/html/node` (parse5 `HtmlRegionParser`)

- Date: 2026-08-04
- Author: TDD + Programmer agent (dispatched by team-lead), stopped on an owner-initiated stop request from Coordinator.
- Repo: `/Users/la/Programming/Jini`, branch `refactor/jini-admin-extraction` (shared tree — other agents' unrelated uncommitted changes are present; not touched by this work).
- Governing docs read in full before any code: `/Users/la/Programming/Tovu/ADS-memory/reports/architecture/ADR-056-pages-vibecoding.md`, `/Users/la/Programming/Tovu/ADS-memory/specs/047-pages-vibecoding/spec.md`, `/Users/la/Programming/Jini/packages/vibecoding/src/html/regions.ts`.

## 1. Where this stopped

**Not mid-task — REQ-1 is complete.** This is not an interrupted implementation; the stop request arrived after the deliverable was finished, tests were green, and a completion report had already been sent to team-lead. Nothing is half-written. Nothing is in a non-compiling state. No further implementation was started after the stop request — this handoff document is the only thing written since.

If a future session picks this up expecting unfinished work, that expectation is wrong: re-run the verification commands in §4/§5 below to confirm current state before assuming anything is broken or incomplete.

## 2. CIC-2 verdict — REACHABLE, confirmed empirically, via two distinct mechanisms

ADR-056 flagged its own premise here as inference, not observation ("What could not be verified" section). This was settled by running real parse5 8.0.1 against constructed fixtures before writing any implementation — not inferred from parse5's docs alone (though the docs corroborate: `ParserOptions.sourceCodeLocationInfo`'s own doc comment says `sourceCodeLocation` is `undefined` for parser-implicitly-created elements).

**Mechanism 1 — node present in the tree but incompletely located** (missing `sourceCodeLocation.endTag`):
- An unclosed tag at EOF: `<div data-agent-element="hero">unclosed content` → `startTag` present, `endTag` absent.
- Any tagged **void element** (`<img>`, `<br>`, ...): structurally can never have a closing tag, so `endTag` is always absent. This is deterministic, not a recovery accident.
- One copy of an adoption-agency-cloned node in misnested-formatting-tag cases, e.g. `<b><i data-agent-element="misnest">text</b>more</i>` — parse5's adoption agency algorithm clones the `<i>` node; one of the two resulting nodes with the SAME handle lacks a complete `endTag`.
- **A finding that goes beyond CIC-2's original framing, found while writing tests**: the same missing-`endTag` signal also fires for HTML5's *ordinary, spec-legal* optional-end-tag grammar (`<p>`, `<li>`, `<td>`, `<tr>`, `<option>`, ...), not only parser-recovery corruption. A tagged `<p data-agent-element="x">...` with no literal `</p>` is refused too, even though the DOM is not actually corrupted. Verified: `<ul><li data-agent-element="only">no closing li tag</ul>` produces zero `onParseError` entries yet still has no locatable `endTag`. Practical mitigation, also verified: `<section>`/`<div>`/`<article>` have no optional-end-tag grammar in HTML5 at all, so tagging those (with an explicit close) is immune. This is worth feeding back into Pages-generation prompt conventions (steer the model toward `<section>`/`<div>` wrappers for regions) — a Tovu-side concern, not something addressed in this Jini-side change.

**Mechanism 2 — node dropped from the tree entirely, no node to inspect at all:**
- A tagged `<td>` used outside a `<table>` is *silently ignored* by the HTML5 "in body" insertion-mode's table-tag handling rule (parse error, ignore the token, per spec). Confirmed empirically: **`<div><td data-agent-element="stray-td">no table here</td></div>` produces zero `onParseError` entries** — `checkWellFormed`'s error-stream alone cannot catch this. This is why the implementation adds a raw-source occurrence-count cross-check (regex count of `data-agent-element=` in the raw string vs. the count of regions the tree walk actually located) — the same false-positive-favoring plain-text-match tradeoff ADR-056 Decision 8's `withFormGuardrail` already accepts for a different guardrail.

**A load-bearing detail the ADR did not name, found first here**: fragment-parsing *context* changes whether the drop reproduces at all. Tovu's `body_html` is inner-slot-only content (ADR §8/REQ-11: "the AI never generates `<html>`/`<head>`/nav/footer"), so the correct API is `parse5.parseFragment`, not `parse5.parse`. But `parseFragment`'s *default* context (when none is given) is a synthetic `<template>` element — and under that context, **the stray-`<td>` drop does not reproduce at all**; the element parses normally, because `<template>` puts the parser in "in template" insertion mode, which has different (more permissive) handling. Using an explicit `<div>` fragment context (matching how a real host embeds this content — the same context `Element.innerHTML` uses) is what surfaces the dangerous case. **Using the default `template` context would have shipped a parser that passes its own tests while remaining vulnerable to the exact case CIC-2 exists to prevent.** This reasoning and the empirical evidence are recorded in the module doc of `parse5-region-parser.ts`.

Fixtures and raw command output for all of the above were captured directly against parse5's real output (via throwaway probe scripts, deleted after their findings were folded into the module doc and the test suite — nothing was inferred without running it).

## 3. What exists on disk

All new/changed files are under `packages/vibecoding/`. Nothing outside it was touched; nothing under `/Users/la/Programming/Tovu` was touched; no git commands were run (confirmed clean per standing rules).

- **`packages/vibecoding/package.json`** (modified): added `"./html/node": "node"` to `jini.entries`, and a matching `"./html/node"` entry to `exports` (types/import/default all pointing at `./dist/html/node/index.*`). Added `parse5` as a runtime `dependencies` entry (was previously `devDependencies`-only: `typescript`, `vitest`). `.`, `./core`, `./html` entries are **unchanged** and still map only to their existing dist paths — confirmed dependency-free (parse5 is scoped to this one new entry, not the package root's universal surface).
- **`parse5` installation**: confirmed actually installed, scoped correctly. `pnpm add parse5 --filter @jini-ai/vibecoding` was the only install command run (verified via `git diff packages/vibecoding/package.json pnpm-lock.yaml` immediately after running it — `parse5@8.0.1` added only under `packages/vibecoding`'s importer entry in `pnpm-lock.yaml`, nowhere else).
- **`packages/vibecoding/src/html/node/parse5-region-parser.ts`** (new): the implementation. Exports `createParse5RegionParser(): HtmlRegionParser`. Single shared `analyzeDocument(html)` pass feeds both `findRegions` (throws `Error` on any location problem — never silently omits a region) and `checkWellFormed` (returns `{ok:false,reason}` for the same location problems, plus surfaces genuine `onParseError` entries phrased for the model; passes documents parse5 silently repairs with zero error entries, per the port's own "allowed to pass" contract). Full reasoning, including the CIC-2 empirical findings above, is in this file's module doc comment — read that first if resuming.
- **`packages/vibecoding/src/html/node/index.ts`** (new): barrel, re-exports `createParse5RegionParser` and `isValidRegionHandle` (re-exported from `../regions.js` for caller convenience).
- **`packages/vibecoding/src/html/node/__tests__/parse5-region-parser.test.ts`** (new): 17 tests (see §4).

`core/` and `html/` (the two universal, dependency-free entries) are unmodified — confirmed via `git status` and via `npm --prefix packages/vibecoding run typecheck`/`build` succeeding, which would fail loudly if `regions.ts` or `core/*` had picked up a stray Node-only import.

## 4. Test state — real counts, real command output

Command: `npm --prefix packages/vibecoding run test` (scoped to this package only, per standing rules — no full-suite run anywhere).

```
✓ src/core/__tests__/history.test.ts (19 tests)
✓ src/html/__tests__/regions.test.ts (19 tests)
✓ src/core/__tests__/apply.test.ts (11 tests)
✓ src/html/node/__tests__/parse5-region-parser.test.ts (17 tests)

Test Files  4 passed (4)
     Tests  66 passed (66)
```

All 66 pass, zero failures, zero skips. 49 are pre-existing (untouched by this work); 17 are new, covering: correct inner offsets on well-formed input; a foster-parented-but-fully-located tagged `<div>` inside a `<table>` NOT over-flagged as a CIC-2 problem; duplicate handles surfaced not filtered; grammar-invalid handles surfaced not filtered; byte-preserving splice through the real (unmodified) `createHtmlRegionTarget` + this parser, end-to-end; `checkWellFormed` pass/fail semantics including the "genuinely allowed to pass silently-repaired markup" case; all CIC-2 fixture families from §2 (stray-`<td>`, unclosed tag, void element, adoption-agency clone, an element's own implied closure, plus the `<section>`/`<div>` mitigation case); and a non-misfire check for the raw-source cross-check on an ordinary single mention.

One RED→fix cycle worth recording for whoever resumes: the first draft of the "silently repaired, still passes" test used `<p>` implied closure on the *tagged* element itself, and it failed. That failure was correct, not a bug — see §2's "goes beyond CIC-2's original framing" note. The fixture was fixed (moved the implied closure to an untagged sibling), not the implementation.

## 5. Typecheck and guard state

- `npm --prefix packages/vibecoding run typecheck` → **clean, zero errors.** The strictness delta (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`) was real work, specifically: parse5's own `package.json` `exports` map publishes **only** its top-level `"."` entry — a deep import like `parse5/dist/tree-adapters/default.js` resolves fine under `moduleResolution: "Bundler"` at typecheck time but is **not a real subpath Node serves at runtime**. Caught this by checking `node_modules/.pnpm/parse5@8.0.1/node_modules/parse5/package.json` directly, then fixed it by using the re-exported `DefaultTreeAdapterTypes` namespace from parse5's main entry instead, and independently confirmed the fix with a real Node ESM resolution check (not just `tsc`) — see below. No outstanding typecheck errors were left unresolved.
- `npm --prefix packages/vibecoding run build` → clean. `dist/html/node/{index,parse5-region-parser}.{js,d.ts}` all present and confirmed via `ls`.
- **Real Node resolution check** (independent of `tsc`, run from inside `packages/vibecoding` using Node's self-referencing-package resolution): `node -e 'import("@jini-ai/vibecoding/html/node").then(...)'` → resolves; `Object.keys(mod)` is `['createParse5RegionParser', 'isValidRegionHandle']`; a live `findRegions("<div data-agent-element=\"hero\">hi</div>")` call returns `[{"handle":"hero","innerStart":31,"innerEnd":33}]`. This step is worth re-running after any further change to the package.json `exports` map or the parse5 import surface — it is the only check that would have caught the deep-import problem above; `tsc` alone would not have.
- `npx tsx scripts/guard.ts` (the actual CLI wrapper around `check-engine-boundaries.ts` — running `check-engine-boundaries.ts` directly produces no output since it only exports functions; use `guard.ts`) → **67 pre-existing violations, zero of them in `packages/vibecoding` or touching any file this work added or changed** (confirmed via `grep -i "vibecoding\|parse5-region"` against the guard's own output, and cross-checked that all 67 violations fall in files `git status` shows as already modified by other agents sharing this tree — `packages/{chat,mcp,renderers-react,sqlite,ui,http-kit,agent-runtime}`). No product-identity strings (R5), no forbidden deep-path imports of other `@jini-ai/*` packages (R2) in the new files.

## 6. Contradictions found against ADR-056 Decision 1

Two, both already folded into the implementation and its module doc, worth restating explicitly since the ADR author (Software Architect) did not run parse5 directly:

1. **The ADR's own "what could not be verified" framing undersells how CIC-2 actually manifests.** It names "implicit-insertion recovery" as the trigger and asks whether it's reachable at all. It is — but the dominant, most-common-to-hit-in-practice trigger turned out to be **HTML5's ordinary optional-end-tag grammar**, not primarily exotic parser-recovery corruption. This has a real product consequence: a Pages-generation model that tags a `<p>`/`<li>`/`<td>` region without an explicit closing tag will brick that entire page's editability (every `listParts`/`readPart`/`replacePart` call throws, not just the one region), not merely the one malformed edit. The mitigation is cheap (steer generation toward `<section>`/`<div>` region wrappers) but is a **Tovu-side prompt/convention decision the ADR does not currently make** — worth a follow-up note in whatever REQ-8 (prompt construction) work happens next.
2. **The fragment-context choice is load-bearing and unnamed in the ADR.** Decision 1 does not say whether the adapter should use `parse5.parse` (full document) or `parse5.parseFragment` (fragment), nor what context element a fragment parse should use. This matters concretely: under parse5's own *default* fragment context (`<template>`), the stray-`<td>`-outside-`<table>` CIC-2 case **does not reproduce** — meaning an adapter built without deliberately choosing a `<div>` context could pass all its own tests while remaining exposed to the exact silent-drop failure CIC-2 exists to prevent. This is the single highest-value correction to hand back to the ADR/architecture layer: **the fragment context choice should be named explicitly in the ADR, not left as an implementation detail**, because getting it wrong produces a parser that looks safe under casual testing and isn't.

No other contradiction found. parse5's actual API (`parseFragment`, `sourceCodeLocationInfo`, `onParseError`, `defaultTreeAdapter`, the `NS`/`html` namespace) matches the ADR's assumptions about `sourceCodeLocationInfo: true` reporting `startOffset`/`endOffset` per node, and `checkWellFormed`'s "allowed to pass silently-repaired documents" framing holds up exactly as specced.

## 7. What remains, in order, with recommendation

REQ-1 itself (this dispatch's full scope) is **done** — nothing remains within it. What remains is downstream, per spec-047's own sequencing (§12):

1. **Feed §6's two findings back into ADR-056 before further Tovu-side work depends on them** — specifically, get the fragment-context choice (`<div>`, not `parse5`'s default) and the optional-end-tag consequence written into the ADR (or a superseding note) rather than left only in this handoff and the Jini-side module doc, since the next people to touch this (REQ-8 prompt construction, Decision 8's `withFormGuardrail`) need to know about it without re-deriving it.
2. **Tovu-side REQ-2/3/4** (schema + `PagesHtmlDocumentStore`) can now proceed — REQ-1 was the blocking cross-repo prerequisite named in spec-047 §3/§12 step 1, and it no longer blocks anything.
3. **REQ-5 tool wiring** (`buildPagesVibecodingRegistrations`, per ADR Decision 4) — this is the first place `createParse5RegionParser()` actually gets imported and used as the "module-level singleton" the ADR describes; worth a smoke check that the singleton usage pattern works as expected once that lands, since it was only exercised via fresh-per-call `createParse5RegionParser()` invocations in this package's own tests, not via a long-lived singleton import.
4. **REQ-8 (generation prompt)**: fold in §6 finding #1 above — steer the model toward `<section>`/`<div>` region wrappers with explicit closing tags.

Recommendation for whoever picks this up next: read `packages/vibecoding/src/html/node/parse5-region-parser.ts`'s module doc first (it carries the full CIC-2 reasoning and evidence inline, not just this handoff), then re-run §5's four verification commands fresh before trusting this handoff's "clean" claims — they are accurate as of this write, but this is a shared tree with other agents active in it.
