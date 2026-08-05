# Seat 4 — Opus 4.8 (1M) — Blind First-Round Submission

Frozen before reading any other seat. Grounded in read-only inspection of the actual repos.

## Executive recommendation

**Package-first strangler extraction, performed *in place* inside the existing Open Design monorepo, promoting stable seams into a `@jini/*` npm scope — with the "Jini repository" reframed as a thin consumer shell (reference app + AI-Dev-Shop + project-runner) that pulls `@jini/*`, NOT a second copy of Open Design.**

Reject the two tempting extremes:

- **Reject "blank engine repo + OD as reference."** You throw away OD's CI, guard scripts, 40-file contracts package, test suites, and the mature `runtimes/` registry — all of which are *already* the engine. You'd rebuild them worse.
- **Reject "copy OD then refactor behind adapters" (the current Jini state).** This is already failing in front of us: the Jini checkout is a full OD copy whose git remotes still point at `nexu-io/open-design` and `leonaburime-ucla/open-design`, with `apps/web/src` half-deleted. That is drift and confusion incarnate — two diverging implementations with no sync path. Every day it exists it gets more expensive to reconcile.

The evidence for package-first: OD is **not a monolith needing a rewrite**. `packages/` already contains 14 separated packages (`contracts`, `components`, `platform`, `host`, `sidecar`, `sidecar-proto`, `plugin-runtime`, `registry-protocol`, `agui-adapter`, `download`, `diagnostics`, `launcher-proto`, `metatool`, `release`). `apps/daemon/src/runtimes/` is already an adapter-shaped agent-runtime registry (`registry.ts`, `detection.ts`, `capabilities.ts`, `RuntimeAgentDef` type, `defs/*.ts` for ~28 CLIs, stream parsers `claude-stream.ts`/`json-event-stream.ts`/`qoder-stream.ts`/`plain-stream.ts`). The engine is 70% already carved; the job is to *name the seams and enforce the boundary*, not to relocate a codebase. Do the extraction where the tests and CI already live, publish `@jini/*`, and let the Jini repo consume them. Graduate a package to a physically separate repo only after a **second real consumer** exists — never before, or you're just guessing at the abstraction.

## Answers to the brief's question sections

