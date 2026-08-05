# Swarm Consensus Context Packet

**Date:** 2026-07-19
**Slug:** jini-architecture-debate
**Project Type:** brownfield (mid-extraction port)
**Question:** Given this is a mid-port codebase that is still highly malleable, are there structural/architectural decisions worth reconsidering NOW — before ~93K more lines get ported onto the current shape — and if so, which ones and what should change?
**Intended Consumers:** Primary model + peer CLIs (Gemini 3.1 Pro High via agy, Codex GPT-5.6-sol xhigh)

## Goal

Jini is a general-purpose, reusable, headless, agent-drivable engine being extracted from a
product codebase called Open Design (OD). The human owner wants a second (and third)
independent opinion on whether the architecture, as currently shaped, should be adjusted
*now*, while the port is still ~44% complete and highly malleable, rather than after another
~93K lines get built on top of the current shape. This is NOT a request to relitigate
everything — it is a targeted check for load-bearing structural risks that the team may be
too close to see.

**Framing note:** the repo's own entry-point doc (`ADS-memory/reports/jini-port/START-HERE.md`) states
"Architecture status: LOCKED... Do NOT relitigate it — extend it." That lock was set by the
project's own prior multi-model debate process (see below) 3 days ago (2026-07-16). The human
owner is deliberately choosing to re-open a critical review now, specifically because the
codebase is still malleable — this is not the Coordinator second-guessing a settled decision
on its own initiative. Peers should treat the lock as strong prior evidence (it was itself
produced by a 4-way model debate), not as something to defer to reflexively. Disagreement with
the lock is welcome if justified.

## Scope

**In scope:** package boundaries and the locked package set vs. organically-added packages;
the worktree-per-agent parallel porting strategy; the missing backend spine's design; protocol
purity / neutrality guarantees and how they're actually enforced; the newly-introduced
HTTP-transport-pluggability pattern (Express/Fastify); anything else structurally load-bearing
that would be expensive to unwind after more code lands on top of it.

**Out of scope:** product feature debates for OD itself; UI/component-level design; whether the
extraction should happen at all (already decided, already ~73.5K lines executed).

## Architecture Summary

Jini is a monorepo of `@jini/*` packages implementing a small neutral kernel (Option A: kernel
nouns + typed DI tokens, NOT a structural union / NOT a reflection DI container) that products
register providers/tools/packs against. The one-line story per the locked plan: "Jini is a
headless daemon that runs coding agents, exposes tools + providers, and streams protocol
events over CLI/HTTP/MCP/sidecar." OD is meant to become one consumer among several
(Open-Marketing, Tovu-Runner, Zana are named future/aspirational consumers), each living in
its own repo and consuming published `@jini/*` packages — never vice versa.

**Locked package set (§3 of extraction-plan.md, 14 packages):** `protocol, core, daemon,
agent-runtime, sqlite, http, cli, platform, sidecar, node-host, chat-core, chat-react,
renderers-react, ui`. Kernel nouns are deliberately minimal: `RunLifecycle`, `EventLog`/
`EventSink`, `AgentExecutor`, `ToolRegistry`+`ToolExecutor`, `ProviderRegistry`,
`Principal`/`Authorizer`. Explicitly NOT in the kernel: projects, artifacts, design-systems,
brands, marketplace, conversations.

**Enforced hard boundaries (per `AGENTS.md`, meant to be checked by `scripts/guard.ts`):**
- `packages/@jini/**` must not import `apps/**`, `integrations/**`, `examples/**`,
  `automation/**`, or `AI-Dev-Shop/**`.
- `@jini/protocol` must not import any OD DTO (downward-only edge).
- No product-identity strings (`Open Design`, `OD_`, `--od-stamp`, `/tmp/open-design`) in
  `packages/@jini/**`.
- `automation/**` must not share domain types with the engine (vocabulary firewall: engine
  `{Run, Agent, Tool}` vs automation `{PipelineRun, WorkItem, JobAttempt, Persona}`).

**Locked decisions that most bear on this debate (full text in extraction-plan.md §1-§2, §12):**
1. Option A kernel (small neutral kernel + typed registration contract), chosen over
   fixed-ports/microkernel/thin-protocol, affirmed by 3 independent reviewers in the original
   2026-07-16 debate.
