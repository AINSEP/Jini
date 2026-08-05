# Jini — START HERE (session entry point)

If you are a new Claude Code / Codex session picking up the Jini engine work, read this first, then `extraction-plan.md`. Everything decided on 2026-07-16 is captured in this folder.

## What Jini is

A general-purpose, reusable, **headless, agent-drivable engine** extracted from Open Design (OD). OD is one consumer of many (Open-Marketing, Tovu-Runner, Zana, future products), each in its own repo consuming published `@jini/*` packages. **No OD tilt in the engine.**

## Architecture status: LOCKED

The architecture is decided and hardened at three levels (kernel, subsystems, seams). Do NOT relitigate it — extend it. The authority is **`extraction-plan.md`** (§1–§11 = locked design; §12 = whole-system corrections).

**This file is a snapshot of the 2026-07-16 lock-in and is not kept current.** For
real, up-to-date task/package status, read `ADS-memory/reports/jini-port/refactor-roadmap.md`
instead (it's been updated since; this file has not). For OD's real current source
(not this repo's `foundry/integrations/open-design/reference/**` snapshot), read
`/Users/la/Desktop/Programming/OSS-Repos/open-design` directly — see the caveat in
`foundry/integrations/open-design/README.md` and root `AGENTS.md`.

### The one-line story
Jini is a headless daemon that runs coding agents, exposes tools + providers, and streams protocol events over CLI/HTTP/MCP/sidecar. `chat-react`, `desktop-host`, and the automation control-plane are optional satellites that consume it.

### Locked decisions (see extraction-plan.md for detail)
1. **Option A** kernel: small neutral kernel + typed registration contract. Chosen over fixed-ports, microkernel, thin-protocol.
2. **Composition = typed DI tokens** (not a structural union, not a reflection container). `createDaemon` checks `Required − Bound = never` at compile + runtime.
3. Kernel nouns only: `RunLifecycle`, `EventLog/EventSink` (durable store is a KERNEL port — see §12 C1), `AgentExecutor`, `ToolRegistry`+`ToolExecutor` (a real authz gate, being *built* not lifted), `ProviderRegistry`, `Principal/Authorizer`. Runs key on opaque `contextRef`.
4. **Packs own their app-services**; kernel owns orchestration only; HTTP + CLI call the same services; `@jini/node-host` preset = zero-interface boot.
5. **OD stays a consumer in its own repo**; Jini publishes `@jini/*`; OD-sync via hollow re-exports + sync-ownership manifest + CI patch canary + strangler-fig adapter.
6. **`chat-core` (framework-free) is the reusable frontend center, not `chat-react`** (Tovu ships a Vue shell). Vite not Next. AG-UI is a declared-lossy projection of the canonical event stream.
7. **Automation is a separate repo**: AI-Dev-Shop (declarative HOW) → project-runner (executable truth — the one thing to build; it does not exist yet) → ADS-memory (evidence only). Adopt AI-Dev-Shop's existing job state machine.
8. **Vocabulary firewall**: engine {Run, Agent=coding-CLI, Tool} vs automation {PipelineRun, WorkItem, JobAttempt, Worker, Persona}. Never share types by name.
9. **Ship the headless engine first**; frontend (chat-react, Vite shell, renderer hardening) + Tauri are post-daemon milestones.

### Biggest risk to watch
Cross-repository compatibility drift hidden by package-local green tests. Guardrail = a required-CI **release-set matrix** booting real packed tarballs in pinned external consumer fixtures, exercising `create → stream → reconnect → cancel → restart/replay` end-to-end.

## What's in this folder

- `extraction-plan.md` — **THE authority.** Locked architecture, package set (~14), OD-sync mechanism, first-10 tasks with gates, §12 whole-system corrections (C1–C9), risks/guardrails.
- `porting-plan.md` — earlier porting analysis (context, superseded by extraction-plan).
- `architecture/` — `A-design.md` (the locked kernel design), the structure-round-1 synthesis, the v1 proposed structure, the no-OD-tilt constraint.
- `recon/` — grounded recon reports on the real OD code (r1 daemon, r1b daemon-design, r1c discovery, r2/r2b/r2c packages+skeleton, r3/r3b sidecar+desktop, r4/r4b/r4c webui+vite, r5/r5b consumers, r6 project-runner).
- `debate/` — the adversarial review transcripts (round1 structure, structure-debate, lockin, holistic) across four seats (codex gpt-5.6, agy Gemini-3.1-Pro, Claude Fable-5, Opus 4.8). Read these for the *why* behind every decision.

## Backups (outside git)

- `../../jini-backups/integrated-*.bundle` — full backup of the `integrated` daemon-decomposition branch (git bundle).
- `apps/web/src.orig/` — the real OD web tree (the `apps/web/src` symlink into Tovu is broken; use src.orig).

## Next concrete step (per extraction-plan §8 + §12 C6)

1. Bootstrap a **deliberately minimal** project-runner (local SQLite ledger + one worker + filesystem sandbox + manual approval + the N/O CI gates as scripts). Do NOT build the distributed scheduler first.
2. Prove the extraction loop **manually** on packages 1–3 (`@jini/protocol`, `@jini/platform`, `@jini/sidecar`) before automating.
3. Then execute the §8 dependency-ordered tasks, each behind its neutrality (packed-tarball, OD-noun lint) + OD-sync (patch canary) gates.
