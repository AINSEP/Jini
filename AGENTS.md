# Jini — Directory Guide (agent entry point)

> **MANDATORY STARTUP — do this before anything else (blocking):**
> 1. Read **`AI-Dev-Shop/AGENTS.md`** and activate the AI Dev Shop multi-agent pipeline. It defines the agents, skills, and delivery workflow used to build this repo — do not proceed without loading it.
> 2. Then read **`foundry/docs/jini-port/START-HERE.md`** and **`foundry/docs/jini-port/extraction-plan.md`** for the locked architecture and the task list.
> 3. Before searching for code or planning any feature, use **[Codebase search](#codebase-search--query-the-indexes-first-default-alongside-rg)** below — query the local indexes first, not just `rg`.
> 4. Spin up the **[`sidekick` helper agent](#sidekick--the-sonnet-5-helper-agent)** and keep it available for the session. See below for what to hand it.
> Skipping step 1 is a blocker: the pipeline, personas, and skills that do the work live there.

> **⚠️ PORT STATUS — how much is actually left (read before trusting "done"):**
> Jini is **early, not near-complete.** The `@jini/*` list below is real, tested
> code — but it is a set of *fragments*, and **there is no runnable daemon.** The
> entire backend service spine (`server.ts`, `cli.ts` bootstrap, `routes/`,
> `mcp.ts`, `start-chat-run.ts`, `db.ts` schema, `plugins/` host) — **~49K lines** —
> is **absent**. `@jini/node-host`'s `createLocalNodeDaemon` assembly now **does
> exist** (`packages/node-host/src/create-local-node-daemon.ts`, ~840 lines) — it
> assembles the daemon's pieces, but the backend service spine above is still the
> load-bearing gap it would sit in front of. Measured 2026-07-18: **~73.5K lines ported** (of which ~15K frontend is
> *unaudited*), **~93K generic still to port** (the ~49K backend spine is the
> load-bearing gap), and **~364K of OD is *product*** that must stay out of the
> neutral engine. **Do not read the package list below as "the engine is mostly
> built."** Full breakdown: **`ADS-memory/reports/od-port-status-2026-07-18.md`**
> and `ADS-memory/reports/daemon-full-gap-map-2026-07-18.md`.

**Read `foundry/docs/jini-port/START-HERE.md` first**, then `foundry/docs/jini-port/extraction-plan.md`. Those hold the locked architecture, the reasoning (every debate transcript), and the dependency-ordered task list. This file is the map; those are the authority.

## `sidekick` — the Sonnet 5 helper agent

Definition: **`.claude/agents/sidekick.md`** (`model: sonnet`). Spin one up at the start of
each session with the Agent tool (`subagent_type: "sidekick"`) and keep it available —
continue the same instance with `SendMessage` rather than spawning a fresh one per errand,
so it keeps its context.

**It exists to absorb the well-specified, low-judgment work** so the primary (Opus) session
stays on architecture and correctness:

- **Playwright** — screenshots, a11y/DOM snapshots, click-through verification, console +
  network capture against the running playground. This is its main job.
- **Mechanical code** — apply an already-decided pattern, wire a designed prop through,
  add test cases in an existing file's style, scaffold fixtures.
- **Run and report** — `pnpm typecheck`, `pnpm guard`, package tests, builds; paste real output.
- **Chores** — start the playground services, probe health endpoints, grep logs, confirm a
  symbol at a cited line.

**Do not hand it**: architecture or protocol design, security/permissions judgment, anything
that would relitigate a locked decision in `foundry/docs/jini-port/extraction-plan.md`, or
deletions it did not author. It is instructed to stop and report a blocker instead.

It is **not** a reserved AI Dev Shop pipeline agent — it labels itself `Sidekick(Assist):`
and needs no persona-file bootstrap. Reserved names (`Programmer`, `QA/E2E`, …) still go
through the delegated-agent bootstrap in `AI-Dev-Shop/AGENTS.md`.

## `honest-testing` — the anti-cheating guard rail

Definition: **`.claude/skills/honest-testing/SKILL.md`**. Load it whenever the task is "add
tests", "get to 100%", "close the coverage gap", or reviewing someone else's test diff.

It exists because every cheap way to raise a coverage number also destroys that number's meaning,
and most of those ways look like tidying in a diff: an `ignore` comment, a widened `exclude` list,
a lowered threshold, a `toBe` softened to `toBeDefined`, a branch deleted rather than covered, a
capability dropped because it was awkward to reach.

The rule it encodes: **coverage rises because more behavior is verified — never because less code
is measured, less is asserted, or less is done.** A genuinely unreachable branch gets *refactored
away* with a comment naming what guarantees it, not fake-tested. An honest 99.7% with an
explanation beats a 100% someone later discovers was hollow.

It matters most when delegating: a subagent told "make this 100%" will do exactly that, by
whatever route. The skill lists what to put in the dispatch prompt (the banned moves, the
before/after **test count** so deletions cannot hide) and what to check in the returned diff.

### Context budget and sidekick restarts

A sidekick fills its context fast (a11y snapshots, test logs, wide greps), so it tracks a
weighted tool-call budget and keeps its own incremental ledger at
**`ADS-memory/.local-artifacts/handoff/sidekick/<slug>.md`** — refreshed after every step,
not just at the end, so a dead run is never a total loss.

Coordinator side of that contract:

- **Pass a task slug in the dispatch prompt** (`slug: baseline-capture`). Without one the
  sidekick derives its own and reports it — you then have to read it back out of the reply.
- When a report leads with **`HANDOFF NEEDED`**, do not re-dispatch the original prompt.
  Spin up a fresh sidekick and point it at the ledger path, telling it to read the ledger
  first, re-verify the "Live state" section, and resume at the named step.
- A sidekick only ever writes its own `sidekick/<slug>.md`. These are scratch artifacts
  under `.local-artifacts/`, not retained reports.

Its `tools:` list names the Playwright MCP tools explicitly
(`mcp__plugin_playwright_playwright__browser_*`). If the Playwright plugin is renamed or
removed, those entries go dead silently — re-check the list rather than assuming the agent
lost the ability.

## Codebase search — query the indexes FIRST (default, alongside `rg`)

Before searching for code, planning a feature, or resolving "does this already exist?", **query the three local indexes below**. They are 100% local, need no API key, and cost nothing to read. Skipping them is how already-shipped code gets rebuilt — this exact failure happened on 2026-07-24 (a parallel tool-execution path was designed before noticing `packages/daemon/src/delegated-tool-bridge.ts` + `packages/mcp/src/bin/serve.ts` already implemented it end-to-end).

**Order: `codebase-memory-mcp` → Graphify → understand-anything → `rg`.**

| index | answers | entry point |
|---|---|---|
| **codebase-memory-mcp**<br>61.9K nodes / 153K edges | *does X exist, where exactly, what calls it, trace the chain* — BM25 search + multi-hop, returns **exact line ranges** | `HOME=ADS-memory/.local-artifacts/codebase-memory-mcp-home AI-Dev-Shop/integrations/codebase-memory-mcp/bin/codebase-memory-mcp cli search_graph '{"project":"Users-la-Programming-Jini","query":"…","limit":8}'`<br>The `project` arg is **required** and is the repo's absolute path slugified — if the repo ever moves, run `cli list_projects '{}'`, re-index, and `cli delete_project` the stale entry.<br>Also: `trace_path`, `query_graph`, `get_architecture`, `search_code`, `index_status`, `detect_changes` |
| **Graphify**<br>12.8K nodes / 24.8K links, 831 communities | whole-repo dependency paths, community/cluster structure | read `ADS-memory/reports/graphify-out/graph.json` + `GRAPH_REPORT.md`<br>rebuild: `GRAPHIFY_OUT=<abs>/ADS-memory/reports/graphify-out graphify update <abs>/packages` |
| **understand-anything**<br>2.5K nodes / 5.8K edges | *what is this for, what invariant does it hold, which layer* — summaries, contract/port nodes, 10 layers, 13-step tour | read `.understand-anything/knowledge-graph.json` |
| **`rg`** | literal strings; always fresh, zero staleness risk | fallback + cross-check |

The first two are deterministic (AST-derived — they cannot fabricate). `understand-anything` is LLM-authored: its **summaries and invariants** are the value ("the sole tool-invocation boundary…"), but cross-check any **structural** claim against the other two.

**Staleness:** each index records the commit it was built at — `.codebase-memory/artifact.json`, `ADS-memory/reports/graphify-out/manifest.json` (per-file `mtime`/`ast_hash`), `.understand-anything/meta.json`. Re-index after significant change; `detect_changes` and the graphify manifest make drift detectable rather than silent. Validators/installers: `AI-Dev-Shop/harness-engineering/validators/check_{codebase_memory,graphify}_capability.sh`; registry + storage policy in `AI-Dev-Shop/integrations/backends.manifest.json`.

## What Jini is

A general-purpose, reusable, headless, agent-drivable engine extracted from Open Design (OD). OD is one consumer of many; the engine core has **no OD tilt**. Consumers (OD, Open-Marketing, Tovu-Runner, Zana) live in their own repos and consume published `@jini/*` packages.

## Layout

- `packages/*` — **the engine** (`@jini/*`), product-neutral. Current: `protocol, core, daemon, agent-runtime, agentic, sqlite, http, cli, platform, sidecar, node-host, chat-core, chat-react, renderers-react, ui, artifacts, deploy, registry, memory, media, capability-providers, desktop-host, diagnostics, mcp, composio, a2ui`. (Two names were stale in this list until 2026-07-28: `agui`, folded into `packages/agentic/src/gen-ui/` on 2026-07-26 — see `packages/agentic/source-map.md`'s "Folded from `@jini/agui`" section — and `metatool`, removed from the engine package set in `27410e8e1`. Both may still linger in older working copies as untracked, gitignored `dist`/`node_modules` leftovers; `pnpm guard` flags such a directory as "missing package.json", so delete the leftover rather than hunting a phantom package.) The physical layout stays flat; each `package.json` carries canonical `jini` domain/kind/runtime metadata documented in `packages/README.md` and enforced by `pnpm guard`. `protocol, core, daemon, agent-runtime, platform, sidecar, chat-core, deploy, registry, memory, media, capability-providers, desktop-host` have real implementations (`daemon`: `RunLifecycle`/`EventLog`/`ToolExecutor`; `agent-runtime`: both the `agent-protocol/` ACP+pi-rpc transport AND the `runtimes/` registry/detection/defs/stream-parsers are now ported — see `packages/agent-runtime/source-map.md`'s "Barrel merge" section); the rest are stubs pending extraction. `ui` (renamed from `components` 2026-07-16 — see `packages/ui/README.md`) holds generic, non-chat, non-OD-branded UI: primitives, feature-shaped domains, and their hooks/providers/ports — not just flat components. There is no locked/incubating package-admission gate anymore — removed 2026-07-28; `UNLOCKED.md` is a historical record only. See each package's `source-map.md` for what it implements and what's deferred/skipped.
- `foundry/` — internal supporting material around the engine: automation, architecture docs, and product integrations. It is deliberately separate from the publishable `packages/*` engine.
- `foundry/integrations/open-design/` — the OD adapter (strangler daemon lands here; keeps OD's file tree so upstream fixes `format-patch` in). `reference/od-web-src.orig/` is the real OD web tree for later frontend extraction. **For any question about OD's real current structure, read `/Users/la/Desktop/Programming/OSS-Repos/open-design` instead** — a real, full clone (both `origin=nexu-io/open-design` and `fork=leonaburime-ucla/open-design` remotes) — not this repo's `reference/**` snapshot (see the caveat in `foundry/integrations/open-design/README.md`). That clone already has `AI-Dev-Shop/integrations/graphify/`'s output computed against it (`graphify-out/GRAPH_REPORT.md`, `graph.json`) and is indexed in `AI-Dev-Shop/integrations/codebase-memory-mcp/` — query those before re-deriving structure from scratch.
- `examples/` — the public place to browse and run Jini consumers: `reference-web/` is the Vite host, `reference-desktop/` is its Electron shell, `sample-projects/` contains disposable workspaces, and `minimal-host/` imports ONLY `@jini/*` as the neutrality CI gate.
- `AI-Dev-Shop/` — the declarative pipeline toolkit (vendored, agents/skills/routing), read-only during normal feature work.
- `ADS-memory/` — durable decisions/specs/reports (project-owned workspace, sibling to `AI-Dev-Shop/`).
- `foundry/automation/` — the AI dev control-plane's executable half (separate concern from the engine; never imported by `@jini/*`). `project-runner/` (the execution runtime to build — minimal SQLite ledger first) lives here.
- `foundry/docs/jini-port/` — all architecture docs, recon, and debate transcripts from the 2026-07-16 design session.
- `scripts/` — `guard.ts`, `check-engine-boundaries.ts`, `check-protocol-purity.ts`.

## Hard boundaries (enforced by scripts/guard.ts)

- `packages/@jini/**` MUST NOT import `foundry/**`, `examples/**`, or `AI-Dev-Shop/**`.
- `@jini/protocol` MUST NOT import any OD DTO (downward-only edge).
- No product-identity strings (`Open Design`, `OD_`, `--od-stamp`, `/tmp/open-design`) in `packages/@jini/**`.
- `foundry/automation/**` MUST NOT share domain types with the engine (vocabulary firewall: engine {Run, Agent, Tool} vs automation {PipelineRun, WorkItem, JobAttempt, Persona}). It MAY consume `@jini/agent-runtime` only as a pinned leaf subprocess library.

## Commands

```
pnpm install
pnpm guard        # boundary + neutrality checks
pnpm typecheck
```

## Provenance

Apache-2.0 (inherited from OD). See `NOTICE` and per-package `source-map.md`. Backups of the pre-extraction `integrated` OD trunk are in `../jini-backups/`.