**Jini repo strategy.** One monorepo (OD's) is the *workshop*; Jini is a *storefront* repo that depends on published/`workspace:`-linked `@jini/*` packages plus `AI-Dev-Shop/` and `project-runner/`. OD stays the first consumer. Upstream OD → Jini flows automatically because the packages ARE in OD; there is no re-sync. Fixes found during extraction land in OD directly (same repo) — no back-port. Jini materializes real code only for: the reference app, the control plane, and adapters that have ≥2 consumers.

**Daemon architecture & portability.** What the daemon does: HTTP API host, agent process spawning + stream normalization, project/workspace filesystem services, artifact services, design-system/brand/figma/deploy/media/marketplace product features, static serving, persistence (SQLite under one resolved `RUNTIME_DATA_DIR`). Reusable engine core: **agent-runtime registry** (`runtimes/`), the `http/` request/response abstraction (`adapter.ts`, `origin-guard.ts`, `parse.ts`, `response.ts`), artifact services, a persistence *port*, and project/workspace service *interfaces*. Product-specific (do NOT generalize yet): `design-systems`, `brands`, `figma`, `deploy`, `media`, `connectors`, plugin marketplace specifics, OD route shapes, OD analytics. Can it be copied and run today? No — `server.ts` (8,635 lines) is the composition root and drags every product concern via direct imports; hidden assumptions that travel: `RUNTIME_DATA_DIR` layout, design-system/skill directories, OD daemon route contract, packaged desktop paths. Extraction difficulty: **medium for `runtimes/` (already isolated), high for the `server.ts` composition root** (needs a composition-root refactor: a `createEngine({ ports })` factory the product wires). The user's `server.ts`/route/runtime extractions are exactly the right seams — continue them; they're prerequisites, not detours. Exposure: **embeddable library FIRST** (`@jini/engine` factory), then HTTP daemon and CLI as thin adapters over it — OD already proves UI+CLI dual-track over one HTTP layer works, so preserve that as the contract. Normalize per-agent differences via the existing `RuntimeAgentDef` capability descriptor (already models `promptInputFormat`, stream shape, etc.) — extend it with explicit capability flags (auth, model-discovery, cancellation, resumability, mid-turn-input) rather than a lowest-common-denominator interface; unknown capabilities degrade, they don't disappear.

**Frontend architecture & reusable UI.** Layers today: Next route → ClientApp → App/AppInner shell → home/project/workspace views → chat/file-viewer/design-systems/plugins/memory/settings → providers → daemon APIs. Reusable: `artifacts/` (parser/registry/types), chat presentational components, question-form artifact, tool cards, message rendering, conversation/run *models*. Must stay OD-specific: project/workspace filesystem semantics, design systems, plugin marketplace, comments-on-canvas, file previews tied to OD. Design: **headless hooks + presentational components + adapter/slot interfaces** (not web components, not a monolithic component library). The `memory` feature slice is the *pattern*, not the template. Decompose `ChatPane`/`ChatComposer`/`App` as: pure **model** (render-item construction, payload assembly) → **runtime hooks** (subscriptions, run state) → **presentational components** (slots for OD-specific chips/previews) → **`ChatRuntimeAdapter`** port (OD implements it over daemon endpoints). Keep it useful outside Next.js by making packages framework-agnostic React (no `next/*` imports in `@jini/chat-react`).

**Automation & cloud execution.** `project-runner/` = durable ledger + task-selection + checkout-prep + runner-dispatch + session recording (NOT a CI system). Executors: Codex cloud + Claude for bounded refactors; AI-Dev-Shop owns governance/roles. A cloud agent claims a task by writing a **lease** (agent-id + expiry) into the ledger, creates a worktree/branch, records a session file, runs the task's validation commands, writes results + handoff, releases the lease. Concurrency safety: leases + non-overlapping `scope[]` file sets + a "one task per file-region" invariant checked before claim. Human checkpoints: any contract/API-shape change, any package-boundary graduation, any OD-behavior change. Autonomous: pure helper moves, characterization tests, mechanical refactors with passing validation. Compatibility guard against "optimize Jini, break OD": every extraction task must keep OD's own test suite + guard green as a validation command — that's the tripwire.

**Durable task/session ledger.** Files: `ADS-memory/reports/jini-port/tasks.json` (source of truth), `sessions/<ts>-<taskid>.md`, `decisions.md`, `blockers.md`, `leases.json`, `source-branches.md`. Committed: tasks, decisions, blockers, session handoffs (they're the resume state). Ephemeral/local: heavy indexes, worktrees, build output. States: `pending → claimed → in_progress → (done | blocked | failed)`; `blocked/failed → pending` on human reset. Each task records: id, source repo+ref, target package, scope files, allowed/forbidden changes, validation commands, status, last-session path, blocker, lease. Concurrency: optimistic write with a `version` field + lease; conflicting writes reconcile by re-reading and re-claiming.

**Codebase-understanding reports.** Run CBM MCP / Graphify / Understand Anything *locally* (repo is ~5.5GB; indexes are heavy). Commit only small distilled artifacts: an architecture overview, a dependency-seam map, a key-symbol index, hotspot list, and a `source-map.md` per extracted package — each stamped with the exact repo+branch+commit it describes. Heavy graph indexes stay local or in object storage (R2). Cloud agents read **both** a one-page overview AND a folder of scoped per-slice reports. Refresh via a `project-runner` command that re-stamps commit + flags staleness; never present a stale graph as current.

**AI-Dev-Shop & governance.** Keep it top-level in Jini (it's the agent/harness/governance layer, not an OD adapter — do not bury under `integrations/`). Vendor it if it's your own code you edit here; submodule if it has an independent lifecycle. It owns roles/policy; `project-runner` owns the mechanical ledger + dispatch. No overlap: governance decides *what/who*, runner executes *how*.

**Reference-repo size & provenance.** Never vendor+commit OD source into Jini. Order of preference: (1) git **submodule** to `nexu-io/open-design` (GitHub stores a pointer, keeps Jini tiny); (2) **sparse/partial clone** created on demand by `project-runner` (`--filter=blob:none --sparse`) — best for cloud agents; (3) ignored local clone. Preserve provenance with per-package `source-map.md` (OD path → Jini path, origin commit) and retained license headers.

**Compatibility/releases/operations.** Contract = `@jini/contracts` (already exists as OD's pure-TS `contracts` package — promote it). Version with semver; changes gated by contract tests that run against OD. Security boundaries: keep the daemon's single-`RUNTIME_DATA_DIR` discipline, subprocess sandboxing, credential isolation as engine ports. Failure recovery: malformed stream → the existing stream parsers already tolerate; lease expiry → task returns to `pending`; partial migration → each phase has a rollback point (see below). Observability: per-run cost/retry/failure metrics (OD's `metrics/` is a starting point). Rollback: every phase is a revertable PR; no flag-day.

**Cost & model use.** Cheap tier (Haiku/Flash) for indexing, summarization, ledger updates, mechanical moves, validation running. Strong tier (Opus/GPT-5.6) reserved for boundary design, composition-root refactor, adapter interface design, and conflict reconciliation. Cap cost by making 90% of tasks mechanical + cheap-model-runnable, with strong-model checkpoints only at boundary decisions.

## Top-level Jini folder tree

```
Jini/
  AI-Dev-Shop/                 # governance, agent roles (top-level, not under integrations/)
  project-runner/              # ledger + dispatch control plane
  packages/                    # @jini/* engine packages (or workspace-linked from OD during phase 1)
    engine/                    # createEngine({ ports }) factory
    agent-runtime/             # extracted runtimes/ registry + stream normalizers
    contracts/                 # promoted from OD contracts
    artifacts/                 # artifact parser/registry/types
    chat-react/                # headless hooks + presentational chat components
  apps/
    reference/                 # minimal reference app proving reusability (the "second consumer")
  integrations/
    open-design/
      adapter/                 # OD implements engine ports (lives in OD during phase 1)
      compatibility-tests/
      source-map.md
  references/
    open-design/               # submodule OR sparse-clone (never vendored+committed)
  docs/
    jini-open-design-porting-plan.md
    jini-port/
      tasks.json  sessions/  decisions.md  blockers.md  leases.json  source-branches.md
    reports/                   # small distilled maps, commit-stamped
```

During Phase 1 the real code stays in the OD monorepo under `packages/@jini/*`; the tree above is the *destination*, reached by graduation, not by copy.

## Phased migration plan (with rollback points)

- **Phase 0 — Stop the drift.** Decide Jini's identity; **abandon or archive the current Jini-as-OD-copy** (its half-deleted `apps/web/src` and OD remotes are a trap). Rollback: trivial — nothing extracted yet.
- **Phase 1 — Name seams in OD.** Create `packages/@jini/*` skeletons inside OD; move `runtimes/` → `@jini/agent-runtime`, promote `contracts` → `@jini/contracts`, extract `artifacts/` → `@jini/artifacts`. OD imports them. Rollback: each is a revertable PR; OD behavior unchanged (guard + tests green as gate).
- **Phase 2 — Composition root.** Introduce `createEngine({ ports })`; strangle `server.ts` (8,635 lines) into engine core + OD product wiring. Rollback: keep old `server.ts` path behind a flag until the factory passes the full E2E suite.
- **Phase 3 — Frontend seams.** `ChatRuntimeAdapter` port; decompose ChatPane/ChatComposer into model/runtime/components; OD keeps its adapter. Rollback: per-component, characterization tests lock behavior.
- **Phase 4 — Second consumer.** Build `apps/reference` against `@jini/*`. This is the *proof of reusability* and the trigger to physically graduate packages into the Jini repo.
- **Phase 5 — Graduate.** Publish `@jini/*`; Jini repo consumes them; OD switches to the published packages. Rollback: `workspace:` fallback.

## Frontend extraction sequence

1. Characterization tests (chat render, artifacts, TodoWrite, run errors, attachments, composer payload). 2. Move pure helpers out of ChatPane/ChatComposer (no visual change). 3. Extract `@jini/artifacts` (parser/registry/types). 4. Introduce `ChatRuntimeAdapter` (OD-only impl). 5. Extract presentational chat components with slots. 6. `@jini/chat-react` package. 7. OD consumes it, behavior unchanged.

## Daemon extraction sequence

1. `@jini/agent-runtime` from `runtimes/` (crown jewel, already adapter-shaped). 2. Promote `contracts` → `@jini/contracts`. 3. Extract `http/` request abstraction to an engine transport port. 4. Define persistence + project/workspace + artifact ports. 5. `createEngine({ ports })` factory; strangle `server.ts`. 6. OD product features (design-systems/brands/figma/deploy/media/connectors) become OD adapters wiring engine ports. 7. Thin HTTP daemon + CLI over the engine library.

## project-runner + task-ledger contract

- Files: `tasks.json`, `leases.json`, `sessions/`, `decisions.md`, `blockers.md`, `source-branches.md` (all committed except worktrees/indexes).
- Task schema: `{id, status, source_repo, source_ref, target, scope[], goal, allowed_changes[], forbidden_changes[], validation[], version, last_session, blocker, lease}`.
- States: `pending → claimed → in_progress → done|blocked|failed`; recovery edges back to `pending`.
- Lease: `{task_id, agent_id, acquired_at, expires_at}`; expiry returns task to `pending`.
- Locking: optimistic `version` bump + lease; conflicting writer re-reads and re-claims.
- Commands: `jini-next-task`, `jini-start-session`, `jini-finish-session`, `jini-validate`, `jini-sync-open-design`.

## Cloud-context export layout

Committed (small, commit-stamped): `docs/reports/overview.md`, `docs/reports/seams/<slice>.md`, `docs/reports/key-symbols.json`, `docs/reports/hotspots.md`, per-package `source-map.md`. Local/R2 only: full CBM/Graphify/Understand-Anything indexes. Cloud agents read overview + scoped slice report for their task.

## Decisions requiring user approval

1. **Repo topology**: extract-in-OD-then-graduate (my rec) vs separate-Jini-now. 2. **Fate of the current Jini copy** — archive it (my rec) vs salvage its `apps/web/src` work. 3. **`@jini` npm scope name** + publish vs workspace-only. 4. **OD reference mechanism**: submodule vs sparse-clone. 5. **Whether OD upstream (`nexu-io`) will accept `@jini/*` package boundaries** — if not, extraction happens on your fork and this becomes a hard fork decision.

## First 10 implementation tasks

1. `phase0-jini-identity` — decide/record repo topology + archive the drifting Jini copy. Validation: `decisions.md` updated; Jini remotes resolved. *(human decision)*
2. `ledger-bootstrap` — create `ADS-memory/reports/jini-port/{tasks.json,leases.json,sessions/,decisions.md,blockers.md}` + `project-runner` skeleton. Validation: `jini-next-task` runs.
3. `od-baseline-report` — run CBM/Graphify locally, commit distilled `overview.md` + seam map, commit-stamped. Validation: report exists, stamp matches HEAD.
4. `agent-runtime-characterization` — lock `runtimes/` behavior via mock-CLI replay (`mocks/`). Scope: `apps/daemon/src/runtimes/**`. Validation: `pnpm --filter @open-design/daemon test`.
5. `extract-jini-agent-runtime` — move `runtimes/` into `packages/@jini/agent-runtime`, OD imports it. Validation: daemon typecheck + test + `pnpm guard`.
6. `promote-jini-contracts` — re-scope `packages/contracts` as `@jini/contracts`, keep OD alias. Validation: `pnpm typecheck` + guard.
7. `chat-characterization-tests` — lock chat/artifact render behavior. Scope: `apps/web/src/components/ChatPane.tsx`, `ChatComposer.tsx`, `artifacts/`. Validation: `pnpm --filter @open-design/web vitest ChatPane ChatComposer`.
8. `chat-model-pure-helpers` — move pure render-item/payload helpers into `features/chat/model`. Validation: web typecheck + the characterization tests.
9. `extract-jini-artifacts` — `packages/@jini/artifacts` (parser/registry/types), OD adapter stays in app. Validation: web typecheck + vitest artifacts.
10. `chat-runtime-adapter-port` — define `ChatRuntimeAdapter`; OD implements over daemon endpoints; no package move yet. Validation: web typecheck + chat characterization green.

## Assumptions

- OD's own test suite + `pnpm guard` + `pnpm typecheck` are trustworthy tripwires (verified these commands are the documented gate in AGENTS.md).
- `runtimes/` has no deep circular coupling into `server.ts` product concerns (needs verification in task 4 before extraction).
- The user controls the fork and can restructure `packages/` there even if `nexu-io` upstream won't take `@jini/*`.

## Top 5 risks + mitigations

1. **The drifting Jini copy becomes the "real" repo by accident.** → Phase 0 archives it *first*; nothing extracts until identity is decided.
2. **`server.ts` composition-root refactor stalls (8,635 lines).** → Strangle behind a factory with the old path kept until E2E passes; never big-bang.
3. **Premature package boundaries (abstraction guessed, not proven).** → No graduation to a separate repo until a second consumer (`apps/reference`) exercises it.
4. **Cloud agents corrupt the ledger / duplicate work.** → Leases + non-overlapping scope sets + optimistic version bumps; OD-test-green as every task's gate.
5. **Upstream OD rejects the boundary changes → silent hard fork.** → Surface as decision #5 up front; if fork, keep a documented merge cadence from `nexu-io/main`.
