# Refactor roadmap — what's ahead, and where it runs

Snapshot as of 2026-07-16. Two independent tracks are in flight: the backend
extraction (extraction-plan.md §8, ten milestones, tracked in the
project-runner ledger) and the frontend extraction (r4/r4b recon-driven, NOT
yet in the ledger — see "The ledger gap" below).

## Backend track (ledger-tracked, milestones 1-10)

| # | Milestone | Status |
|---|---|---|
| 1 | Harnesses + sync-ownership manifest | **In progress** — red-spec done (this session's cloud trial), impl/package-contract/tarball/consumer-canary/evidence/human-approval remain |
| 2 | `@jini/protocol` | Real work done directly (not via ledger) — ledger still shows `queued`, needs reconciliation once reached |
| 3 | `@jini/core` | Same as above |
| 4 | `@jini/platform` + `@jini/sidecar` | Same as above |
| 5 | `@jini/daemon` (RunLifecycle + EventLog) | **Real partial progress** (verified 2026-07-17) — 10 real files + `source-map.md` (event-log/close-status/run-lifecycle/tokens), not "not started." Ledger not reconciled, same gap as 2-4. |
| 6 | ToolExecutor boundary | Not started |
| 7 | `@jini/agent-runtime` | **Partial** — 365 real files (ported craft/skills content catalog), but zero TypeScript runtime/registry code yet. The actual instance registry this milestone is about is still greenfield. |
| 8 | `@jini/sqlite` + store ports | Not started (confirmed empty placeholder) |
| 9 | Runs/chat app-services + `@jini/http` + `@jini/cli` | Not started (confirmed empty placeholders) |
| 10 | `foundry/integrations/open-design/daemon/` adapter + external-consumption proof (corrected path, was `products/open-design/daemon/`) | Not started. Scope is `apps/daemon` only — see `ADS-memory/reports/jini-port/recon/r7-od-real-backend-architecture.md`. |

**The ledger gap:** milestones 2-4's `WorkItem`s are still `queued` in the
ledger even though the real work exists in `packages/protocol`,
`packages/core`, `packages/platform`, `packages/sidecar` — that work happened
through direct dispatch, not `claim`/`complete`. The DAG's dependency chain
means this is currently dormant (milestone 1 must fully complete before the
ledger even reaches milestone 2's tasks), but it WILL surface once milestone 1
finishes. **This needs a manual reconciliation pass** — running `claim` +
`complete` against milestones 2-4's sub-tasks with summaries pointing at the
already-existing `source-map.md`s, rather than letting a future cloud session
redundantly redo that work. Local task, judgment call, not automatable.

## Frontend track (recon-driven, NOT ledger-tracked)

| Package | Status |
|---|---|
| `@jini/chat-core` | **Done** — merged, tested, committed |
| `@jini/chat-react` | **Next** — spec fully written (r4b §1.2/§2/§3/§4); source is the chat-pane-slice/chat-composer-slice branches (`ADS-memory/reports/jini-port/od-reference-branches.md`), both public |
| `@jini/renderers-react` | After chat-react — spec in r4b §1.3 |
| `@jini/ui` | **Blocked** on the components/ coupling sweep below |

**Why this isn't in the ledger:** the project-runner DAG is generated
mechanically from extraction-plan.md §8's ten milestones — none of which
mention chat-core/chat-react/renderers-react/ui by name (they were deferred to
"post-daemon" per §12 C9, then this session decided to pursue them in
parallel anyway). So `claim` will never surface frontend work; it's been, and
will keep being, dispatched as separate ad hoc subagent tasks until/unless the
DAG is deliberately extended to include a frontend milestone set.

**The components/ sweep** (217 files, `apps/web/src/components/`): needs a
real import-coupling classification pass before `@jini/ui` can be populated —
same kind of analysis r4-webui.md did by hand for the ~12 chat files, at 18x
the scale. Two ways to do it, neither available/decided yet:
1. Install graphify or codebase-memory-mcp (per
   `AI-Dev-Shop/integrations/backends.manifest.json`) and run a real import-graph
   clustering pass. **Update 2026-07-17: both are now installed and already have
   `/Users/la/Desktop/Programming/OSS-Repos/open-design` graphed/indexed**
   (`AI-Dev-Shop/integrations/graphify/`'s `graphify-out/` + `codebase-memory-mcp`'s
   CLI) — the setup-cost objection no longer applies; this option is now the cheap
   one (query existing output) rather than the expensive one. See
   `ADS-memory/reports/jini-port/recon/r7-od-real-backend-architecture.md` for an example of using
   this for the backend; the same tooling can be pointed at `apps/web/src/components/`
   for this frontend sweep.
2. Replicate r4's manual method (grep-count design/brand/plugin/figma/deck
   references per file, same technique already proven on the chat surface) at
   217-file scale. Zero setup, more manual/scrappy, already proven to work.

## Cloud vs. local — what actually determines it

Not a vibe call — three concrete constraints decide it:

1. **Does the work need my local OSS-Repos clones, the jini-backups bundle, or
   any non-public material?** A cloud routine only gets one repo (Jini itself,
   default branch) as a wired source; anything else it needs, it clones live
   via Bash — which only works for material that's public and doesn't need
   auth. Both OD repos are public, so *reading* OD source is cloud-fine. My
   local `open-design-pr5228-memory`/backup-bundle clones are not reachable
   from a cloud sandbox at all.
2. **Is there already a concrete, unambiguous spec to execute against?**
   Cloud sessions (and my own background subagents) do well when the target
   API/behavior is already fully written down (r4b's chat-core/chat-react
   specs, an extraction-plan gate). They do badly when the task IS the
   judgment call (deciding package boundaries, resolving an architecture
   ambiguity, reconciling stale ledger state against reality).
3. **Does it need analysis tooling that isn't installed, or a decision only a
   human should make?** Installing graphify/cbm-mcp, deciding whether to
   relax a locked boundary, picking a package name — these happen here, once,
   and then the resulting *mechanical* work (the actual extraction once
   scope is decided) can go to the cloud.

| Task | Where | Why |
|---|---|---|
| `@jini/chat-react` extraction | Cloud (background subagent or routine) | Fully spec'd, public source, no judgment calls left |
| `@jini/renderers-react` extraction | Cloud | Same |
| Milestone 1 `m1-impl` (health-boot + patch-canary scripts) | Cloud | Fully spec'd by the red-spec tests themselves |
| Milestones 5-10 (once reached, each fully spec'd by extraction-plan §8) | Cloud | Same pattern as 2-4 |
| components/ coupling sweep | **Local** | Needs tooling install decision + judgment on clustering |
| Milestone 2-4 ledger reconciliation | **Local** | Judgment call (what counts as "already satisfies this gate"), not mechanical |
| Packaging fix (extraction-plan §12 C4 — compiled-only exports, tarball-safe) | **Local first** | Foundational to every future package's tarball/consumer-canary gate; wrong once here breaks everything downstream, want to verify it myself before trusting a cloud run |
| Engine-core boundary lint (adapting `check-web-slice-boundaries.ts`) | Either | Self-contained mechanical work once someone decides the exact rule set; could go cloud once scoped |
| Any naming/boundary/architecture decision (like `ui` vs `components`) | **Local (this conversation)** | Only a human-in-the-loop call, by definition |