2. Composition = typed DI tokens, explicitly rejecting a structural "union of dependency
   objects" — the plan calls this "the single biggest correction," citing OD's own
   `ServerContext` (a god-object with 40 `any` fields) as the failure mode being avoided.
3. Packs own their app-services; kernel owns orchestration only; `@jini/node-host`'s
   `createLocalNodeDaemon` is the zero-interface boot preset for a new consumer.
4. OD stays a consumer in its own repo, synced via hollow re-exports + a sync-ownership
   manifest + a CI "patch canary" that is supposed to fail if an upstream OD security/bug-fix
   patch touches a path that was delegated into `@jini/*` without the equivalent fix landing
   there too.
5. `chat-core` (framework-free) is the reusable frontend center, not `chat-react` — because a
   named future consumer (Tovu-Runner) ships a Vue shell, not React.
6. Automation (the AI-Dev-Shop pipeline tooling + a not-yet-built `project-runner` execution
   engine) is explicitly a separate repo/concern from the engine, with a hard "vocabulary
   firewall" — engine and automation must never share domain types by name, because OD's
   "agent" (a subprocess coding-CLI adapter) and AI-Dev-Shop's "agent" (a markdown persona)
   are unrelated concepts that already collide on vocabulary (e.g. "canceled" vs "cancelled"
   spelling differs between OD run-status and a sibling contracts file today).
7. **Named "biggest risk to watch" in the plan itself:** "Cross-repository compatibility drift
   hidden by package-local green tests." The stated guardrail is "a required-CI release-set
   matrix booting real packed tarballs in pinned external consumer fixtures, exercising
   `create → stream → reconnect → cancel → restart/replay` end-to-end."

**§12 "whole-system corrections" (C1-C9, from a second holistic 4-reviewer pass on 2026-07-16)
worth knowing:** C1 flagged that OD's real event durability straddles kernel/product (a
~2000-event in-memory ring + a durable copy inside the product's own conversation-message row)
and mandated the durable EventLog store be a **kernel port**, not left to each consumer, to
avoid every non-OD consumer silently losing in-flight output on a long-run reload. C4 flagged
that OD's real packaging model was already broken for tarball consumption (a `development:`
source export that isn't in `files`) and mandated compiled ESM + `.d.ts` + no source exports +
peer-dep React + a local-registry/yalc/verdaccio packed-package dev loop. C8 mandates lockstep
versioning across all ~14 packages through the unstable period. C9 mandates the headless
engine ship before any React work, because Tovu-Runner and "bolt.diy" both embed a daemon and
build their own UI.

## Current State (verified today, 2026-07-19, not from the docs — from direct repo inspection)

- **~73.5K lines ported** (of which ~15K frontend is unaudited), **~93K generic lines still to
  port**. The **~49K-line backend service spine is entirely absent**: no `server.ts`, no
  `cli.ts` bootstrap, no `routes/`, no `mcp.ts`, no `start-chat-run.ts`, no `db.ts` schema
  assembly, no `plugins/` host. There is no fully-running daemon in the strict "boots the real
  product surface" sense yet, though `@jini/node-host`'s `createLocalNodeDaemon` now boots a
  real (if minimal) HTTP server, and an `AgentExecutor` now wires `@jini/agent-runtime` into
  `RunLifecycle` (both landed in the last ~48h).
- **Package set has grown past the locked 14** by ad hoc human decision, without the
  Coordinator/Software-Architect sign-off the repo's own docs say is required before folding a
  new package into the locked set: `deploy` (added 2026-07-16, only loosely named in the plan's
  §10 "roadmap appendix — NOT architecture" as a future feature, not a package), `registry`,
  `memory`, `media`, `capability-providers` (all added 2026-07-18, **not named anywhere** in
  the locked plan), and `desktop-host` (added 2026-07-17; the plan explicitly deferred this
  "until a 2nd host exists," built anyway by explicit human override — no second host consumer
  is confirmed today). `capability-providers` in particular is described in its own
  `source-map.md` as "greenfield, no OD source... built speculatively... with no current
  consumer."
