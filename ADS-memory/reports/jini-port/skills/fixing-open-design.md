---
name: fixing-open-design
description: Rigorous, reproducible template for refactoring an Open Design (nexu-io/open-design) backend subsystem into the machine-enforced capability-barrel architecture. Uses apps/daemon/src/design-systems as the canonical reference implementation. Splits a flat/god-file module into a core/ foundation kernel plus concern subdirectories with barrels, breaks dependency cycles, registers the check-barrel-imports guard, JSDoc-documents every exported function and @module-docblocks every file, validates, and opens a PR with Why / What users will see / What this does. Trigger words fixing-open-design, refactor subsystem into capability barrels, apply the design-systems pattern, barrel refactor, capability barrel this module.
triggers:
  - fixing-open-design
  - refactor subsystem into capability barrels
  - apply the design-systems pattern
  - barrel refactor
  - capability barrel this module
audience: contributor
---

> **This is a Jini-adapted copy, not the byte-identical vendored original.**
> The original lives at
> `foundry/integrations/open-design/reference/dev-skills-original/fixing-open-design/SKILL.md`
> and must stay byte-identical to upstream OD (verification scripts diff
> against it) — never edit that copy. This file is the one to read instead
> for any Jini backend/daemon capability-barrel work (e.g. the still-unbuilt
> `AgentExecutor`/`ToolExecutor`/`createDaemon` pieces of `@jini/daemon`, or
> the `daemon.ts` client-side port work). Jini-specific changes from the
> original:
> 1. (2026-07-17) **the original has no coverage-discipline section at
>    all.** Added "Phase 6.5 — Coverage-driven refactor loop" below, ported
>    from the sibling `fixing-open-design-web` skill's Phase 9.5 (which
>    already had this) and adapted to backend vocabulary, with the same
>    ≥99%/100%-goal bar and the same absolute ban on coverage-suppression
>    comments.
> 2. (2026-07-18) Added "Phase 6.6 — Async/network test-category gate"
>    below: coverage percentage alone doesn't catch this bug class. OD PR
>    #5228's `MemorySection.tsx` decomposition attempt found the original had
>    passing, 100%-happy-path tests that hid real, pre-existing async/state
>    bugs (malformed-response trust, a concurrency race, no error handling,
>    stale state on retry) — none of them caught by coverage numbers alone.
> Everything else below is unchanged from the original.

# fixing-open-design — capability-barrel refactor template

Refactor a backend subsystem of `nexu-io/open-design` into the **machine-enforced capability-barrel architecture**, using `apps/daemon/src/design-systems/` as the proven reference implementation, then open a PR.

> **Agent-agnostic.** This is a plain `SKILL.md` — Claude Code, Codex, Gemini CLI, Cursor, OpenCode, or any agent can follow it. It names *capabilities* ("track progress as a task list", "ask the user", "run this command"), never a specific tool API. Map each capability to whatever your harness provides. Nothing here requires Claude-specific tooling.

**The reference is the spec.** Everything this skill asks you to produce already exists, done correctly, in `apps/daemon/src/design-systems/`. When any instruction here is ambiguous, open that module and copy its shape exactly — its `README.md`, its `core/index.ts` barrel, its `@module` docblocks, its `scripts/check-barrel-imports.ts` registration. Do not invent a variant.

> Scope: this template is for **backend/daemon TypeScript modules** (a flat directory of many files, or a multi-thousand-line god-file). Front-end (`apps/web`) refactor guidance lives in the sibling `fixing-open-design-web` skill — do not stretch this one to cover it.

`$SKILL_DIR` below = the directory containing the vendored `SKILL.md` at `foundry/integrations/open-design/reference/dev-skills-original/fixing-open-design/`. Read the four reference files there before you start — they carry the depth this file only summarizes:

