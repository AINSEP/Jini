# Jini Engine — Locked Architecture & Extraction Plan

Date: 2026-07-16
Status: Architecture LOCKED (Option A + round-2 lock-in fixes). Supersedes `jini-open-design-porting-plan.md`.

Jini = a general-purpose reusable engine extracted from Open Design (OD). OD is the first of many consumers (Open-Marketing, Tovu-Runner, Zana, future products), each in its own repo consuming published `@jini/*` packages. No OD tilt in the engine.

---

## 1. Decision summary

- **Architecture: Option A** — a small neutral kernel + a typed registration contract. Products register providers/tools/packs and supply their own dependency bindings; they never modify the kernel. Affirmed by three independent reviewers (codex gpt-5.6, agy Gemini-3.1-Pro, Claude Fable-5).
- **Composition contract: typed DI tokens** (NOT a structural "union of dependency objects"; NOT a reflection/decorator DI container). This was the single biggest correction — a structural intersection decays exactly like OD's `ServerContext` did (40 `any` fields).
- **OD stays a consumer** in its own repo; Jini publishes `@jini/*`; neutrality is *proven* by a packed-tarball `minimal-host` boot in CI, not asserted.
- **OD-sync is a real, enforced patch lane** (hollow re-exports + sync-ownership manifest + a CI patch canary), because "structurally close" is not a sync mechanism — `git format-patch` names exact paths.

## 2. Architecture

### 2.1 Kernel nouns (the true minimum — nothing product-shaped)

`RunLifecycle` · `EventLog`/`EventSink` (replayable: ordering, replay cursor, idempotency key, cancellation) · `AgentExecutor` · `ToolRegistry` + `ToolExecutor` boundary · `ProviderRegistry` (typed tokens) · `Principal`/`Authorizer`. NO projects, artifacts, design-systems, brands, marketplace, conversations in the kernel. Runs key on an opaque `contextRef`, never `projectId`.

### 2.2 Composition contract — typed tokens

```ts
// @jini/core defines tokens (nominal identity + namespacing + version + one|many)
export const RunStore   = token<RunStore>('jini.runStore');
export const EventLog   = token<EventLog>('jini.eventLog');
export const DeployTarget = manyToken<DeployProvider>('jini.deployTarget');

// each feature PACK declares its own deps by token — no global DaemonPorts bag
export const chatPack = definePack({
  deps: [RunStore, EventLog],
  services: (c) => makeChatServices(c.get(RunStore), c.get(EventLog)), // app-services live IN the pack
  http: (app, svc) => app.post('/chat', ...),   // thin; calls svc
  cli:  (reg, svc) => reg.add('chat', ...),      // thin; calls the SAME svc
});

createDaemon({
  packs:    [runsPack(), chatPack(), odDesignPack()],
  bindings: bindings()
    .bind(RunStore, sqlite.runStore(dbPath))
    .bind(EventLog, sqlite.eventLog(dbPath))
    .bind(PrincipalResolver, localPrincipal)
    .bindMany(DeployTarget, netlifyTarget),      // multi-binding, not a central union
  transports: [httpTransport(), cliTransport()],
});
// COMPILE-TIME: Exclude<RequiredTokenIds<packs>, BoundTokenIds<bindings>> must be never
// RUNTIME: startup rejects missing / duplicate-singleton / version-incompatible bindings
//          with a legible message ("missing binding: jini.runStore")
```

Key rules:
- **Kernel exports only kernel-service tokens.** Every other token lives in its owning feature package. Packs may resolve only their declared tokens. No ambient resolver escapes setup. (This is the anti-`ServerContext` guardrail.)
- **Agents and tools are registry entries, not dependency-object fields.**
- **50 tools never enter the composition type.** Only token *ids* are diffed.

### 2.3 Packs own app-services; kernel owns orchestration only