- **An overnight branch (`feat/fastify-http-backend`, pushed to origin, not yet a PR)** just
  split `@jini/http` into a shared root plus independent `express/` and `fastify/` transport
  subtrees, and added a `transport?: 'express' | 'fastify'` switch to
  `createLocalNodeDaemon` (defaults to `'express'`, so existing callers are unaffected). Both
  transports now boot real servers with matching route/middleware/auth behavior; 337 + 57
  tests pass. The commit's own doc comment flags one known gap: a Fastify-transport daemon's
  `stop()` closes the raw `node:http` server directly rather than going through Fastify's own
  `onClose` hooks, since nothing in the codebase registers one today.
- **Heavy use of ephemeral git worktrees for parallel agent-driven porting — larger in scope
  than local worktrees alone reveal.** Locally there are 13 active `.claude/worktrees/agent-
  <hash>/` worktrees plus several named feature worktrees (`fastify-backend`, etc.). But
  `origin` (fetched fresh for this packet, 2026-07-19) carries **41 remote branches total**,
  `main` itself is confirmed up to date with `origin/main` (no drift), and the branch list
  reveals two distinct populations: (a) branches with real unmerged work — e.g.
  `port/source-config-list-resource-dashboard` (32 commits ahead of main, PR #13),
  `docs/od-source-of-truth-and-r7-recon` (26 ahead, no PR found), `feature/jini-ui-rich-text-
  input` (7 ahead, PR #37), `feat/fastify-http-backend` (2 ahead, no PR yet); and (b) a
  cluster of branches sitting at **0 commits ahead of main** — `port/backend-routes`,
  `port/backend-integrations-artifacts`, `port/backend-registry-memory-services-migration`,
  `port/backend-storage-metrics-logging`, `port/agent-protocol-toolexecutor-daemoncore`,
  `port/agent-runtime-from-runtimes`, `port/http-sqlite-platform-protocol-plus`,
  `port/cli-transport-shell`, `port/desktop-host-v1`, `port/media-and-capability-providers`,
  `port/renderers-react-and-annotation-canvas`, and others — which read as **pre-created,
  not-yet-started task branches**, i.e. the missing 49K-line backend spine already has a named
  branch-level task decomposition (routes, agent-protocol/ToolExecutor/daemon-core, http+sqlite
  +platform+protocol, cli-transport, desktop-host, media+capability-providers) even though none
  of that work has landed yet. 5 branches have open PRs (#34, #35, #36, #37, #13); the rest are
  unmerged/unopened, and two (`source-config-list-resource-dashboard` at 32-ahead,
  `od-source-of-truth-and-r7-recon` at 26-ahead) represent meaningfully large unmerged bodies
  of work that have not yet been folded into main.
- **There is currently no CI at all.** No `.github/workflows/`, no other CI provider config
  found anywhere in the repo. `scripts/guard.ts`'s own header comment says `STATUS: skeleton`.
  Of the neutrality checks AGENTS.md lists as "hard boundaries... enforced by
  `scripts/guard.ts`," only 2 of 4 are actually implemented (`checkEngineBoundaries`,
  `checkProtocolPurity`); the "no product-identity strings" scan and the "vocabulary firewall"
  check are both still `// TODO` comments inside `guard.ts` itself. `pnpm guard` and `pnpm
  typecheck` exist as scripts but nothing invokes them automatically on push/merge — they rely
  on an agent or human remembering to run them by hand. The plan's own "biggest risk" guardrail
  (a required-CI release-set matrix booting packed tarballs) does not exist in any form; no
  "release-set" reference of any kind was found in the repo.
- `examples/minimal-host/` exists with a `health-boot.test.ts`, which is the intended
  neutrality CI gate target, but (per the point above) nothing runs it as a gate today.

## Live Tooling Available To Participants

- **`codebase-memory-mcp` ("cbm-mcp")** is configured as an MCP server in both the Codex CLI
  (`~/.codex/config.toml`) and the agy/Gemini CLI (`~/.gemini/settings.json`) environments used
  for this debate. **The Jini repo has just been freshly indexed** (fast mode, 2026-07-19):
  45,611 nodes / 100,178 edges, persisted to `.codebase-memory/graph.db.zst`. Both peer CLIs
  can call `search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, `get_architecture`,
  and `index_status` against project `Users-la-Desktop-Programming-Jini` to ground claims in
  the real dependency/call graph instead of relying on this packet alone. `.claude/`,
  `node_modules/`, `docs/`, `examples/`, `scripts/`, and a handful of asset-heavy subpaths were
  excluded from indexing (see the exclusion list an agent gets from `index_status`).
- **`graphify` / `graphify-mcp`** also exist locally (`~/.local/bin/graphify{,-mcp}`) but are
  **not yet installed as a skill for Codex or Gemini/agy**, and no `graphify-out/graph.json`
  has been built for Jini. A peer could self-install and build one (`graphify install
  --platform codex` or `--platform gemini`, then a graph build step) if it judges that worth
  the setup cost inside its own turn — but this is optional, not pre-staged like cbm-mcp.
- Codex additionally has direct read-only filesystem access to the real repo via its sandbox
  (`-C <repo>`, `-s read-only`); agy does not read repo files directly and should rely on
  cbm-mcp tool calls (pointed at the indexed Jini project) plus this packet.

## Relevant Files And Artifacts

| Path | Why it matters |
|---|---|
| `AGENTS.md` (repo root) | Directory guide, stated hard boundaries, current package list + status annotations |
| `ADS-memory/reports/jini-port/START-HERE.md` | Says architecture is LOCKED; points to extraction-plan.md as authority |
| `ADS-memory/reports/jini-port/extraction-plan.md` | The locked architecture, decision log, and the §12 whole-system corrections (C1-C9) |
| `scripts/guard.ts`, `scripts/check-engine-boundaries.ts`, `scripts/check-protocol-purity.ts` | The only automated enforcement that exists today; guard.ts admits it's a skeleton |
| `packages/http/src/{express,fastify}/` | The new (overnight, unmerged) transport-pluggability split |
| `packages/node-host/src/create-local-node-daemon.ts` | The composition-preset "zero-interface boot," now transport-switchable |
| `packages/deploy/source-map.md`, `packages/registry/source-map.md`, `packages/memory/source-map.md`, `packages/media/source-map.md`, `packages/capability-providers/source-map.md`, `packages/desktop-host/source-map.md` | Provenance + explicit "not yet locked" status for each ad hoc package |
| `.claude/worktrees/*` (13+ active) | The live evidence of the worktree-per-agent parallel porting strategy in progress |

## Constraints

- No dedicated infra/timeline pressure stated by the user beyond "better to do this now while
  everything is modular and being figured out" — i.e., the cost function here is "cost to fix
  later" (rework across dependents) vs. "cost to fix now" (interrupting in-flight parallel
  porting work across a dozen+ live worktrees).
- Apache-2.0 provenance inherited from OD must be preserved (not architecturally relevant, but
  a real constraint on what can change).
- The stated goal is a genuinely neutral, multi-consumer engine — any recommendation that
  quietly re-introduces OD-shaped assumptions to hit a deadline is explicitly against the
  project's own stated purpose.

## Known Unknowns

- Whether the ~13 in-flight agent worktrees are porting code that depends on or conflicts with
  any change a peer might recommend here (e.g., if a peer recommends restructuring `@jini/http`
  further, or moving a kernel port, in-flight branches could need rebasing).
- Whether `project-runner` (the automation execution runtime, explicitly "the one thing to
  build" per extraction-plan.md §12 C6) has been started at all — AGENTS.md says it "lives in"
  `foundry/automation/project-runner/` but the plan says it "does not exist in any repo" as of
  2026-07-16; not verified for this packet.
- Whether the ad hoc packages (`deploy`, `registry`, `memory`, `media`,
  `capability-providers`) have real consumers lined up, or are being built purely speculatively
  ahead of demand.

## Source-of-Truth Inputs

| Source | Notes |
|---|---|
| `ADS-memory/reports/jini-port/extraction-plan.md` | Primary architecture authority, read in full for this packet |
| `ADS-memory/reports/jini-port/START-HERE.md` | Read in full for this packet |
| `AGENTS.md` | Read in full (auto-loaded every session) |
| Direct repo inspection (git log, git worktree list, file finds, `guard.ts` contents, CI config search) | Performed live for this packet, 2026-07-19 |
| `packages/http` + `packages/node-host` test runs | 337 + 57 tests passing, run live for this packet |

## Shared Prompt Payload

See the accompanying Round 1 dispatch prompt (delivered separately, framed per the Debate
Problem-Framing Guard — this packet is the shared factual substrate; the dispatch prompt adds
the neutral question framing and required response shape).