- `references/architecture.md` — **the WHY.** Foundation kernel, acyclic edges, barrels, cycle-breaking, why it's machine-enforced. Read this first; the mechanics only make sense once the reasoning does.
- `references/barrel-and-guard.md` — the 7 enforced rules, the `CapabilityBarrelDomain` registry, how to register a new domain.
- `references/jsdoc-and-docs.md` — `@module` docblocks, per-function JSDoc, `@internal`, barrel descriptions, and the module `README.md` requirement.
- `references/merge-and-pr.md` — validation commands, the isolated-worktree merge technique, the PR body template, and cross-repo push.

---

## Guardrails (read before touching code)

1. **Public API stays export-surface-stable.** The whole point is a structural move that external importers never notice. The set of names exported from the module's root barrel must be identical before and after (runtime behavior unchanged too). Prove it (Phase 6). ("Byte-identical" applies only to *moved function bodies* — the move discipline — not to the barrel text.)
2. **No behavior changes in the same PR.** This is a strangler-fig *move*. If you spot a bug or a tempting cleanup, note it for a follow-up PR — do not fold it in. A refactor PR whose diff contains logic changes is un-reviewable.
3. **One subsystem per PR.** The design-systems PR (#5088) refactored exactly one module. Keep that bound.
4. **Every file gets a `@module` docblock; every exported function gets JSDoc.** This is a hard acceptance bar, not a nicety — see `references/jsdoc-and-docs.md`.
5. **Checkpoint incrementally (Jini addition, decided 2026-07-17).** Commit and push after each logical unit of work (each subdirectory extracted, each phase), not just once at the end. A cloud session can die, time out, or run out of budget mid-task — if it hasn't pushed anything yet, that work is gone with no way to recover it. Report honestly what's done vs. pending either way, but push what exists as you go so partial progress survives even without a final report.
5. **The guard must actually enforce the result.** A capability-barrel refactor without a passing `check-barrel-imports` registration is incomplete — the boundaries would rot immediately.
6. **Coverage bar (Jini addition, see Phase 6.5): ≥99% on all 4 metrics, 100% as the actual goal, no coverage-suppression comments ever.** Same discipline as the frontend skill, no exceptions for "this is just backend plumbing."

Track the phases below as a task/todo list (use your harness's task tracker if it has one) so progress stays visible.

---

## Tooling accelerators (use when available, degrade gracefully)

Two classes of accelerator make this skill markedly cheaper. Neither is required — every phase works with plain grep/file-reads and inline writing — but when your harness offers them, default to using them:

1. **Cheap-model delegation for mechanical writing.** Summarizing files and drafting JSDoc/`@module` docblocks is high-volume work. Delegate it to a cheaper/faster model as a subagent — on Claude Code, use **Sonnet** subagents; don't drop below Sonnet-class, as Haiku-class models produced unreliable file summaries in practice. Prime targets: the per-file summaries feeding Phase 1's inventory, and Phase 5's docblock/barrel-description first drafts. The senior model (you) keeps everything requiring judgment: clustering, edge design, cycle-breaking, the guard registry, and **review of every delegated block** — a wrong docblock is worse than none.
2. **Code-graph backends for search and understanding.** If **codebase-memory-mcp** or **graphify** is available, prefer them over broad manual reading for: initial repo/module mapping, symbol and file lookup, who-calls-what / import-edge tracing (Phase 1's dependency graph), and impact checks when rewriting external importers (Phase 3.5). Validate any load-bearing graph finding against the actual source before acting on it, and fall back to `rg`/direct reads when graph evidence is weak or the backend isn't installed. Do not silently install a backend — surface the cost and ask first.

---

## Phase 0 — Confirm the target and baseline

1. Identify the subsystem (e.g. `apps/daemon/src/<module>/` or a `<module>.ts` god-file). Confirm it with the user if unstated.
2. Capture a green baseline **before touching anything**: run the module's existing tests and the package typecheck, and record the numbers. You will diff against this at the end. If the baseline is already red, stop and surface that — do not refactor on top of a broken base.
3. `git status` — if the working tree is dirty with unrelated work, plan to commit selectively (`git add <specific paths>`) and, for any `main` merge, use the isolated-worktree technique in `references/merge-and-pr.md`.

## Phase 1 — Map the module and design the layout

Read `references/architecture.md` first, then:

1. **Inventory** every file/symbol in the subsystem. For a god-file, list its top-level functions/types/consts. This is the prime spot for the Tooling accelerators above: a code-graph backend (codebase-memory-mcp / graphify) gives you the symbol list and import edges cheaply, and per-file summaries can be delegated to Sonnet-class subagents instead of reading every file yourself.
2. **Cluster by concern**, not by type. design-systems landed on `core / catalog / user / import / tokens / jobs` — yours will differ. Name subdirectories after *what the code does* (read/catalog, write/CRUD, import pipeline, extraction, job store), never after language kind (`utils`, `helpers`, `types`).
3. **Identify the `core/` foundation kernel**: the shared types and pure primitives that many concerns need and that depend on nothing else in the module. Everything may import `core/`; `core/` imports no sibling. See `references/architecture.md` → "The foundation kernel".
4. **Map the dependency graph between clusters.** A code-graph backend's import/call-edge queries are the fast path here; verify surprising edges against the source. Draw the directed edges. Any **cycle** must be broken *before* the split — the standard fix is to relocate the shared piece causing the cycle down into `core/` (design-systems moved `readUserMetadata` into `core/metadata.ts` to break a `catalog ↔ user` cycle). Do **not** plan a two-way edge; that's the smell the whole architecture exists to prevent.
5. Write down the final **`allowedEdges`** (directed, acyclic, `[from, to]`). This list is small on purpose. If it's large, your clustering is wrong — revisit step 2.
6. Get the layout signed off (a short clarifying question or a written plan) before mass file moves — reorganizing is expensive to redo.

## Phase 2 — Extract `core/` and break cycles

1. Create `core/`. Move all shared **types** into `core/types.ts`. Move pure **primitives** (parsers, path/id utilities, metadata read helpers) into focused `core/*.ts` files.
2. Relocate any cycle-causing shared symbol into `core/` (per Phase 1.4).
3. Give `core/` a barrel `core/index.ts`. Subdir barrels **may** use `export *` (the reference's `core/index.ts` and `catalog/index.ts` do); only the **root** barrel must use explicit named re-exports (guard Rule 7). Prefer named exports where a subdir's surface is small and stable, but `export *` from a subdir is allowed.
4. `core/` must not import from any sibling subdirectory — verify by eye now; the guard will enforce it later.

## Phase 3 — Split into concern subdirectories with barrels

1. Move each cluster's files into its subdirectory. Keep functions **byte-identical** during the move — no edits beyond the import-path rewrites the move forces.
2. Each subdirectory gets a barrel `index.ts` re-exporting its public surface (named exports or `export *` — subdir barrels may use either) with a `@module` description (see `references/jsdoc-and-docs.md`).
3. Cross-subdir imports go **only** along a declared `allowedEdges` edge, and **only through the sibling's barrel** (`../<sibling>/index.js`) — never a private file. Same-subdir and `core/` imports are unrestricted.
4. Build the module **root barrel** `index.ts`: explicit named re-exports from the subdir barrels only, reproducing the *exact* prior public surface. No `export *`.
5. Rewrite every **external** importer (other daemon files that used the old flat paths) to import from the root barrel. Grep the whole `apps/daemon/src` tree for old paths and fix all of them.

## Phase 4 — Register and wire the guard

Follow `references/barrel-and-guard.md`:

1. Add the domain to `CAPABILITY_BARREL_DOMAINS` in `scripts/check-barrel-imports.ts` (`name`, `root`, `subdirs`, `foundation`, `allowedEdges`).
2. Confirm it's in the `pnpm guard` chain (the design-systems entry already wired `scripts/check-barrel-imports.test.ts` into guard; a new domain reuses the same machinery — you're only adding a registry entry, not new scan code).
3. Run the guard; fix every violation by correcting the *import*, not by loosening the rules. If a rule genuinely can't be satisfied, that's a design signal — revisit the clustering, don't add an exception.

## Phase 5 — Document: JSDoc every function, `@module` every file, write the README

This is a hard acceptance bar. See `references/jsdoc-and-docs.md` for the exact conventions. In brief:

1. **Every file** starts with a `/** @module <name> ... */` docblock explaining what the file owns and how it relates to siblings.
2. **Every exported function/type** gets JSDoc (`@param`, `@returns`, and *why* it exists). Private helpers get a short block tagged `@internal`.
3. **Every barrel** carries a one-line description of the layer's responsibility.
4. Write/refresh the module's `README.md` mirroring `design-systems/README.md`: What changed · Why this shape · Import conventions · Known limitations & staged migration · Directory structure · Types.
5. **Default accelerator:** delegate the mechanical docblock/barrel-description drafting to a cheaper/faster model as a subagent when your harness supports it — on Claude Code, Sonnet subagents (Haiku-class models proved too error-prone for this). *You* review every block for accuracy; a wrong docblock is worse than none. If you can't delegate, write them inline.

## Phase 6 — Validate (nothing is done until this is green)

Run, in order, and record real numbers (see `references/merge-and-pr.md` for exact commands):

1. `node --import tsx --test scripts/check-barrel-imports.test.ts` — the guard's own suite.
2. `pnpm guard` — includes the barrel check across all registered domains.
3. `pnpm --filter @open-design/daemon typecheck` — **src *and* tests** must be clean.
4. The module's targeted test suite — must match or beat the Phase 0 baseline.
5. **Public-surface diff:** confirm the root barrel exports the exact same names as before (e.g. diff the old vs new export list). This is the "external importers unaffected" proof.

If you merged `main` mid-flight, re-home any features `main` added to the *old* structure into the *new* split files (main will keep editing the monolith while your PR is open) — see `references/merge-and-pr.md`. An independent second-model audit of the merge caught real dropped-import blockers on the reference PR; consider one for non-trivial merges.

## Phase 6.5 — Coverage-driven refactor loop (Jini addition — the vendored original has no coverage section)

Ported from the sibling `fixing-open-design-web` skill's Phase 9.5, adapted to backend vocabulary. Run this after Phase 6's validation is green, before Phase 7 (opening the PR). Target: **≥99% on all 4 metrics (statements/branches/functions/lines) for every module touched by the refactor, aggregate AND per file, with 100% as the actual goal.** Coverage is a floor, not a target to game — a capability-barrel move is exactly the kind of change (files split, imports rewritten, cycles broken) that silently drops or duplicates a branch if you're not checking real per-file numbers, not just "the suite still passes."

Run with `json-summary`+`json` reporters (the v8 text table drops rows). While any of statements/branches/functions/lines sits below 99% (aggregate or per file) on a touched module:

1. **Classify every uncovered line/branch before touching anything** — do not add a test or delete code speculatively:
   - **Genuinely reachable, just untested** → write the test. This is the common case and should be most of the loop's work.
   - **Dead branch** (a condition that can no longer occur post-split, an `else` left over from a removed caller, a defensive check duplicated by an earlier guard) → **refactor it away** behaviorally-safely rather than write a contrived test to hit it. Note: Phase 0's "no behavior changes" rule still applies — a dead-branch removal that changes observable behavior isn't a coverage fix, it's a real change; if you're not certain a branch is truly dead, treat it as reachable-and-untested instead and write the test.
   - **Environment-only guard** (a check for a runtime context that only applies in one deployment mode) → add a companion test that exercises the guard for real in that mode, not a suppression comment.
   - **TS-required fallback with no real runtime path** (a `??`/non-null assertion satisfying the type checker) → a non-null assertion with a one-line comment explaining why it's safe, not a test.
2. **Badly-wired code and endless nesting are refactor signals, not coverage problems.** If hitting a branch requires threading 4+ levels of conditional setup, the fix is to flatten/extract (guard clauses, early returns, splitting the function per Phase 1's clustering logic) — not to write an equally convoluted test that mirrors the nesting.
3. **Never fake the number. Coverage-suppression comments (`/* v8 ignore */`, `/* istanbul ignore */`, or any equivalent) are NEVER a valid outcome of this loop, under any classification above, no exceptions.** If a branch truly cannot be justified by any of the four classifications, that's a signal the branch shouldn't exist — refactor it out.
4. Re-run coverage after each batch of fixes; repeat from step 1 until every metric clears 99% aggregate and per file (and ideally 100%) for every module the refactor touched. Record the final numbers (aggregate + any file that needed a specific call-out) in the PR body's Validation section, alongside the Phase 6 numbers.

## Phase 6.6 — Async/network test-category gate (Jini addition, 2026-07-18)

Phase 6.5's coverage percentage does not by itself catch this class of bug. On OD PR #5228, a `MemorySection.tsx` decomposition attempt surfaced real, pre-existing async/state-correctness bugs in the original — malformed-response trust, a concurrency race, missing error handling, and stale state on retry — none of them caught, because the original's tests were 100% happy-path. For any module this refactor touches that makes a network request or holds async state, write explicit tests for all 4 of the following before treating Phase 6.5 as satisfied:

1. **Malformed-but-technically-successful response** — a 2xx response missing an expected field must fail/throw, not get silently treated as empty/not-found.
2. **Racing async operations** — a stale request that completes after a newer one must not clobber the newer state.
3. **Rejected promise with no handler** — must surface visibly to the caller/logs, never become an unhandled rejection.
4. **Stale state after retry** — a retry's success handler must not clear/overwrite state without checking whether the world moved on during the async call.

A module with no network/async surface is exempt — say so explicitly rather than skipping silently.

## Phase 7 — Open the PR

Use the template in `$SKILL_DIR/templates/pr-body.md` and the process in `references/merge-and-pr.md`:

1. Commit **only** the refactor's files (`git add <paths>`), never unrelated WIP. No co-author trailers (repo policy).
2. Fill the PR body: **Why** (both your use case *and* the pain — tech debt / unenforceable boundaries), **What users will see** (nothing; internal refactor, public API identical; name the QA regression surface), **What this does**, **Scope / boundary**, **Surface area** (template checklist — a pure refactor is `None`), **Validation** (the real Phase 6 AND Phase 6.5 numbers).
3. Cross-repo PRs push to the contributor's **fork** remote, not `origin` (upstream 403s). Verify with `gh pr view <n> --json headRepositoryOwner,isCrossRepository`.
4. If a reviewer flags that the guard's scope doesn't match a promise in the description, prefer **narrowing the wording** to what's actually enforced (runtime code under `apps/daemon/src`; tests may white-box internals but public-surface tests still import via the barrel) over widening the scan — see `references/barrel-and-guard.md` → "Scope is runtime code, by design".

---

## Definition of done

- [ ] Module split into `core/` + concern subdirs, each with a barrel; root barrel = explicit named re-exports; root-barrel export names identical to before (subdir barrels may use `export *`).
- [ ] Dependency graph acyclic; every cross-subdir edge declared in `allowedEdges` and routed through a sibling barrel.
- [ ] Domain registered in `CAPABILITY_BARREL_DOMAINS`; `pnpm guard` green.
- [ ] Every file has a `@module` docblock; every exported function has JSDoc; module `README.md` written.
- [ ] Phase 6 validation all green, numbers recorded; baseline matched or beaten.
- [ ] **Phase 6.5: coverage ≥99% on all 4 metrics (statements/branches/functions/lines) for every touched module, aggregate and per file, 100% as the actual goal — never a coverage-suppression comment, no exceptions.**
- [ ] **Phase 6.6: every touched module with a network/async surface has explicit tests for all 4 bug categories (malformed 2xx response, racing async ops, unhandled rejection, stale state after retry) — see the OD PR #5228 postmortem.**
- [ ] PR opened with Why / What users will see / What this does / Scope / Surface area / Validation (including the Phase 6.5 and 6.6 numbers), pushed to the correct remote.