Business logic lives in each feature pack's transport-neutral app-service. `@jini/http` and `@jini/cli` both call those same services (satisfies OD's dual-track contract: UI and CLI hit the same logic). The kernel never accretes feature business logic → it can't become the next `server.ts`.

### 2.4 Host preset (fixes "new consumer must understand the architecture")

```ts
// @jini/node-host — no business nouns; wires sqlite + local eventing + http/sse + cli
createLocalNodeDaemon({ dataDir, packs: [runsPack(), chatPack()], agents: [codexAgentPack()] });
```
A brand-new chat+runs product implements **zero interfaces** to boot.

### 2.5 Tool-execution boundary (a real gate, not a handler getter)

Register `{descriptor, handler, policy}`; invocation is exposed ONLY via `ToolExecutor.execute(principal, run, tool, input, signal)`. Handlers are never publicly retrievable (routes/agents can't bypass authz). Audit covers requested→authorized→confirmed→started→completed→timed-out→cancelled; confirmation is resumable. The confirm/authorize UI is transport-specific, so the transport injects an `ExecutionDelegate` (`onAuthorize`, `onConfirm`) — the headless kernel can't prompt.

### 2.6 Persistence

Ports are **async-only** (Promise-returning) from day one — OD's `db.ts` is sync `better-sqlite3`; a port that copies sync shapes makes Postgres impossible. `@jini/sqlite` is the default adapter (no `@jini/persistence` umbrella). An adapter conformance suite covers transactions/ordering/cursor-durability/cancellation/migrations.

## 3. Locked package set

```
@jini/protocol       pure wire types: run events, errors, cursors, cancellation, idempotency + token TYPE decls
@jini/core           ProviderRegistry, ToolRegistry, DI tokens + resolver, Principal/Authorizer, pure interfaces
@jini/daemon         RunLifecycle, EventLog/EventSink, AgentExecutor, ToolExecutor, createDaemon (stateful)
@jini/agent-runtime  runtimes registry (INSTANCE-based, built-ins generated at build) + defs + stream parsers + discovery
@jini/sqlite         default store adapter behind core/daemon ports
@jini/http           HTTP/SSE transport + route-pack registrar + injects ExecutionDelegate
@jini/cli            CLI transport (HTTP-client mode default; in-proc enters via identical app-service+principal path)
@jini/platform       OS process/file primitives (verbatim lift)
@jini/sidecar        NDJSON-IPC runtime (+ sidecar-proto; identity injected)
@jini/node-host      composition preset (createLocalNodeDaemon); no business nouns
@jini/chat-core      chat pack + app-services + framework-free parsers
@jini/chat-react     refactored ChatPane/ChatComposer → headless hooks + slots (optional)
@jini/renderers-react  artifact/renderer registry + srcDoc sandbox (optional; renamed from artifacts-react for neutrality)
@jini/ui             generic primitives + feature-shaped UI domains + their hooks/providers/ports (optional; renamed from @jini/components 2026-07-16 — one "components" bucket undersold the scope, see packages/ui/README.md)
# deferred until a 2nd host exists: @jini/desktop-host (electron/tauri + RenderService port)
# NOTE (2026-07-17): built ahead of this deferral by explicit human decision, scoped to the
# C7 narrow slice (shell primitives + bridge + RenderService port + Electron/Tauri adapters).
# See packages/desktop-host/source-map.md — a second host consumer is still not confirmed.
```
All React packages are optional. `@jini/core` (pure interfaces/tokens) is split from `@jini/daemon` (stateful lifecycle) so a short-lived CLI can use the tool/registry surface without pulling the daemon runtime.

**Not yet locked — pending Coordinator/Software-Architect sign-off:** `@jini/deploy` (built
2026-07-16 off the §10 roadmap-appendix entry below; a `DeployTarget` many-token port +
Vercel/Cloudflare Pages adapters, `deploy.publish` shaped as a plain function pending the
task-6 `ToolExecutor`). It is a genuinely new package this list didn't originally enumerate —
listed here for visibility, not folded into the locked set above until reviewed. See
`packages/deploy/source-map.md` for the full design and what's deferred (GitHub Pages/Netlify
targets, real tool-execution wiring).

## 4. OD-sync mechanism (the enforced patch lane)

Requirement: keep absorbing OD's upstream GitHub fixes. `git format-patch` targets exact paths, so:

1. **Hollow re-exports.** The OD adapter (`foundry/integrations/open-design/daemon/…` — corrected 2026-07-17; this doc previously said `products/open-design/daemon/…`, stale from before this repo's `integrations/` rename) **retains OD's exact upstream file tree**. Every file lifted into `@jini/*` is gutted to a 1-line re-export (`export { EventSink } from '@jini/daemon'`). Upstream patches still hit the path.
2. **Sync-ownership manifest.** Maps every upstream daemon path → `product-owned` (patch applies normally, product logic) or `delegated-to-jini` (implementation now lives in a package).
3. **Patch canary in CI (permanent).** Applies representative real upstream patches with a tested directory transform (`apps/daemon/… → foundry/integrations/open-design/daemon/…`). A patch touching a `delegated-to-jini` path **fails CI** until the equivalent `@jini/*` package patch + conformance test land — this prevents a fix applying to a *dead compatibility copy* while the running impl stays vulnerable.
4. **Strangler-fig OD adapter.** Mount OD's Express app whole behind `createDaemon` first; migrate a route group to a pack only after a churn audit (git-log frequency) shows upstream rarely touches it. Patchability is the default; pack-migration is the earned exception.

Note (verified): OD's `agent-runtime` zone is HIGH-churn (stream parsers, the `mocks/` replay harness), not "rarely changes" — so path-mirror those lifted files and keep a patch-router that re-targets upstream diff headers to engine paths.

**Scope is `apps/daemon` only — do not expand to other OD apps without re-reading §12 C7
and `ADS-memory/reports/jini-port/recon/r7-od-real-backend-architecture.md` first.** `apps/desktop`
and `apps/packaged` are real but small (verified 2026-07-17: ~13.5k and ~7.3k real
hand-written lines respectively) and C7 explicitly says not to generalize them into
this mechanism yet. `apps/telemetry-worker` doesn't even exist on upstream
`nexu-io/open-design` — it's fork-only (see r7 §3) — and is out of scope entirely,
not just deferred.

**Source of truth for OD's real current structure**: read
`/Users/la/Desktop/Programming/OSS-Repos/open-design` (a full clone, both
`origin=nexu-io/open-design` and `fork=leonaburime-ucla/open-design` remotes) — not
this repo's `foundry/integrations/open-design/reference/**`, which is a frozen 2026-07-16
extraction-time snapshot (see the caveat in `foundry/integrations/open-design/README.md`).
`AI-Dev-Shop/integrations/graphify/` and `AI-Dev-Shop/integrations/codebase-memory-mcp/`
both already have that clone indexed/graphed — query those before re-deriving
structure from scratch.

## 5. Consumers

External repos consuming packed/published `@jini/*`: OD, Open-Marketing, Tovu-Runner, Zana (aspirational). NO consumer-shaped folders in the engine. In-repo, only `examples/minimal-host/` (imports ONLY `@jini/*`; the neutrality lint target + CI smoke).

## 6. Automation (separate repo)

AI-Dev-Shop (pipeline defs — HOW) + ADS-memory (durable decisions/knowledge) + project-runner (execution runtime: queue/lease/sandbox — WHICH/WHO/WHAT). One canonical job state machine. Consumed by Jini and every consumer alike; never inside the engine. (Verified: ADS-memory today is aspirational/duplicated — reconcile, don't adopt-as-is.)

## 7. Neutrality guardrails (CI, mechanical — not prose)

- **Strict token ownership** lint: kernel exports only kernel-service tokens; feature tokens live in feature packages; no ambient resolver.
- `minimal-host` **packed-tarball boot** = required check (boots + runs + tool-call with zero product concepts).
- **OD-noun / import lint** + `no-explicit-any` on every `@jini/*` public surface.
- **API-snapshot** diff requiring explicit review to change a public surface.
- **OD patch canary** (section 4.3).
- **Two-consumer rule**: a new kernel service / protocol event family / provider kind needs two real consumers OR an `@experimental` tag that blocks semver-stable release.

## 8. First 10 extraction tasks

Two standing gates on every task — **N**: `examples/minimal-host` installs only packed `@jini/*` tarballs, OD-noun/import ban; **O**: the OD patch canary dry-runs and rejects unclassified touched paths.

**Verified status as of 2026-07-17** (ground truth from real `packages/*/src` +
`source-map.md` content, not from this list's own prose, which had drifted stale —
see `ADS-memory/reports/jini-port/refactor-roadmap.md` for the fuller tracker): task 1 is
**red-spec only** (`foundry/integrations/open-design/sync-ownership.test.ts` +
`ADS-memory/reports/jini-port/milestone-1-red-spec.md` pin the target; `sync-ownership.manifest.json`
and `scripts/patch-canary.ts` don't exist yet — this is the actual next unblocked
step). Tasks 2–4 (protocol/core/platform+sidecar) have real work landed, not tracked
against this ledger. Task 5 (`@jini/daemon`) has real partial content (10 files +
`source-map.md`, RunLifecycle/EventLog/close-status) — not "not started." Task 7
(`@jini/agent-runtime`) has real content (365 ported craft/skills files) but zero
TypeScript runtime/registry code — the instance registry itself is still greenfield.
Tasks 6, 8, 9 (`ToolExecutor`, `@jini/sqlite`, `@jini/http`+`@jini/cli`) are genuinely
untouched — `sqlite`/`http`/`cli`/`node-host`/`chat-react`/`renderers-react` are all
single-line placeholder files. Task 10 is untouched and, per §4's scope note above,
should stay scoped to `apps/daemon` only when it's eventually picked up.

1. **Harnesses + sync-ownership manifest.** N health-boot from tarballs; a known upstream daemon patch applies via the path transform.
2. **`@jini/protocol`** — run events/errors/cursors/cancellation/idempotency, seeded from `packages/contracts` with OD nouns stripped. Gate: fixture compiles without OD contracts; no sync-owned OD path changed.
3. **Typed tokens + bindings + resolver + startup diagnostics** in `@jini/core`. Gate: tests prove missing/duplicate/version errors are legible; patch canary green.
4. **`@jini/platform` + `@jini/sidecar`** verbatim, path-mirrored + patch-router. Gate: packed build; a real historical `packages/platform` patch routes cleanly.
5. **RunLifecycle + replayable EventLog** (`@jini/daemon`), runs keyed on `contextRef`. Gate: minimal-host start/stream/cancel/resume a fake run; OD characterization tests emit the same ordered event sequence; identifier lint proves no project/conversation noun.
6. **ToolExecutor boundary.** Gate: minimal-host one allowed + one denied tool call, resumable confirmation, timeout, cancellation, output truncation, audit record — no HTTP involved.
7. **`@jini/agent-runtime`** with instance registry (built-ins generated; external agent packs). Gate: minimal-host drives OD's `mocks/` replay CLIs end-to-end; a historical `runtimes/defs/*` patch re-targets via the router; delegated-path security patches update both OD mapping and Jini.
8. **Store ports + `@jini/sqlite`.** Gate: minimal-host survives restart + cursor replay; a Postgres *stub* compiles against the async ports; conformance suite has no OD schema nouns.
9. **Runs + chat app-services (no HTTP yet), then `@jini/http` + `@jini/cli`.** Gate: same fixture run works via HTTP and CLI `--json --prompt-file`; adding a command pack needs no central `SUBCOMMAND_MAP` edit.
10. **`foundry/integrations/open-design/daemon/` adapter behind the facade + external-consumption proof** (corrected path — see §4). Gate: OD boots green; OD/Open-Marketing/Tovu consume packed tarballs; a representative upstream security patch applies and tests the RUNNING impl (not a dead copy). This canary stays in CI permanently. **Scope: `apps/daemon` only** (see §4 and §12 C7) — `desktop`/`packaged`/`telemetry-worker` are not part of this task.

## 9. The 2-year rot vector + guardrail

Rot: typed tokens become a renamed `ServerContext` — every OD convenience gets promoted to a global kernel token until all packs can resolve everything, and the neutral boundary collapses (round-1's original finding, reborn). Guardrail: strict token ownership + the section-7 CI gates + "a new kernel token requires a kernel invariant, not merely a need discovered by the first consumer."

## 10. Roadmap appendix — bolt.diy feature wishlist (NOT architecture)

Features to add later as `ProviderRegistry`/`ToolRegistry` entries or small modules; they do not shape the kernel:
- `@jini/deploy` — Netlify / Vercel / GitHub Pages deploy targets (multi-bound `DeployTarget` token; `deploy.publish` is a Tool).
- code-exec / live dev-server preview — a provider + preview-URL contract (impl later; desktop = local Node/Docker, not WebContainer).
- terminal / PTY provider.
- diff-review + edit-lock — tool-execution-boundary UI helpers.

## 11. Decisions log

- A over B (fixed-ports) and over microkernel/thin-protocol — robustness (boundaries/extensibility/evolvability) with OD-sync preserved via the adapter.
- Typed tokens over structural union — verified failure mode in OD's `ServerContext`.
- OD ejected to its own repo; `@jini/*` published; consumers external.
- Automation in its own repo.
- bolt.diy = wishlist, not template. Zana = aspirational, not authoritative (early-stage).

---

## 12. Whole-system corrections (holistic pass — kernel unchanged)

Four independent reviewers (codex, agy, Fable, Opus) reviewed the *whole system* for seams between subsystems. The kernel/composition/OD-sync core is unchanged; these correct everything around it. `[V]` = verified in a real repo.

### C1 — Durable EventLog must be a KERNEL port (the neutrality leak)
`[V]` OD's event durability is three tiers: a **~2000-event in-memory ring**, a durable copy persisted **into the product's assistant-message row (`events_json`)**, and best-effort JSONL. Replay past the ring goes through the **product conversation store** (`GET /api/workspace/conversations/:cid/messages`). So durable replay physically straddles kernel↔product, and the locked plan put the durable half *outside* the kernel. A faithful non-OD consumer wiring only the kernel EventLog silently **loses in-flight output on a long-run reload** → re-implements OD's conversation persistence (tilt) or forks. **Fix:** the durable EventLog store is a kernel port. No kernel review catches this because each side is individually correct — they fail only together. This is the #1 neutrality risk.

### C2 — One canonical event envelope + `chat-core` client contract
Define in `@jini/protocol` a single envelope: `{ runId, eventId, opaqueCursor, protocolVersion, ts, kind, payload, durability }`. Rules: **the cursor references only committed, replayable events**; ephemeral previews (partial tool-input deltas) are a separate explicitly-non-replayable channel or must be durably recorded; **delivery is at-least-once and the client reducer deduplicates**; on reconnect exhaustion the client reconciles with `getRun`. `[V]` No idempotency dedup exists today (`clientRequestId` is threaded but never used) — it must be **built and conformance-tested**, not lifted. `[V]` The native `ChatSseEvent` is OD-shaped and `/agui` is a *lossy* projection that silently drops unknown events — AG-UI must declare its lossy mapping and project the canonical stream, never originate a second lifecycle. **Split the `agui-adapter`'s two event families**: the run/chat family → `@jini/protocol`; the pipeline/genui family → automation/plugin surface, must NOT enter the kernel.

### C3 — `chat-core` is the reusable center, not `chat-react`
`[V]` Tovu ships a **Vue** shell; React is not universal. Put the framework-free `ChatController` (transport, event reduction, cursor persistence, dedup, reconnect policy, cancellation state, message projection, delta aggregation) in `@jini/chat-core`; `@jini/chat-react` becomes a thin `useSyncExternalStore` binding + slots. **Transport is injectable** or every consumer inherits OD's `/api/runs` shape. Export small controllers (session/composer/transcript/run-status/confirmation/attachment), NOT a product-like `ChatPane`. React/ReactDOM as peer deps with a tested range. `renderers-react` treats srcDoc as hostile (strict CSP, isolated origin, no ambient bridge). Add a transport conformance suite (replay-after-restart, duplicate frames, cursor expiration, dropped connections, detach-without-cancel, explicit cancel, terminal reconciliation, unknown events, token floods).

### C4 — Packaging model is already broken; fix it before external consumers
`[V]` `@open-design/components` has a `development: ./src/index.ts` export whose file isn't in `files` — Next transpiles workspace **source**; this fails from a real tarball. All packages are `private:true`; consumers use different bundlers (OD Next 16, OM Vite, Tovu Vite 6 + Next + Vue). **Fix:** publish compiled ESM + `.d.ts` + compiled/extractable CSS only; no source `development` export; peer-dep React; provide a **local-registry / yalc / verdaccio packed-package dev loop** (never `pnpm link` to source as the contract). The packed-tarball boot is the CI neutrality gate; the local-registry loop is daily dev.

### C5 — Vocabulary firewall (three domains, same four words)
`[V]` OD "agent" = `RuntimeAgentDef` (a subprocess adapter); AI-Dev-Shop "agent" = a markdown persona; they **cannot share a registry**. Canary: `canceled` (1 L) in OD run status vs `cancelled` (2 L) in `contracts/tasks.ts` — same package, today. **Fix:** engine owns `{Run, Agent=coding-CLI, Tool=end-user-callable}`; automation owns `{PipelineRun, WorkItem, JobAttempt, Worker, Persona, MethodDefinition}`; use `engineRunId` when a Jini id crosses the boundary. **One deliberate reuse:** project-runner consumes `@jini/agent-runtime` only as a **pinned, published leaf subprocess/stream library** — never reuses `RunLifecycle`/`ToolRegistry`/event schemas for its scheduler.

### C6 — Automation: strict dependency direction; `project-runner` is the one thing to build
`[V]` `project-runner` **does not exist in any repo**; AI-Dev-Shop already has a canonical 9-state job machine; ADS-memory is a per-project markdown workspace (a rename of `ADS-project-knowledge`), and the three AI-Dev-Shop clones have **already diverged**. **Fix:** direction = AI-Dev-Shop (declarative pipeline/personas/gates = HOW) → project-runner (interprets them; owns jobs/leases/attempts/sandbox/checkpoints = executable truth) → ADS-memory (durable decisions/evidence/immutable summaries; NOT live scheduler state). **Adopt** AI-Dev-Shop's existing state machine; render its markdown lifecycle *from* the runner's compact states (`queued→leased/running→succeeded` + retry/waiting_for_human/failed/cancelled + lease expiry). Convert the §8 ten milestones into a **hashed project-runner DAG** (keyed to this plan's hash); each milestone → red-spec/impl/package-contract/tarball/consumer-canary/evidence tasks; runner state authoritative, `tasks.md`/`pipeline-state.md` become generated views. **Bootstrap minimal:** local SQLite runner, one worker, filesystem sandbox, manual approval — do NOT block extraction on a distributed scheduler. Canonicalize ONE AI-Dev-Shop (published/pinned); the in-repo copy is an init template only.

### C7 — Desktop / sidecar / RenderService
`[V]` OD `apps/desktop` ≈ 13.5k real hand-written lines (incl. a 3.5k updater + Chromium PDF/deck capture; re-verified 2026-07-17 — a naive `find` reports 86.7k, 6.4x inflated by one vendored `dom-to-pptx` bundle + duplicate compiled `dist/` output, see `ADS-memory/reports/jini-port/recon/r7-od-real-backend-architecture.md` §1–2) — do not generalize now; `desktop-host` deferral is clean **only if every `@jini/*` stays Electron-free** and consumers own windows/updater/installer/dialogs. `apps/packaged` is a separate, smaller surface (~7.3k real lines, no vendor bloat) this estimate didn't originally cover — same "don't generalize now" caution applies, just for a different reason (small, not complex). `[V]` `@jini/sidecar` is extractable but its IPC handler accepts `any` and OD's protocol includes `eval`/click/screenshot/export/update — Jini needs a **typed codec/dispatcher with host-supplied schemas + authenticated capability negotiation**; `eval`/inspect = a dev-only host extension, not the default protocol. **`RenderService`** is a **capability contract defined early** (daemon export routes already depend on it — `[V]` PDF/deck delegate to Electron over sidecar, and a *second* path uses daemon-side puppeteer) but it is a **provider bound via the registry, not a kernel service**: shape it as `renderToPdf(html)→bytes` / `capture(html)→png` + viewport/timeout/abort/resource-policy; Electron / headless-Chromium / Tauri are adapters. Tauri spike is narrow: sidecar launch/discovery, URL load, shutdown, crash recovery, single-instance, open-path/open-external — NOT updaters/deck/parity.

### C8 — Cross-cutting: versioning, observability, security
- **Versioning:** lockstep all ~14 packages through the unstable period; anchor semver meaning on `@jini/protocol` + `@jini/core`; publish one tested release *set* + a machine-readable compatibility manifest; split independent versioning only after protocol stability.
- **Observability:** propagate W3C trace context across HTTP/sidecar/subprocess; link `PipelineRun`/`JobAttempt` ↔ `engineRunId` via trace links only; derive spans/metrics from `EventSink` (no product telemetry in the kernel); signals include time-to-first-event, replay lag, reconnects, cancel latency, tool authz, subprocess exit, token/cost, event-log failures, package + consumer versions; opt-in, redacted, locally inspectable.
- **Security:** typed registration + `ToolExecutor` do NOT make imported pack code safe — an in-process third-party pack executes at init and bypasses the tool gate. Built-ins in-process OK; **third-party packs need signature verification + explicit capabilities + out-of-process sandbox**. Credentials = scoped handles/allowlisted env, not wholesale inheritance. Agent subprocesses: sanitized env, controlled cwd, process-group cleanup, resource limits. Sidecar: auth + replay protection. `[V]` Note: the `ToolExecutor` gate is a **new invariant being built** — OD only *observes* `tool_use`, it doesn't gate — so the task-6 conformance suite is where it earns its keep.

### C9 — Sequencing: ship the headless engine first
The engine is fully valuable **headless** (`[V]` Tovu-Runner, and independently bolt.diy, embed a daemon and build their own UI; "agent-ready" = CLI/HTTP/MCP, not React). So `@jini/chat-core` comes before `@jini/chat-react`, and the Vite shell migration, `chat-react`, renderer hardening, and the Tauri spike are **post-daemon milestones** — do not block the engine behind the (large, mostly-independent) frontend work.

### The single biggest non-kernel risk
**Cross-repository compatibility drift hidden by package-local green tests.** Jini can have an excellent kernel while released tarballs, SSE replay, React resolution, consumer shells, automation ledgers, and desktop sidecars silently disagree — every package tests green in isolation. **Guardrail (required CI):** an executable **release-set matrix** that builds once, installs the *real packed tarballs* into `minimal-host` + pinned external consumer fixtures (OD/OM/Tovu) with **no workspace links**, and exercises `create → stream → reconnect → cancel → restart/replay` end-to-end, plus API snapshots, export-map validation, and duplicate-React detection. (Runner-up risk: the automation vacuum — `project-runner` doesn't exist yet, so prove the extraction loop manually on packages 1–3 before automating.)
