Reading prompt from stdin...
OpenAI Codex v0.144.3
--------
workdir: /Users/la/Desktop/Programming/OSS-Repos/open-design
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: none
session id: 019f6bd2-0d43-7671-8636-25d46d2ce45a
--------
user
You are Seat 1 (codex / gpt-5.6-sol high). Wherever the packet says {{SEAT_LABEL}}, it means Seat 1.

# Jini Architecture — Round 2 (Adversarial)

Round 1 is frozen. You now see all four independent first-round answers. This round is adversarial: your job is to stress-test the group toward the single best architecture, not to be polite.

## FIRST: read these files

Binding new constraint from the user (overrides any round-1 assumption):
- `/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round2-constraint.md`

The four frozen round-1 submissions:
- Seat 1 (codex / gpt-5.6-sol high): `…/jini-debate/round1/seat1-codex-clean.md`
- Seat 2 (agy / Gemini 3.1 Pro High): `…/jini-debate/round1/seat2-agy-clean.md`
- Seat 3 (Claude Fable 5): `…/jini-debate/round1/seat3-fable.md`
- Seat 4 (Opus 4.8): `…/jini-debate/round1/seat4-opus.md`

(Full directory: `/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/`)

Verified repo facts (confirmed by the coordinator, treat as ground truth): Jini is a full OD copy on branch `integrated` — the author's most-decomposed daemon trunk (server.ts 2,631 lines vs 8,635 on the OD checkout; a `server/` folder with bootstrap/core/events/marketplace/runtime-env; per-agent `runtimes/defs/`). Jini's `apps/web/src` is a broken symlink to `/Users/la/Desktop/Programming/Tovu/web/src`; the real tree is in `src.orig/`. Sibling dirs `Tovu` and `Tovu-Runner` exist. OD is Apache-2.0. Jini `.git` is 481MB. Jini's git remotes still point at OD. The user has confirmed: **Jini must be a general-purpose engine for many future projects with NO OD tilt; OD and Tovu are just consumers; OD product specifics live under `foundry/integrations/open-design/`.**

## YOUR SEAT

You are **{{SEAT_LABEL}}**. Defend your own round-1 answer where it still holds; abandon it where the constraint or a rival's argument defeats it. Intellectual honesty scores higher than consistency.

## Produce exactly these sections (be concise and decisive — no re-derivation of your whole round-1 answer)

1. **Re-evaluation under the binding constraint** — In 3-5 sentences: does the no-OD-tilt / many-consumers constraint change your round-1 recommendation? Keep it, amend it, or switch — and say precisely what changes.

2. **Attacks** — For EACH of the other three seats, name the **two weakest or most dangerous claims** and explain why each fails (correctness, hidden OD coupling, cost, operational risk, or violating the constraint). Be specific; cite the claim. Six attacks total.

3. **Defense** — Anticipate the strongest attacks on YOUR answer and rebut them, or concede if they land.

4. **Concessions** — List every point from a rival that is genuinely better than yours and that you now adopt.

5. **The unresolved question** — State the single biggest disagreement that remains across the group and what evidence would settle it.

6. **Your revised recommendation** — Your final, updated position after this round: the repo strategy, the top-level tree, and the ordered first 5 tasks. This supersedes your round-1 answer.

Keep it tight — target 1,200-2,000 words. This is cross-examination, not a second essay. Read-only: do not edit files or run git writes.

codex
I’ll read the binding constraint and all four frozen submissions, then cross-examine them against the verified facts. I’ll keep this strictly read-only and return only the six requested sections.
exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round2-constraint.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round2-constraint.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
      14 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round2-constraint.md
# Round 2 — Binding constraint added by the user (applies to ALL seats)

The user has clarified the single most important requirement, and it overrides any round-1 assumption to the contrary:

**Jini is a GENERAL-PURPOSE reusable engine intended for MANY future projects — not for Open Design, and not for "Open Design + Tovu" specifically. The engine core must have NO Open Design tilt.**

Concretely:

1. **No OD tilt in the core.** Nothing Open-Design-specific may live in the engine packages. The core is designed to be adopted by arbitrary future products that are not yet known.
2. **Open Design is just the first consumer.** All OD-specific behavior — design systems, brands, design templates, figma, deploy, critique, marketplace, media pipeline, OD analytics, OD route shapes, OD data-root semantics — lives under `foundry/integrations/open-design/` (adapter + product data), NOT in the engine.
3. **Tovu (and any other current app) is another consumer, not a co-designer of the core.** Do NOT shape the core around the specific needs of OD or Tovu. The "two-consumer rule" is fine as an anti-over-abstraction check, but the target is genuine multi-project reusability, not a bespoke OD/Tovu shared core.
4. **This re-weights the evaluation.** Reusability and boundary-clarity (a second, third, Nth unrelated product can adopt the engine without importing product assumptions) now dominate. Any recommendation that gets the engine "born inside" the OD monorepo, or that treats OD product structure as the engine's natural shape, is disfavored unless it can show the core stays product-agnostic.

Every seat must now RE-EVALUATE its round-1 recommendation under this constraint: keep it, amend it, or change strategy — and say explicitly what changes and why.

exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     757 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md
# Seat 1 — codex / gpt-5.6-sol (reasoning=high) — Blind First-Round Submission

# Executive Recommendation

Choose a **package-first strangler extraction**: keep current upstream Open Design as the behavioral authority, build Jini as a clean publishable-package monorepo, and transfer one contract-tested capability at a time. Do not use the copied Open Design tree currently in Jini as the engine foundation: it still has Open Design remotes and package identities, contains extensive product content, and its active `apps/web/src` is a broken symlink to another repository. A greenfield rewrite would discard hard-won runtime behavior; copy-then-refactor would preserve every hidden product coupling; subtree/federation would make ownership and releases ambiguous. The strangler approach gives early value, preserves rollback paths, and makes each capability have exactly one owner after cutover.

## Verified Repository Evidence

- Open Design is at commit `f65eea0343014bd8dad179dd4701c5eb02e18df4` on `refactor/web-memory-slice`. Against the locally available `origin/main`, it is 36 commits ahead and 52 behind; it is one commit behind the fork branch.
- Open Design has untracked `ADS-project-knowledge/`, `apps/web/coverage/`, and the porting-plan document. It also has one stash from `refactor/web-chat-composer-slice`.
- Jini is at commit `478a85577aff5aff6d98e3aed8214fafc5003af5` on `integrated`; both remotes still point to Open Design. Its web source is represented as hundreds of deletions plus `apps/web/src -> /Users/la/Desktop/Programming/Tovu/web/src`, currently a broken symlink, and `apps/web/src.orig/`.
- Open Design’s working checkout is about 5.5 GB, including a 1.6 GB `.git`. A normal vendored copy is therefore unsuitable, even though a clean partial clone would be much smaller.
- The current composition roots remain exceptionally large and untyped: [server.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server.ts:1) is 8,635 lines and begins with `@ts-nocheck`; [cli.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/cli.ts) is 10,071 lines. `ChatPane`, `ChatComposer`, and `App` are 4,342, 5,608, and 2,677 lines respectively.
- Good seams already exist: [server-context.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/server-context.ts), domain route registrars, [runtime definitions](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/defs), pure contracts, `platform`, `sidecar`, and `components`.
- The runtime system already models discovery, auth probing, model listing, prompt transports, native resume, ACP resume, MCP injection, and stream parsing in [runtimes/types.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/types.ts). This is the strongest initial extraction seam.
- The current run service remains process-memory-first with optional JSONL event logs and a 30-minute default TTL; see [runtimes/runs.ts](/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/daemon/src/runtimes/runs.ts:1). Jini needs a durable event store rather than copying that lifecycle unchanged.
- The memory vertical-slice ADR and implementation are useful evidence, but not a universal template. See [ADR 0002](/Users/la/Desktop/Programming/OSS-Repos/open-design/docs/adr/0002-frontend-vertical-slice-decomposition.md) and `apps/web/src/features/memory/`.
- Codebase reports are not currently cloud-ready: CodeGraph databases are local ignored SQLite files of about 157 MB and 587 MB; Understand Anything has only intermediate scan/batch data, without a final `knowledge-graph.json` or `meta.json`; the Codebase Memory MCP entry for this checkout reports zero nodes and no root path.

# Controlling Questions — Direct Answers

**Jini repository strategy.** Use one Jini monorepo containing publishable packages, reference applications, the project runner, and the Open Design compatibility metadata. Open Design stays in its own repository. Do not retain a full reference checkout in Git; recreate an ignored sparse/partial clone on demand from a pinned source manifest. Preserve the current dirty Jini state before establishing a clean engine branch.

**Daemon architecture and portability.** The current daemon is not directly portable: it combines agent execution, conversations, runs, projects, skills, design systems, plugins, media, memory, telemetry, static serving, filesystem policy, and Open Design routes. Jini should make an embeddable application core primary, then expose HTTP, CLI, and sidecar adapters. Product behavior enters through typed ports at a composition root.

**Frontend architecture and reusable UI.** Extract a headless chat/artifact model first, followed by React components driven by transports and slots. Do not export `ChatPane` or `ChatComposer` wholesale. Jini packages must not depend on Next.js, Open Design projects, daemon URLs, analytics, design systems, plugins, or global CSS.

**Automation and cloud execution.** Use the repo-local `project-runner` as a pull-based state machine, with Codex and Claude as the initial execution backends. CI validates changes but does not own planning or leases. Tasks are claimed atomically, run in isolated branches/worktrees, and handed off through durable attempt records.

**Durable task/session ledger.** Commit task definitions, dependencies, decisions, validation specifications, final results, and concise handoffs. Keep lease tokens, credentials, raw model transcripts, local worktree paths, verbose logs, and temporary indexes ephemeral. Use atomic remote Git refs for cross-machine leases and local file locks when offline.

**Codebase-understanding reports.** Commit small, source-stamped architecture summaries, symbol indexes, seam maps, hotspot reports, and manifests. Store full SQLite/embedding databases locally or in object storage. A freshness check must reject reports whose source commit differs from the task’s required commit.

**AI-Dev-Shop and governance.** Keep `AI-Dev-Shop/` top-level as a pinned vendored subtree/snapshot with provenance. It defines roles, approval gates, specs, and review policy. `project-runner/` owns execution state, leasing, validation, and resumability. They must not maintain competing task lists.

**Reference repository size and provenance.** Do not commit `references/open-design/`, use a submodule, or copy the tree. Commit an upstream lock and source map; let the runner create an ignored sparse partial clone. Preserve authorship with history-aware patch transfer and record the original repository, commit, path, license, and modification notice.

**Compatibility, releases, and operations.** Version schemas and adapter interfaces independently with SemVer, runtime validation, negotiated protocol versions, conformance suites, golden mock traces, canary releases, and exact dependency pins during adoption. Every cutover retains a legacy switch until parity and recovery criteria pass.

**Cost and model use.** Prefer deterministic analysis first, then small/mini models for bounded summaries and mechanical transformations. Use strong reasoning models for boundary decisions, security reviews, migrations, parser/resume semantics, and final compatibility judgment. Refresh expensive graphs only when source structure changes materially.

# Proposed Repository Topology

```text
Jini/
├── .github/
├── AGENTS.md
├── LICENSE
├── NOTICE
├── package.json
├── pnpm-workspace.yaml
├── AI-Dev-Shop/                    # pinned vendored subtree/snapshot
├── ADS-project-knowledge/          # specs, ADRs, approvals, retained reports
├── project-runner/
│   ├── package.json
│   ├── config.yaml
│   ├── schemas/
│   ├── src/
│   │   ├── ledger/
│   │   ├── leases/
│   │   ├── sessions/
│   │   ├── git/
│   │   ├── context/
│   │   ├── runners/
│   │   └── validation/
│   ├── ledger/
│   │   ├── tasks/
│   │   ├── sessions/
│   │   └── compatibility/
│   └── tests/
├── packages/
│   ├── protocol/
│   ├── engine/
│   ├── runtime/
│   ├── runtime-node/
│   ├── persistence-sqlite/
│   ├── platform-node/
│   ├── daemon-node/
│   ├── client/
│   ├── cli/
│   ├── artifacts/
│   ├── chat-react/
│   └── sidecar/
├── integrations/
│   └── open-design/
│       ├── README.md
│       ├── upstream.lock.yaml
│       ├── ownership.yaml
│       ├── source-map.yaml
│       ├── compatibility/
│       └── migration-notes/
├── apps/
│   ├── reference-daemon/
│   └── reference-web/
├── examples/
│   ├── minimal-node/
│   └── minimal-react/
├── context/
│   ├── index.yaml
│   ├── current/
│   └── snapshots/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── migration/
│   ├── security/
│   └── releases/
└── tools/
    ├── context-export/
    ├── provenance/
    └── compatibility/
```

There should be no committed Open Design checkout inside this tree.

# Package and Module Boundaries

| Package | Responsibility and public API | Dependencies allowed | Dependencies forbidden | First consumer |
|---|---|---|---|---|
| `@jini/protocol` | Versioned DTOs, JSON Schemas, `RunEventV1`, errors, runtime descriptors | TypeScript, schema validator | Node, React, Express, SQLite, product types | All packages |
| `@jini/engine` | `JiniEngine`, run/conversation services, ports, lifecycle policy | `protocol` | Express, subprocess APIs, concrete stores, product prompts | Reference daemon |
| `@jini/runtime` | `RuntimeAdapterV1`, registry, normalized event model, capability negotiation | `protocol` | Node process APIs, product routes | `runtime-node` |
| `@jini/runtime-node` | CLI discovery, invocation, built-in runtime adapters, parser wiring | `runtime`, `platform-node` | Open Design data/project/plugin modules | Reference daemon |
| `@jini/persistence-sqlite` | Durable conversation, run, event, session-handle stores | `engine`, `protocol`, SQLite | HTTP, UI, runtime-specific behavior | Reference daemon |
| `@jini/platform-node` | Filesystem, subprocess, environment, path, process-control primitives | Node standard library | Product identifiers and route contracts | `runtime-node` |
| `@jini/daemon-node` | Composition helper and versioned HTTP/SSE transport | `engine`, stores, runtime, protocol | Product routes and UI | Reference daemon, OD |
| `@jini/client` | `JiniClient`, transport interface, HTTP implementation | `protocol` | React, Next.js, filesystem | Reference web |
| `@jini/cli` | Machine-readable client commands and embeddable CLI dispatcher | `client`, `protocol` | Product command trees | Reference app |
| `@jini/artifacts` | Artifact parser, manifests, headless renderer registry, question-form model | `protocol` where needed | React, iframe policy, OD file URLs | Reference web |
| `@jini/chat-react` | Provider, hooks, message list, composer primitives, slots, CSS variables | React peer, `client`, `artifacts`, `protocol` | Next.js, OD state/providers, analytics | Reference web |
| `@jini/sidecar` | Product-neutral bootstrap, IPC, runtime descriptors and shutdown | `platform-node`, `protocol` | Fixed app names, channel names, OD paths | Reference daemon |

A package is not created merely to hold one helper. These packages correspond to different runtime environments, security boundaries, or release contracts.

# Daemon Core and Adapter Design

The primary API is the embeddable library:

```text
Open Design composition root
  ├── OpenDesignProjectPort
  ├── OpenDesignPromptAugmenter
  ├── OpenDesignArtifactPolicy
  ├── OpenDesignCredentialPolicy
  └── OpenDesignTelemetrySink
           ↓
       JiniEngine
  ├── RunCoordinator
  ├── ConversationService
  ├── RuntimeRegistry
  ├── ArtifactService
  └── DurableEventStore
           ↓
  Node / SQLite / HTTP / sidecar adapters
```

Core ports should include:

- `RunStore`, `RunEventStore`, `ConversationStore`, `RuntimeSessionStore`
- `WorkspacePort` and `WorkspaceAuthorizationPolicy`
- `ArtifactStore` and `ArtifactPolicy`
- `ProcessLauncher`, `Clock`, `IdGenerator`, `CredentialStore`
- `PromptAugmenter`, `ContextProvider`, `TelemetrySink`
- `RuntimeRegistry` and `RuntimeAdapterResolver`

The daemon should expose all four requested forms:

- Embeddable library: authoritative application API.
- HTTP/SSE: versioned `/v1/*` transport over the same services.
- CLI: normally an HTTP client; an explicit embedded mode can be added later.
- Sidecar: discovery, bootstrap, health, shutdown, and runtime descriptor.

Default network binding should be `127.0.0.1:0`, with the actual port written to a protected runtime descriptor. Explicit `--host` and `--port` remain available. Ports must never influence persistent path identity.

Open Design product routes—brands, design systems, marketplace, memory, media, critique, deployment, updater behavior—mount beside Jini’s routes at the Open Design composition root.

The old rewrite branches are evidence, not merge candidates:

- `arch/chat-run-extraction` contains useful SSE characterization commits `75fd4afa4` and `780917104`. Port the tests and dependency inventory.
- Its `510a243e6` extraction still moves about 3,400 untyped lines behind `deps: any`; do not adopt it as the Jini runtime.
- `arch/server-startserver-endgame` at `f1aabe9e5` identifies useful seams such as SSE, request guards, prompt composition, telemetry, and chat request composition. It is 258 locally known upstream commits behind `origin/main`, so reimplement the seams against current source.
- The older `fork/refactor/daemon-server-*`, `fork/server-ts`, and project-route branches are even more divergent. Do not merge them wholesale.
- Current upstream route registrars, `ServerContext`, runtime definitions, parser modules, and mock traces are the correct starting evidence.

# Agent and CLI Discovery Design

`RuntimeAdapterV1` should preserve differences rather than collapse them:

```ts
interface RuntimeAdapterV1 {
  manifest: RuntimeManifestV1;
  discover(ctx: DiscoveryContext): Promise<InstallationCandidate[]>;
  probe(candidate: InstallationCandidate): Promise<RuntimeInstallation>;
  listModels?(installation: RuntimeInstallation): Promise<ModelCatalog>;
  prepareRun(input: PrepareRunInput): Promise<PreparedInvocation>;
  parse(streams: InvocationStreams): AsyncIterable<RunEventV1>;
  cancel(controller: InvocationController): Promise<void>;
  sendInput?(controller: InvocationController, input: MidTurnInput): Promise<void>;
  resume?(input: ResumeInput): Promise<PreparedInvocation>;
}
```

Capability fields should be discriminated values, not unrelated booleans:

```text
prompt: argv | stdin-text | stdin-jsonl | file
events: plain | jsonl | claude-stream | acp-json-rpc
resume: none | specified-id | captured-id | acp-load
midTurnInput: none | jsonl
models: static | command | remote
mcp: none | config-file | env-content | acp-merge
cancellation: signal | process-group | protocol
```

Source of truth:

- Adapter manifests in package code define supported behavior.
- A persisted detection snapshot reports what is actually installed.
- A launch always revalidates the selected executable and workspace policy.

Suggested SQLite record:

```text
runtime_installation(
  adapter_id, installation_id, canonical_path, path_fingerprint,
  version, auth_status, capabilities_json, models_json, models_source,
  config_hash, detected_at, expires_at, last_error_code
)
```

Refresh policy:

- Asynchronous scan at daemon startup.
- User/CLI-triggered refresh through the same `/v1/runtimes/refresh` API.
- Invalidate on PATH/configured-binary/config-hash changes.
- Five-minute availability/auth freshness; longer model-catalog freshness where probing is costly.
- Persisted results may render immediately as `stale: true`, but cannot authorize a spawn.

Security:

- Canonicalize paths and verify executable permissions.
- Never accept an unvalidated executable path from browser payloads.
- Keep credential values server-side and return only status.
- Redact environment, argv secrets, and native session handles from logs.
- Bind all UI and CLI consumers to the same runtime registry API.

# Frontend Feature-Slice and Reusable UI Design

Use three layers:

1. `@jini/artifacts`: pure artifact parsing, manifests, question forms, and renderer selection.
2. Headless chat state inside `@jini/chat-react`: reducer/controllers usable through hooks.
3. Presentational React components with explicit slots.

Core client contract:

```ts
interface ChatClient {
  createRun(input: CreateRunInput): Promise<RunHandle>;
  streamRun(runId: string, after?: number): AsyncIterable<RunEventV1>;

exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat3-fable.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat3-fable.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
      88 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat3-fable.md
# Seat 3 — Claude Fable 5 (`claude-fable-5`) — Blind First-Round Submission

## 1. Executive Recommendation

**Adopt strategy 2 executed with strategy 3's discipline: keep Jini as the existing full copy of Open Design and progressively invert it — but with a hard package-first rule (all new engine code lives in `packages/jini-*` behind machine-enforced import boundaries), an explicit deletion schedule for OD product content, and the in-tree OD apps demoted to "reference consumer" whose only job is to prove every extraction against real behavior.** Consistent with three verified facts: (1) Jini already *is* a copy — the `integrated` branch carrying the most-decomposed daemon in existence (server.ts 2,631 lines vs 8,635 on the OD checkout, 12 capability barrels, per-agent `runtimes/defs/`), work that exists nowhere upstream; (2) the user does not control upstream merge cadence — decomposition PRs are maintainer-gated, so strangler extraction *inside* upstream OD is structurally blocked; (3) a second consumer (Tovu) is already trying to mount the engine — the broken `apps/web/src → Tovu/web/src` symlink is direct evidence. Failure mode ("OD with renamed symbols") neutralized by: an import-boundary guard (same pattern as existing `check-web-slice-boundaries.ts`), an `examples/minimal-host` app that must run chat+artifacts+runtimes with zero `apps/`/`adapters/open-design/` imports, and phased deletion of OD product trees so the copy shrinks monotonically. Would change my mind: proof the user has commit rights on nexu-io/open-design.

## 2. Repository Topology
One repo, one pnpm monorepo, publishable packages, own GitHub repo, **git history preserved** (Apache-2.0 makes this clean; 481MB .git fine; cloud agents `--filter=blob:none`). Rename remotes `origin→od-upstream`, `fork→od-fork`; add new `origin`.
Key trees: `AI-Dev-Shop/` (vendored, top-level), `project-runner/`, `packages/{contracts,platform,sidecar,sidecar-proto,daemon-core,agent-runtimes,artifacts,chat-react,components}`, `adapters/open-design/{daemon,web,compat-tests,source-map.md}`, `apps/{daemon,web}` (reference consumers, shrink-only), `examples/minimal-host` (zero-OD-import proof), `mocks/` (kept — engine test infra), `reports/cloud-context/`, `references/` (gitignored, sparse-clone on demand).
Deleted (scheduled): design-templates/, design-systems/, story/, clipper/, figma-plugin/, charts/, marketing/landing, CHANGELOG/TRANSLATIONS/RELEASE-NOTES, src.orig after restore, Tovu symlink.

## 3. Package Boundaries
`@jini/contracts` (pure TS DTOs/SSE unions) → `@jini/platform` → `@jini/sidecar[-proto]` → `@jini/daemon-core` (HTTP kernel, run lifecycle, ports RunStore/ProjectStore/ArtifactStore/CredentialVault, `createJiniDaemon`) → `@jini/agent-runtimes` (RuntimeAgentDef registry, 25+ defs, stream parsers, capability flags, CLI discovery) → `@jini/artifacts` (headless parser/registry/question-form) → `@jini/chat-react` (headless hooks + presentational components + ChatRuntimeAdapter + slots) → `@jini/components`. `adapters/open-design` may import packages but packages may NEVER import apps/adapters (new `check-engine-boundaries.ts` in `pnpm guard`).

## 4. Daemon Core & Adapters
Ports: AgentRuntime, RunStore, ProjectProvider, ArtifactStore, EventSink, CredentialVault, SkillSource, DataRoot. Composition root `createJiniDaemon(config)`. Expose all four surfaces (they're layers of one thing: library = composition root, HTTP daemon = thin host, CLI = HTTP client per OD dual-track rule, sidecar already separate). Base Jini on the `integrated` trunk (server.ts already decomposed), NOT upstream main. OD-specific stays in adapter: design-systems, brands, deploy, figma, critique, marketplace, media, Langfuse.

## 5. Agent/CLI Discovery
Engine capability in `@jini/agent-runtimes`. SoT: daemon-owned `<RUNTIME_DATA_DIR>/agents/discovery.json` (never web, never committed). Full scan on start + lazy TTL 15min + `POST /api/agents/rescan` + ENOENT invalidation. Schema: `{id,binPath,version,authState,capabilities{promptInputFormat,midTurnInput,resume,streamEvents,models[]},discoveredAt,probeSource}`. Normalize via one event union in contracts + per-runtime capability flags + namespaced `ext:{[runtimeId]:…}` for richness (generic consumers ignore). New agent = new def+parser, zero switchboard edits.

## 6. Frontend
Headless hooks + presentational components + slot interfaces, shipped as packages, proven by reference app. Adapters: ChatRuntimeAdapter, ArtifactAdapter, ProjectContextAdapter (optional/nullable), slots for tool cards/attachments/artifact renderers/question-form/comments. Transport injected → usable outside Next.js. Sequence: restore src.orig→src + delete symlink → reconcile memory slice → harvest ChatPane/ChatComposer decomposition branches → characterization tests → extract @jini/artifacts → chat hooks behind ChatRuntimeAdapter → @jini/chat-react with slots → apps/web consumes → minimal-host zero-OD boot. Effort: 4–6 weeks (8–10 if harvest conflicts).

## 7. OD Integration
Upstream→Jini: `sync-od` fetches od-upstream/main into preserved history, triage report, agent cherry-picks, product-tree commits auto-skipped, weekly. Jini→OD: `backport` task type, red-spec-first PRs to fork. Anti-drift keystone: compat-tests + **mock replay parity** (same `mocks/` traces through OD daemon and Jini daemon-core, normalized streams diffed — covers 25+ runtimes). OD adopts @jini/artifacts first (smallest/purest). Jini AGENTS.md is a stale OD copy — Phase-0 rewrite mandatory.

## 8. Project Runner & Ledger
Repo-local TS, not CI. Division with AI-Dev-Shop: ADS governs *how* an agent works a task (role pipelines), project-runner governs *which* task/who-holds/what-happened; task record references `pipeline:"ads:refactor"`. Files (committed): `ledger/tasks/<id>.json` (one file per task, merge-friendly), `ledger/index.json` (generated, committed for cloud read speed), `sessions/<utc-ts>-<id>.md`, `decisions.md`, `blockers.md`; `leases/` gitignored flock. Schema: `{id,title,phase,status,dependsOn[],scope[],goal,allowedChanges[],forbiddenChanges[],validation[],sourceRepo,sourceRef,targetPaths[],pipeline,modelBudget,attempts[],lease,blockers[],decisionRefs[],handoff}`. States: draft→ready→claimed→in_progress→validating→done; +blocked→ready, +failed→ready|abandoned, +superseded. Terminal: done/abandoned/superseded. Lease model: distributed truth = git compare-and-swap (claim = write lease + push claim commit; rejected push = lost race); local = flock. TTL 4h, heartbeat 15min. Deterministic next-task = topo-sort deps → filter claimable → order by (phase,priority,id).

## 9. Cloud Workflow
next-task → claim (push CAS) → branch `task/<id>` (worktree local / partial clone cloud) → read task+last session+overview.md → execute under ADS pipeline → run task validation → write handoff → finish. Resume = re-read task+session (ledger is memory, not chat). Concurrency = lease CAS + disjoint scope globs. Human checkpoints: @jini/contracts shape changes, deletion executions, upstream-sync triage, license/NOTICE, forbiddenChanges requests. Autonomous: behavior-preserving green moves, backports w/ red spec, graph refresh, ledger hygiene. Compat protection: replay parity in every extraction task's validation. Executors: Claude Code primary, Codex cloud for mechanical; ledger agent-agnostic.

## 10. CBM/Graphify/UA Export
Committed `reports/cloud-context/`: MANIFEST.json (repo/branch/commit/generatedAt/tool/version stamps), overview.md (entry doc), architecture-map.md, seams.md, hotspots.md, daemon-symbols.md, web-symbols.md, graphify/summary.json (<5MB), understand-anything/graph.json (<5MB). Local/object-storage only: full indexes/DBs/dashboards. `refresh-context` regenerates, refuses dirty tree, stamps commit. Staleness: next-task compares MANIFEST distance to HEAD; >50 commits ⇒ warning + auto-enqueued refresh. No export exists today (stated, not fabricated); generating first = JIN-006.

## 11. Migration Phases (exit criteria / rollback)
0. Hygiene (restore src, new repo, rewrite AGENTS.md, NOTICE) → guard+typecheck+suites green → rollback tag `jini-baseline`.
1. Control plane (project-runner + ledger + first export + boundary guard) → next-task deterministic → delete project-runner/, zero product touched.
2. Contracts+artifacts (split @jini/contracts, extract @jini/artifacts) → boundary+characterization green → revert to phase-1 tag.
3. Daemon core (kernel+run lifecycle+agent-runtimes+discovery) → **mock replay parity** OD-vs-Jini → reference daemon re-inlines.
4. Chat UI (hooks+chat-react+adapters/web; minimal-host) → minimal-host zero-OD boot guard-enforced → per-package revert.
5. OD adoption+sync loop (publish, OD fork consumes artifacts, weekly sync) → OD fork green → OD pins previous commit.
6. Second consumer+shrink (Tovu adopts chat-react, deletion completes) → Tovu renders Jini chat → per-commit revertible.
Daemon extraction order: adopt trunk barrels → contracts split → http kernel/bootstrap → run lifecycle → runtime defs/parsers → CLI discovery → persistence ports around db.ts → artifact services → generic project/workspace (data-root to adapter) → skills loader generic (catalogue to adapter).

## 12. Testing/Compat
Contract = @jini/contracts (semver; additive minor, breaking major w/ deprecation ≥1 minor). Three detectors: contract snapshot tests, mock replay parity (25+ runtimes free), characterization suites. Reusability evidence = minimal-host (guard-enforced zero OD imports) + Tovu adoption = falsifiable "not renamed symbols" test.

## 13. Security/Recovery/Observability/Cost
Security: single-data-root discipline as core port, credentials in per-CLI homes/CredentialVault (never in registry/ledger), subprocess in agent-runtimes w/ stamp model. Recovery: crash→lease expiry→reclaim w/ supersession; malformed stream→parser fail-fast + trace captured as new fixture; partial migration→moves are import-relocations first so rollback = git revert at phase tag; upstream API change→replay parity red before users. Observability: sessions record attempts/outcomes/spend; `jini report` aggregates. Cost: strong models only for seam/contract/parser design + phase reviews; Sonnet-class for mechanical/graph/summarization; Haiku too inaccurate (repo history); re-audit only on real prior problem; graph refresh only >50-commit drift scoped to changed dirs.

## 14. Size/Provenance/License
No committed reference checkout — Jini's preserved git history IS the reference (upstream reachable via od-upstream); sync-od materializes gitignored sparse partial clone on demand. Submodule rejected (moving target, poor cloud ergonomics); subtree rejected (history already provides). Provenance: preserved history + adapters/open-design/source-map.md + Apache-2.0 LICENSE + NOTICE crediting nexu-io. 5.5GB is local artifacts; honest = .git 481MB, source tens of MB.

## 15. Not-Yet-Generic
design systems, templates, brands, marketplace, deploy, figma, critique/finalize, media, OD analytics, packaged desktop/updater, landing/story, 18-locale i18n, memory semantics. Rule: nothing adapter→core until TWO real consumers (Tovu = second vote). Two-consumer rule = anti-over-abstraction governor.

## 16. Effort/Critical Path
Phases 0–2: 1–2 wk; Phase 3: 3–5 wk; Phase 4: 4–6 wk (8–10 if branches don't harvest); Phases 5–6: 2–4 wk partly parallel. ~3–4 months elapsed, ~60–90 bounded tasks, human ~2–4h/wk. Critical path: restore → contracts split → daemon-core kernel → **replay parity harness (keystone)** → chat hooks → chat-react → minimal-host.

## 17. Why This Could Be Wrong
1. integrated trunk is a bad baseline (front-runs unmerged PRs; if upstream refactors differently, sync cost permanent). 2. Copy gravity wins (agents keep fixing OD instead of extracting). 3. Single-consumer abstraction (if Tovu stalls, seams speculative). 4. Replay parity over-promises (covers stream shapes, not fs/data-root side effects). 5. 52-behind gap compounds during phases 0–2.

## 18. Blind Spots
- Missing option: **upstreaming the engine itself** into nexu-io OD (slower/gated but eliminates two-implementation drift).
- Unasked question: **what is Tovu concretely?** Adapter surface should be shaped by the second consumer's real requirements; brief never asks.
- Likely-wrong framing: that Jini must maximize *generic* reusability — evidence suggests the user needs ONE second product (Tovu) running soon; designing for N slows the only consumer that exists.

## 19. Decisions Requiring Approval
1. Create GitHub repo, rename remotes, keep full OD history (vs squash). 2. Restore src from src.orig + delete Tovu symlink. 3. Confirm `integrated` as daemon baseline. 4. Harvest local ChatPane/ChatComposer branches. 5. Approve product-tree deletion list+schedule. 6. `@jini/*` naming + Apache-2.0+NOTICE. 7. AI-Dev-Shop sync mode (vendored vs submodule). 8. Model-budget defaults + lease TTL. 9. Confirm Tovu as second consumer + its requirements. 10. Weekly sync cadence + triage checkpoints.

## First 10 Tasks
1. `JIN-001-restore-web-src` — src.orig→src, remove symlink | web typecheck+test.
2. `JIN-002-agents-md-rewrite` — rewrite AGENTS.md/CLAUDE.md for Jini | review+guard.
3. `JIN-003-repo-identity` — remotes/LICENSE/NOTICE/package name | remote plan + install+guard.
4. `JIN-004-product-tree-deletion-1` — delete templates/story/clipper/figma/charts + move fixtures | guard+typecheck+daemon test.
5. `JIN-005-project-runner-skeleton` — ledger schema+bins+lease CAS+tests | project-runner test + determinism.
6. `JIN-006-cloud-context-v1` — first stamped exports | MANIFEST==HEAD.
7. `JIN-007-engine-boundary-guard` — check-engine-boundaries.ts in guard | red-test fixture + guard green.
8. `JIN-008-contracts-split` — partition generic vs OD DTOs | typecheck + snapshot tests.
9. `JIN-009-artifacts-package` — extract artifacts to package | artifacts test + web typecheck+test.
10. `JIN-010-replay-parity-harness` — trace replay + normalized stream snapshots | green on 3 traces (claude/codex/ACP).

## Assumptions
User controls leonaburime-ucla but not nexu-io merge rights (inferred). ChatPane/ChatComposer branches still exist in OD checkout (from notes; verify). Tovu is the intended second consumer (inferred from symlink). src.orig faithful pre-symlink copy. Apache-2.0+NOTICE acceptable to distribution intent.

## Top 5 Risks
1. Upstream drift compounds → stand up sync-od Phase 1, weekly triage. 2. Two drifting daemons → replay parity in every task. 3. Fork ossification/copy gravity → shrink-only apps/, deletion tranches, boundary guard, minimal-host. 4. Frontend harvest conflicts (biggest uncertainty) → decision gate after JIN-001, worktree attempt, re-derive if over budget. 5. Speculative abstraction w/ one consumer → two-consumer rule, Tovu requirements as approval item.

exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat2-agy-clean.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat2-agy-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     179 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat2-agy-clean.md
# Seat 2 — agy / Gemini 3.1 Pro (High) — Blind First-Round Submission

# Jini Architecture — First-Round Proposal

## 1. Executive Recommendation

I recommend the **blank-engine-with-OD-as-reference** strategy using a **package-first extraction** model. Copying Open Design's 5.5GB repository to mutate it into Jini (copy-then-refactor) creates an immediate, unmergeable fork that will inevitably drift from active upstream Open Design development. Instead, Jini must start as a clean repository containing only the generic engine packages and a `project-runner` control plane. Open Design is pulled in strictly as a Git sparse-clone under an ignored `references/` directory to run contract tests. This forces rigorous dependency inversion from day one: Open Design remains the primary application and consumes Jini's generic packages via adapters, ensuring Jini is genuinely reusable and not just Open Design with a different name.

## 2. Proposed Repository Topology

This structure isolates the generic engine from the reference implementation, verified to avoid polluting Jini with Open Design's massive `.git` history.

```text
Jini/
├── AI-Dev-Shop/                  # Agent/harness governance layer (verified present)
├── project-runner/               # Orchestration and task ledger control plane
├── packages/
│   ├── jini-core/                # Base types, event protocols, adapter interfaces
│   ├── jini-daemon-core/         # Generic HTTP daemon, sidecar transport, agent lifecycle
│   ├── jini-artifacts/           # Generic artifact parser and registry
│   └── jini-chat-react/          # Reusable chat UI components (headless hooks + slots)
├── integrations/
│   └── open-design/              # OD-specific Jini adapters and compatibility tests
├── references/
│   └── open-design/              # (Git sparse clone of OD, strictly .gitignored)
└── docs/
    └── jini-port/                # Tasks ledger, session handoffs, architecture maps
```

## 3. Package and Module Boundaries

| Package | Responsibility | Public API | Dependencies Allowed | Dependencies Forbidden | First Consumer |
|---|---|---|---|---|---|
| `jini-core` | Shared DTOs, protocols, adapter interfaces | `ChatEvent`, `RuntimeAdapter` | TypeScript standard lib | Node.js, Next.js, React, OD concepts | `jini-daemon-core` |
| `jini-daemon-core` | Agent lifecycle, sidecar IPC, generic HTTP routes | `AgentHost`, `startServer()` | `jini-core`, Express/Fastify | OD `RUNTIME_DATA_DIR`, OD SQLite schemas | OD `apps/daemon` |
| `jini-artifacts` | Markdown/artifact parsing and base renderers | `parseArtifact()`, base types | `jini-core`, React (peer) | OD-specific custom artifact types | OD `apps/web` |
| `jini-chat-react` | Presentational chat components and hooks | `ChatPane`, `Composer` (slots) | `jini-core`, React | Next.js router, OD `App.tsx` state | OD `apps/web` |
| `foundry/integrations/open-design` | Map OD logic to Jini interfaces | `ODChatAdapter`, `ODDataRoot` | `jini-*`, OD libraries | (Connects the two domains) | Open Design |

## 4. Daemon Core and Adapter Design

The Open Design daemon currently conflates generic runtime capabilities (agent spawning, sidecar IPC) with product specifics (project/workspace management, OD-specific skills).
**Extraction:** Jini provides `jini-daemon-core` as an embeddable library exposing `AgentHost`, `TransportRouter`, and a `SkillRegistry`.
**Adapters:** The user's `server.ts` rewrites represent excellent seams. Open Design will instantiate Jini's `AgentHost` and inject an `ODWorkspaceAdapter`. Daemon paths must not hardcode OD's `RUNTIME_DATA_DIR`; instead, the generic core accepts a storage interface, preventing hidden OD assumptions from leaking into Jini. The engine will expose both an embeddable library and a CLI, allowing maximum flexibility for future products.

## 5. Agent and CLI Discovery Design

**Source of truth:** A generic `AgentManifest` registry stored in the host product's configured data root.
**Schema:** `{ id, name, binPath, capabilities: [streaming, custom_tools], authStrategy }`.
**Refresh policy:** Populated by a local scanner that checks well-known OS paths (e.g., `~/.npm`, `~/.cargo/bin`) on daemon startup, and via an explicit API trigger.
**Normalization:** Differences in streaming (e.g., Claude's `stream-json` vs Codex's text-stdin) are normalized via a `RuntimeTransportAdapter` interface in `jini-daemon-core`. The core provides generic mid-turn input plumbing, but the specific transport adapter handles the serialization required by the specific model.

## 6. Frontend Feature-Slice and Reusable UI Design

Currently, Open Design relies on massive components (`App.tsx`, `ChatPane.tsx`, `ChatComposer.tsx`).
**Decomposition:** First, reorganize OD's `apps/web` into feature slices (following the `features/memory` pattern verified in the porting plan).
**Reusable UI:** `jini-chat-react` should provide headless hooks and presentational components (`MessageList`, `ToolCard`) that utilize **slots** (React `children` or render props).
By injecting OD's `AssistantMessage` attachments or custom design-system tools via slots, `jini-chat-react` remains completely agnostic of Next.js and Open Design's styling framework.

## 7. Open Design Integration Strategy

Open Design remains a separate repository and the primary consumer. Upstream changes flow normally in the OD repo. Jini pulls these updates by refreshing its local `references/open-design` sparse clone. When Jini extracts a package (e.g., `jini-artifacts`), an independent Pull Request is opened against the Open Design repository to replace local OD code with the Jini NPM package dependency. Fixes discovered during extraction are pushed directly to OD upstream, preventing two drifting implementations.

## 8. Project Runner and Durable Ledger

The `project-runner` is a repo-local control plane (not a CI system).
**Ledger Contract:** `ADS-memory/reports/jini-port/tasks.json` is the committed source of truth.
**Schema:** `{ id, status, source_ref, target, scope_files, validation_commands, blocker }`.
**States & Transitions:** `pending -> in_progress -> done | blocked | failed`.
**Locking:** A task is leased by an agent writing its ID and timestamp to `tasks.json` and committing the lease to a working branch.
**Ephemeral vs Committed:** `tasks.json`, validation scripts, and `decisions.md` are committed. Agent scratch files and active session logs (`ADS-memory/reports/jini-port/sessions/<id>.md`) remain local/ephemeral until a task transitions out of `in_progress`, at which point the handoff note is committed.

## 9. Cloud Agent Workflow

1. A cloud agent (Codex/Claude) clones Jini, runs `jini-next-task` to find a `pending` task, and creates a working branch.
2. The agent executes `jini-start-session` (claiming the lease) and provisions the OD reference clone.
3. The agent performs the scoped refactor (e.g., moving pure helpers) and runs the attached validation commands (e.g., `pnpm typecheck`).
4. On success, it runs `jini-finish-session --status done`, which links the handoff document and updates the ledger.
5. Concurrent conflicts are avoided because tasks are scoped to non-overlapping feature slices. If a lease expires or validation fails, the branch is abandoned and the task returns to `pending`.

## 10. CBM, Graphify, and Understand Anything Export Strategy

**Committed:** Small, high-signal JSON summaries (e.g., `architecture-map.json`, `dependency-seams.json`) stamped with the exact OD source commit hash and date. These are versioned in Jini so cloud agents have instant context.
**Local/Object Storage:** The massive 1.6GB Open Design `.git` history and heavy local vector AST indexes are NOT committed to Jini.
**Refresh:** A local runner script regenerates the CBM/Graphify exports explicitly before generating new task batches, ensuring cloud agents never read stale graph data.

## 11. Migration Phases With Exit Criteria

**Frontend Extraction Sequence:**
1. Characterize -> 2. Pure helpers -> 3. Artifact extraction -> 4. Chat component slots.
**Daemon Extraction Sequence:**
1. Route isolation -> 2. `AgentHost` adapter -> 3. Daemon core extraction.

**Phased Plan:**
*   **Phase 1: Characterization Tests.** Add strict boundary tests in OD for chat/artifacts.
    *   *Exit:* Tests pass on OD `origin/main`. *Rollback:* Delete tests in OD.
*   **Phase 2: Jini Core Bootstrapping.** Create blank Jini repo, `jini-core`, and `project-runner`.
    *   *Exit:* `project-runner` successfully clones OD sparse reference. *Rollback:* Delete Jini repo.
*   **Phase 3: Artifact Extraction.** Move OD artifact parsing into `jini-artifacts`.
    *   *Exit:* OD consumes Jini package with zero visual changes. *Rollback:* Revert OD import commit.
*   **Phase 4: Daemon Adapter Seam.** Implement `RuntimeAdapter` in OD, pointing to local daemon endpoints.
    *   *Exit:* OD UI runs agents through adapter. *Rollback:* Revert to direct API coupling.
*   **Phase 5: Jini Daemon Core.** Extract generic agent lifecycle to `jini-daemon-core`.
    *   *Exit:* OD `server.ts` boots Jini core. *Rollback:* Revert OD `server.ts`.

## 12. Testing and Compatibility Strategy

The public contract is the TypeScript interfaces in `jini-core`. Compatibility is proven by `foundry/integrations/open-design/compatibility-tests/` in Jini, which injects OD-like mocks into Jini to ensure Jini behaves correctly. In the OD repository, integration tests verify that consuming the Jini package doesn't break the product. Versioning strictly follows semver to manage deprecations.

## 13. Security, Recovery, Observability, and Cost

**Security:** Jini engine uses strict dependency injection for file-system access. It cannot access arbitrary paths; it can only read/write to the `OD_DATA_DIR` passed by the adapter. External CLIs run in isolated sub-processes.
**Recovery:** If an agent crashes or a stream is malformed, the adapter layer catches the exception, emits an error event to the frontend, and safely terminates the subprocess lease.
**Cost:** Use high-tier models (GPT-5.6/Claude Fable) strictly for architecture mapping and complex adapter design. Use cheaper, fast models for mechanical task execution (e.g., moving pure helpers, type-fixing) to cap costs.

## 14. Repository Size, Provenance, and Licensing

A full vendored copy of Open Design is explicitly rejected to avoid 5.5GB repo bloat. Jini remains kilobytes in size. Code moved into Jini retains its original Open Design license headers, augmented with `// Ported from Open Design (commit <hash>)` to guarantee provenance.

## 15. What Not to Generalize Yet

Do not generalize Open Design's project/workspace filesystem semantics, custom design systems, plugin marketplace specifics, data-root legacy fallbacks, or the packaged Electron desktop wrapper. These are highly specific product decisions that provide no value to a generic engine until a second consumer explicitly requires them.

## 16. Estimated Effort and Critical Path

*   **Elapsed Time:** 6–8 weeks.
*   **Engineering Effort:** 1 lead architect + 2 cloud agents.
*   **Critical Path:** Decomposing `ChatPane.tsx` state -> Extracting `jini-chat-react` -> Decomposing `apps/daemon/src/server.ts`.
*   **Uncertainty:** The highest risk is the undocumented state coupling between `useConversationChat.ts` and `ChatPane.tsx`, which may require more manual intervention than estimated.

## 17. Failure Modes and Reasons This Design Could Be Wrong

*   **Failure Mode 1:** `jini-chat-react` becomes an empty wrapper because Open Design requires too many custom injected slots, leading to an over-engineered, leaky abstraction.
*   **Failure Mode 2:** The sparse clone approach frustrates local development because TypeScript language servers fail to cross the repo boundary cleanly during refactoring.
*   **Why this could be wrong:** A Monorepo Federation (putting Jini and OD in the same pnpm workspace temporarily) might allow for atomic refactoring commits across both domains, which is safer during highly volatile early extractions.

## 18. Blind Spots

*   **Missing Architecture Option:** Web Components or Micro-frontends. The brief assumes React packages, but Web Components would make Jini truly framework-agnostic.
*   **Unasked Question:** How does Jini handle user authentication, telemetry, and rate-limiting if the generic daemon HTTP server is extracted?
*   **Framing Assumption:** The assumption that Open Design's current codebase is modular enough to extract via adapters without requiring a fundamental rewrite of the state-management layer.

## 19. Decision Checklist (Requires User Approval)

- [ ] Approve wiping the current dirty Jini repository and converting it to a clean engine structure.
- [ ] Approve the `blank-engine-with-OD-as-reference` strategy over a monolithic fork.
- [ ] Approve the use of a Git sparse clone for the reference integration.
- [ ] Approve the separation of React presentation (`jini-chat-react`) from Next.js routing.
- [ ] Approve the structure of the `tasks.json` ledger.

## 20. Implementation Backlog (First 10 Tasks)

*Sized for resumable cloud-agent sessions.*

1.  **Initialize Jini Base:** Wipe dirty Jini, create top-level folders (`project-runner`, `packages`, `docs`), and initialize `tasks.json`. (Goal: Clean repo state).
2.  **Configure Runner Clone:** Write `project-runner/bin/jini-sync-open-design` to establish the sparse `.gitignore`d clone of OD. (Validation: Script runs and clones successfully).
3.  **OD Chat Characterization:** In OD repo, write boundary Vitest tests for `ChatPane` and `ChatComposer` rendering outputs. (Validation: Tests pass on `origin/main`).
4.  **Extract Chat Pure Helpers:** In OD repo, move pure stateless formatting functions out of `ChatPane.tsx` into `features/chat/model/`. (Validation: `pnpm typecheck` and tests pass).
5.  **Jini Core Bootstrapping:** Create `packages/jini-core` with initial `ChatEvent` and `ChatRuntimeAdapter` TypeScript interfaces. (Validation: `tsc` compiles cleanly).
6.  **OD Artifact Slice:** In OD repo, isolate all artifact parsing logic into `features/artifacts/`. (Validation: OD build succeeds, zero UI changes).
7.  **Jini Artifact Package:** Move the isolated artifact parsers from OD into `packages/jini-artifacts` in the Jini repo. (Validation: Package builds independently).
8.  **OD Consumes Jini Artifacts:** Update OD repo to import `jini-artifacts` instead of local files. (Validation: E2E tests pass).
9.  **Daemon Adapter Seam:** In OD repo, implement the `AgentHost` adapter interface wrapping existing `server.ts` daemon endpoints. (Validation: Agents still spawn correctly).
10. **Chat React Base:** Extract `MessageRow` and `ToolCard` from OD into `packages/jini-chat-react`, converting OD-specific components into injectable slots. (Validation: Storybook or isolated tests render generic components).

## 21. Assumptions and Top 5 Risks

**Assumptions:**
- The user's `server.ts` rewrites are stable enough to build adapters around.
- Open Design's UI state can be decoupled from Next.js routers without rewriting the entire app.

**Top 5 Risks & Mitigations:**
1.  **Risk:** Agent sessions overwrite each other's ledger updates. **Mitigation:** Strict file locking mechanism in `tasks.json` using lease timestamps.
2.  **Risk:** Jini becomes a massive repo. **Mitigation:** Use Git sparse checkout `blob:none` and strictly `.gitignore` the reference clone.
3.  **Risk:** Open Design upstream diverges wildly during extraction. **Mitigation:** Small, atomic package extractions merged directly back into OD `origin/main` continuously.
4.  **Risk:** Cloud agents mutate Jini incorrectly. **Mitigation:** Validation commands (typecheck, tests) must pass locally before the runner allows a `done` transition.
5.  **Risk:** React slot injection causes severe performance regressions. **Mitigation:** Enforce React `memo` and strict referential equality checks on injected components in `jini-chat-react`.

```txt

exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat4-opus.md\" && sed -n '1,260p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat4-opus.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
     127 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat4-opus.md
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

exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat2-agy-clean.md\" && sed -n '1,240p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat2-agy-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc "wc -l \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat3-fable.md\" && sed -n '1,240p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat3-fable.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
      88 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat3-fable.md
# Seat 3 — Claude Fable 5 (`claude-fable-5`) — Blind First-Round Submission

## 1. Executive Recommendation

**Adopt strategy 2 executed with strategy 3's discipline: keep Jini as the existing full copy of Open Design and progressively invert it — but with a hard package-first rule (all new engine code lives in `packages/jini-*` behind machine-enforced import boundaries), an explicit deletion schedule for OD product content, and the in-tree OD apps demoted to "reference consumer" whose only job is to prove every extraction against real behavior.** Consistent with three verified facts: (1) Jini already *is* a copy — the `integrated` branch carrying the most-decomposed daemon in existence (server.ts 2,631 lines vs 8,635 on the OD checkout, 12 capability barrels, per-agent `runtimes/defs/`), work that exists nowhere upstream; (2) the user does not control upstream merge cadence — decomposition PRs are maintainer-gated, so strangler extraction *inside* upstream OD is structurally blocked; (3) a second consumer (Tovu) is already trying to mount the engine — the broken `apps/web/src → Tovu/web/src` symlink is direct evidence. Failure mode ("OD with renamed symbols") neutralized by: an import-boundary guard (same pattern as existing `check-web-slice-boundaries.ts`), an `examples/minimal-host` app that must run chat+artifacts+runtimes with zero `apps/`/`adapters/open-design/` imports, and phased deletion of OD product trees so the copy shrinks monotonically. Would change my mind: proof the user has commit rights on nexu-io/open-design.

## 2. Repository Topology
One repo, one pnpm monorepo, publishable packages, own GitHub repo, **git history preserved** (Apache-2.0 makes this clean; 481MB .git fine; cloud agents `--filter=blob:none`). Rename remotes `origin→od-upstream`, `fork→od-fork`; add new `origin`.
Key trees: `AI-Dev-Shop/` (vendored, top-level), `project-runner/`, `packages/{contracts,platform,sidecar,sidecar-proto,daemon-core,agent-runtimes,artifacts,chat-react,components}`, `adapters/open-design/{daemon,web,compat-tests,source-map.md}`, `apps/{daemon,web}` (reference consumers, shrink-only), `examples/minimal-host` (zero-OD-import proof), `mocks/` (kept — engine test infra), `reports/cloud-context/`, `references/` (gitignored, sparse-clone on demand).
Deleted (scheduled): design-templates/, design-systems/, story/, clipper/, figma-plugin/, charts/, marketing/landing, CHANGELOG/TRANSLATIONS/RELEASE-NOTES, src.orig after restore, Tovu symlink.

## 3. Package Boundaries
`@jini/contracts` (pure TS DTOs/SSE unions) → `@jini/platform` → `@jini/sidecar[-proto]` → `@jini/daemon-core` (HTTP kernel, run lifecycle, ports RunStore/ProjectStore/ArtifactStore/CredentialVault, `createJiniDaemon`) → `@jini/agent-runtimes` (RuntimeAgentDef registry, 25+ defs, stream parsers, capability flags, CLI discovery) → `@jini/artifacts` (headless parser/registry/question-form) → `@jini/chat-react` (headless hooks + presentational components + ChatRuntimeAdapter + slots) → `@jini/components`. `adapters/open-design` may import packages but packages may NEVER import apps/adapters (new `check-engine-boundaries.ts` in `pnpm guard`).

## 4. Daemon Core & Adapters
Ports: AgentRuntime, RunStore, ProjectProvider, ArtifactStore, EventSink, CredentialVault, SkillSource, DataRoot. Composition root `createJiniDaemon(config)`. Expose all four surfaces (they're layers of one thing: library = composition root, HTTP daemon = thin host, CLI = HTTP client per OD dual-track rule, sidecar already separate). Base Jini on the `integrated` trunk (server.ts already decomposed), NOT upstream main. OD-specific stays in adapter: design-systems, brands, deploy, figma, critique, marketplace, media, Langfuse.

## 5. Agent/CLI Discovery
Engine capability in `@jini/agent-runtimes`. SoT: daemon-owned `<RUNTIME_DATA_DIR>/agents/discovery.json` (never web, never committed). Full scan on start + lazy TTL 15min + `POST /api/agents/rescan` + ENOENT invalidation. Schema: `{id,binPath,version,authState,capabilities{promptInputFormat,midTurnInput,resume,streamEvents,models[]},discoveredAt,probeSource}`. Normalize via one event union in contracts + per-runtime capability flags + namespaced `ext:{[runtimeId]:…}` for richness (generic consumers ignore). New agent = new def+parser, zero switchboard edits.

## 6. Frontend
Headless hooks + presentational components + slot interfaces, shipped as packages, proven by reference app. Adapters: ChatRuntimeAdapter, ArtifactAdapter, ProjectContextAdapter (optional/nullable), slots for tool cards/attachments/artifact renderers/question-form/comments. Transport injected → usable outside Next.js. Sequence: restore src.orig→src + delete symlink → reconcile memory slice → harvest ChatPane/ChatComposer decomposition branches → characterization tests → extract @jini/artifacts → chat hooks behind ChatRuntimeAdapter → @jini/chat-react with slots → apps/web consumes → minimal-host zero-OD boot. Effort: 4–6 weeks (8–10 if harvest conflicts).

## 7. OD Integration
Upstream→Jini: `sync-od` fetches od-upstream/main into preserved history, triage report, agent cherry-picks, product-tree commits auto-skipped, weekly. Jini→OD: `backport` task type, red-spec-first PRs to fork. Anti-drift keystone: compat-tests + **mock replay parity** (same `mocks/` traces through OD daemon and Jini daemon-core, normalized streams diffed — covers 25+ runtimes). OD adopts @jini/artifacts first (smallest/purest). Jini AGENTS.md is a stale OD copy — Phase-0 rewrite mandatory.

## 8. Project Runner & Ledger
Repo-local TS, not CI. Division with AI-Dev-Shop: ADS governs *how* an agent works a task (role pipelines), project-runner governs *which* task/who-holds/what-happened; task record references `pipeline:"ads:refactor"`. Files (committed): `ledger/tasks/<id>.json` (one file per task, merge-friendly), `ledger/index.json` (generated, committed for cloud read speed), `sessions/<utc-ts>-<id>.md`, `decisions.md`, `blockers.md`; `leases/` gitignored flock. Schema: `{id,title,phase,status,dependsOn[],scope[],goal,allowedChanges[],forbiddenChanges[],validation[],sourceRepo,sourceRef,targetPaths[],pipeline,modelBudget,attempts[],lease,blockers[],decisionRefs[],handoff}`. States: draft→ready→claimed→in_progress→validating→done; +blocked→ready, +failed→ready|abandoned, +superseded. Terminal: done/abandoned/superseded. Lease model: distributed truth = git compare-and-swap (claim = write lease + push claim commit; rejected push = lost race); local = flock. TTL 4h, heartbeat 15min. Deterministic next-task = topo-sort deps → filter claimable → order by (phase,priority,id).

## 9. Cloud Workflow
next-task → claim (push CAS) → branch `task/<id>` (worktree local / partial clone cloud) → read task+last session+overview.md → execute under ADS pipeline → run task validation → write handoff → finish. Resume = re-read task+session (ledger is memory, not chat). Concurrency = lease CAS + disjoint scope globs. Human checkpoints: @jini/contracts shape changes, deletion executions, upstream-sync triage, license/NOTICE, forbiddenChanges requests. Autonomous: behavior-preserving green moves, backports w/ red spec, graph refresh, ledger hygiene. Compat protection: replay parity in every extraction task's validation. Executors: Claude Code primary, Codex cloud for mechanical; ledger agent-agnostic.

## 10. CBM/Graphify/UA Export
Committed `reports/cloud-context/`: MANIFEST.json (repo/branch/commit/generatedAt/tool/version stamps), overview.md (entry doc), architecture-map.md, seams.md, hotspots.md, daemon-symbols.md, web-symbols.md, graphify/summary.json (<5MB), understand-anything/graph.json (<5MB). Local/object-storage only: full indexes/DBs/dashboards. `refresh-context` regenerates, refuses dirty tree, stamps commit. Staleness: next-task compares MANIFEST distance to HEAD; >50 commits ⇒ warning + auto-enqueued refresh. No export exists today (stated, not fabricated); generating first = JIN-006.

## 11. Migration Phases (exit criteria / rollback)
0. Hygiene (restore src, new repo, rewrite AGENTS.md, NOTICE) → guard+typecheck+suites green → rollback tag `jini-baseline`.
1. Control plane (project-runner + ledger + first export + boundary guard) → next-task deterministic → delete project-runner/, zero product touched.
2. Contracts+artifacts (split @jini/contracts, extract @jini/artifacts) → boundary+characterization green → revert to phase-1 tag.
3. Daemon core (kernel+run lifecycle+agent-runtimes+discovery) → **mock replay parity** OD-vs-Jini → reference daemon re-inlines.
4. Chat UI (hooks+chat-react+adapters/web; minimal-host) → minimal-host zero-OD boot guard-enforced → per-package revert.
5. OD adoption+sync loop (publish, OD fork consumes artifacts, weekly sync) → OD fork green → OD pins previous commit.
6. Second consumer+shrink (Tovu adopts chat-react, deletion completes) → Tovu renders Jini chat → per-commit revertible.
Daemon extraction order: adopt trunk barrels → contracts split → http kernel/bootstrap → run lifecycle → runtime defs/parsers → CLI discovery → persistence ports around db.ts → artifact services → generic project/workspace (data-root to adapter) → skills loader generic (catalogue to adapter).

## 12. Testing/Compat
Contract = @jini/contracts (semver; additive minor, breaking major w/ deprecation ≥1 minor). Three detectors: contract snapshot tests, mock replay parity (25+ runtimes free), characterization suites. Reusability evidence = minimal-host (guard-enforced zero OD imports) + Tovu adoption = falsifiable "not renamed symbols" test.

## 13. Security/Recovery/Observability/Cost
Security: single-data-root discipline as core port, credentials in per-CLI homes/CredentialVault (never in registry/ledger), subprocess in agent-runtimes w/ stamp model. Recovery: crash→lease expiry→reclaim w/ supersession; malformed stream→parser fail-fast + trace captured as new fixture; partial migration→moves are import-relocations first so rollback = git revert at phase tag; upstream API change→replay parity red before users. Observability: sessions record attempts/outcomes/spend; `jini report` aggregates. Cost: strong models only for seam/contract/parser design + phase reviews; Sonnet-class for mechanical/graph/summarization; Haiku too inaccurate (repo history); re-audit only on real prior problem; graph refresh only >50-commit drift scoped to changed dirs.

## 14. Size/Provenance/License
No committed reference checkout — Jini's preserved git history IS the reference (upstream reachable via od-upstream); sync-od materializes gitignored sparse partial clone on demand. Submodule rejected (moving target, poor cloud ergonomics); subtree rejected (history already provides). Provenance: preserved history + adapters/open-design/source-map.md + Apache-2.0 LICENSE + NOTICE crediting nexu-io. 5.5GB is local artifacts; honest = .git 481MB, source tens of MB.

## 15. Not-Yet-Generic
design systems, templates, brands, marketplace, deploy, figma, critique/finalize, media, OD analytics, packaged desktop/updater, landing/story, 18-locale i18n, memory semantics. Rule: nothing adapter→core until TWO real consumers (Tovu = second vote). Two-consumer rule = anti-over-abstraction governor.

## 16. Effort/Critical Path
Phases 0–2: 1–2 wk; Phase 3: 3–5 wk; Phase 4: 4–6 wk (8–10 if branches don't harvest); Phases 5–6: 2–4 wk partly parallel. ~3–4 months elapsed, ~60–90 bounded tasks, human ~2–4h/wk. Critical path: restore → contracts split → daemon-core kernel → **replay parity harness (keystone)** → chat hooks → chat-react → minimal-host.

## 17. Why This Could Be Wrong
1. integrated trunk is a bad baseline (front-runs unmerged PRs; if upstream refactors differently, sync cost permanent). 2. Copy gravity wins (agents keep fixing OD instead of extracting). 3. Single-consumer abstraction (if Tovu stalls, seams speculative). 4. Replay parity over-promises (covers stream shapes, not fs/data-root side effects). 5. 52-behind gap compounds during phases 0–2.

## 18. Blind Spots
- Missing option: **upstreaming the engine itself** into nexu-io OD (slower/gated but eliminates two-implementation drift).
- Unasked question: **what is Tovu concretely?** Adapter surface should be shaped by the second consumer's real requirements; brief never asks.
- Likely-wrong framing: that Jini must maximize *generic* reusability — evidence suggests the user needs ONE second product (Tovu) running soon; designing for N slows the only consumer that exists.

## 19. Decisions Requiring Approval
1. Create GitHub repo, rename remotes, keep full OD history (vs squash). 2. Restore src from src.orig + delete Tovu symlink. 3. Confirm `integrated` as daemon baseline. 4. Harvest local ChatPane/ChatComposer branches. 5. Approve product-tree deletion list+schedule. 6. `@jini/*` naming + Apache-2.0+NOTICE. 7. AI-Dev-Shop sync mode (vendored vs submodule). 8. Model-budget defaults + lease TTL. 9. Confirm Tovu as second consumer + its requirements. 10. Weekly sync cadence + triage checkpoints.

## First 10 Tasks
1. `JIN-001-restore-web-src` — src.orig→src, remove symlink | web typecheck+test.
2. `JIN-002-agents-md-rewrite` — rewrite AGENTS.md/CLAUDE.md for Jini | review+guard.
3. `JIN-003-repo-identity` — remotes/LICENSE/NOTICE/package name | remote plan + install+guard.
4. `JIN-004-product-tree-deletion-1` — delete templates/story/clipper/figma/charts + move fixtures | guard+typecheck+daemon test.
5. `JIN-005-project-runner-skeleton` — ledger schema+bins+lease CAS+tests | project-runner test + determinism.
6. `JIN-006-cloud-context-v1` — first stamped exports | MANIFEST==HEAD.
7. `JIN-007-engine-boundary-guard` — check-engine-boundaries.ts in guard | red-test fixture + guard green.
8. `JIN-008-contracts-split` — partition generic vs OD DTOs | typecheck + snapshot tests.
9. `JIN-009-artifacts-package` — extract artifacts to package | artifacts test + web typecheck+test.
10. `JIN-010-replay-parity-harness` — trace replay + normalized stream snapshots | green on 3 traces (claude/codex/ACP).

## Assumptions
User controls leonaburime-ucla but not nexu-io merge rights (inferred). ChatPane/ChatComposer branches still exist in OD checkout (from notes; verify). Tovu is the intended second consumer (inferred from symlink). src.orig faithful pre-symlink copy. Apache-2.0+NOTICE acceptable to distribution intent.

## Top 5 Risks
1. Upstream drift compounds → stand up sync-od Phase 1, weekly triage. 2. Two drifting daemons → replay parity in every task. 3. Fork ossification/copy gravity → shrink-only apps/, deletion tranches, boundary guard, minimal-host. 4. Frontend harvest conflicts (biggest uncertainty) → decision gate after JIN-001, worktree attempt, re-derive if over budget. 5. Speculative abstraction w/ one consumer → two-consumer rule, Tovu requirements as approval item.

 succeeded in 0ms:
     179 /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat2-agy-clean.md
# Seat 2 — agy / Gemini 3.1 Pro (High) — Blind First-Round Submission

# Jini Architecture — First-Round Proposal

## 1. Executive Recommendation

I recommend the **blank-engine-with-OD-as-reference** strategy using a **package-first extraction** model. Copying Open Design's 5.5GB repository to mutate it into Jini (copy-then-refactor) creates an immediate, unmergeable fork that will inevitably drift from active upstream Open Design development. Instead, Jini must start as a clean repository containing only the generic engine packages and a `project-runner` control plane. Open Design is pulled in strictly as a Git sparse-clone under an ignored `references/` directory to run contract tests. This forces rigorous dependency inversion from day one: Open Design remains the primary application and consumes Jini's generic packages via adapters, ensuring Jini is genuinely reusable and not just Open Design with a different name.

## 2. Proposed Repository Topology

This structure isolates the generic engine from the reference implementation, verified to avoid polluting Jini with Open Design's massive `.git` history.

```text
Jini/
├── AI-Dev-Shop/                  # Agent/harness governance layer (verified present)
├── project-runner/               # Orchestration and task ledger control plane
├── packages/
│   ├── jini-core/                # Base types, event protocols, adapter interfaces
│   ├── jini-daemon-core/         # Generic HTTP daemon, sidecar transport, agent lifecycle
│   ├── jini-artifacts/           # Generic artifact parser and registry
│   └── jini-chat-react/          # Reusable chat UI components (headless hooks + slots)
├── integrations/
│   └── open-design/              # OD-specific Jini adapters and compatibility tests
├── references/
│   └── open-design/              # (Git sparse clone of OD, strictly .gitignored)
└── docs/
    └── jini-port/                # Tasks ledger, session handoffs, architecture maps
```

## 3. Package and Module Boundaries

| Package | Responsibility | Public API | Dependencies Allowed | Dependencies Forbidden | First Consumer |
|---|---|---|---|---|---|
| `jini-core` | Shared DTOs, protocols, adapter interfaces | `ChatEvent`, `RuntimeAdapter` | TypeScript standard lib | Node.js, Next.js, React, OD concepts | `jini-daemon-core` |
| `jini-daemon-core` | Agent lifecycle, sidecar IPC, generic HTTP routes | `AgentHost`, `startServer()` | `jini-core`, Express/Fastify | OD `RUNTIME_DATA_DIR`, OD SQLite schemas | OD `apps/daemon` |
| `jini-artifacts` | Markdown/artifact parsing and base renderers | `parseArtifact()`, base types | `jini-core`, React (peer) | OD-specific custom artifact types | OD `apps/web` |
| `jini-chat-react` | Presentational chat components and hooks | `ChatPane`, `Composer` (slots) | `jini-core`, React | Next.js router, OD `App.tsx` state | OD `apps/web` |
| `foundry/integrations/open-design` | Map OD logic to Jini interfaces | `ODChatAdapter`, `ODDataRoot` | `jini-*`, OD libraries | (Connects the two domains) | Open Design |

## 4. Daemon Core and Adapter Design

The Open Design daemon currently conflates generic runtime capabilities (agent spawning, sidecar IPC) with product specifics (project/workspace management, OD-specific skills).
**Extraction:** Jini provides `jini-daemon-core` as an embeddable library exposing `AgentHost`, `TransportRouter`, and a `SkillRegistry`.
**Adapters:** The user's `server.ts` rewrites represent excellent seams. Open Design will instantiate Jini's `AgentHost` and inject an `ODWorkspaceAdapter`. Daemon paths must not hardcode OD's `RUNTIME_DATA_DIR`; instead, the generic core accepts a storage interface, preventing hidden OD assumptions from leaking into Jini. The engine will expose both an embeddable library and a CLI, allowing maximum flexibility for future products.

## 5. Agent and CLI Discovery Design

**Source of truth:** A generic `AgentManifest` registry stored in the host product's configured data root.
**Schema:** `{ id, name, binPath, capabilities: [streaming, custom_tools], authStrategy }`.
**Refresh policy:** Populated by a local scanner that checks well-known OS paths (e.g., `~/.npm`, `~/.cargo/bin`) on daemon startup, and via an explicit API trigger.
**Normalization:** Differences in streaming (e.g., Claude's `stream-json` vs Codex's text-stdin) are normalized via a `RuntimeTransportAdapter` interface in `jini-daemon-core`. The core provides generic mid-turn input plumbing, but the specific transport adapter handles the serialization required by the specific model.

## 6. Frontend Feature-Slice and Reusable UI Design

Currently, Open Design relies on massive components (`App.tsx`, `ChatPane.tsx`, `ChatComposer.tsx`).
**Decomposition:** First, reorganize OD's `apps/web` into feature slices (following the `features/memory` pattern verified in the porting plan).
**Reusable UI:** `jini-chat-react` should provide headless hooks and presentational components (`MessageList`, `ToolCard`) that utilize **slots** (React `children` or render props).
By injecting OD's `AssistantMessage` attachments or custom design-system tools via slots, `jini-chat-react` remains completely agnostic of Next.js and Open Design's styling framework.

## 7. Open Design Integration Strategy

Open Design remains a separate repository and the primary consumer. Upstream changes flow normally in the OD repo. Jini pulls these updates by refreshing its local `references/open-design` sparse clone. When Jini extracts a package (e.g., `jini-artifacts`), an independent Pull Request is opened against the Open Design repository to replace local OD code with the Jini NPM package dependency. Fixes discovered during extraction are pushed directly to OD upstream, preventing two drifting implementations.

## 8. Project Runner and Durable Ledger

The `project-runner` is a repo-local control plane (not a CI system).
**Ledger Contract:** `ADS-memory/reports/jini-port/tasks.json` is the committed source of truth.
**Schema:** `{ id, status, source_ref, target, scope_files, validation_commands, blocker }`.
**States & Transitions:** `pending -> in_progress -> done | blocked | failed`.
**Locking:** A task is leased by an agent writing its ID and timestamp to `tasks.json` and committing the lease to a working branch.
**Ephemeral vs Committed:** `tasks.json`, validation scripts, and `decisions.md` are committed. Agent scratch files and active session logs (`ADS-memory/reports/jini-port/sessions/<id>.md`) remain local/ephemeral until a task transitions out of `in_progress`, at which point the handoff note is committed.

## 9. Cloud Agent Workflow

1. A cloud agent (Codex/Claude) clones Jini, runs `jini-next-task` to find a `pending` task, and creates a working branch.
2. The agent executes `jini-start-session` (claiming the lease) and provisions the OD reference clone.
3. The agent performs the scoped refactor (e.g., moving pure helpers) and runs the attached validation commands (e.g., `pnpm typecheck`).
4. On success, it runs `jini-finish-session --status done`, which links the handoff document and updates the ledger.
5. Concurrent conflicts are avoided because tasks are scoped to non-overlapping feature slices. If a lease expires or validation fails, the branch is abandoned and the task returns to `pending`.

## 10. CBM, Graphify, and Understand Anything Export Strategy

**Committed:** Small, high-signal JSON summaries (e.g., `architecture-map.json`, `dependency-seams.json`) stamped with the exact OD source commit hash and date. These are versioned in Jini so cloud agents have instant context.
**Local/Object Storage:** The massive 1.6GB Open Design `.git` history and heavy local vector AST indexes are NOT committed to Jini.
**Refresh:** A local runner script regenerates the CBM/Graphify exports explicitly before generating new task batches, ensuring cloud agents never read stale graph data.

## 11. Migration Phases With Exit Criteria

**Frontend Extraction Sequence:**
1. Characterize -> 2. Pure helpers -> 3. Artifact extraction -> 4. Chat component slots.
**Daemon Extraction Sequence:**
1. Route isolation -> 2. `AgentHost` adapter -> 3. Daemon core extraction.

**Phased Plan:**
*   **Phase 1: Characterization Tests.** Add strict boundary tests in OD for chat/artifacts.
    *   *Exit:* Tests pass on OD `origin/main`. *Rollback:* Delete tests in OD.
*   **Phase 2: Jini Core Bootstrapping.** Create blank Jini repo, `jini-core`, and `project-runner`.
    *   *Exit:* `project-runner` successfully clones OD sparse reference. *Rollback:* Delete Jini repo.
*   **Phase 3: Artifact Extraction.** Move OD artifact parsing into `jini-artifacts`.
    *   *Exit:* OD consumes Jini package with zero visual changes. *Rollback:* Revert OD import commit.
*   **Phase 4: Daemon Adapter Seam.** Implement `RuntimeAdapter` in OD, pointing to local daemon endpoints.
    *   *Exit:* OD UI runs agents through adapter. *Rollback:* Revert to direct API coupling.
*   **Phase 5: Jini Daemon Core.** Extract generic agent lifecycle to `jini-daemon-core`.
    *   *Exit:* OD `server.ts` boots Jini core. *Rollback:* Revert OD `server.ts`.

## 12. Testing and Compatibility Strategy

The public contract is the TypeScript interfaces in `jini-core`. Compatibility is proven by `foundry/integrations/open-design/compatibility-tests/` in Jini, which injects OD-like mocks into Jini to ensure Jini behaves correctly. In the OD repository, integration tests verify that consuming the Jini package doesn't break the product. Versioning strictly follows semver to manage deprecations.

## 13. Security, Recovery, Observability, and Cost

**Security:** Jini engine uses strict dependency injection for file-system access. It cannot access arbitrary paths; it can only read/write to the `OD_DATA_DIR` passed by the adapter. External CLIs run in isolated sub-processes.
**Recovery:** If an agent crashes or a stream is malformed, the adapter layer catches the exception, emits an error event to the frontend, and safely terminates the subprocess lease.
**Cost:** Use high-tier models (GPT-5.6/Claude Fable) strictly for architecture mapping and complex adapter design. Use cheaper, fast models for mechanical task execution (e.g., moving pure helpers, type-fixing) to cap costs.

## 14. Repository Size, Provenance, and Licensing

A full vendored copy of Open Design is explicitly rejected to avoid 5.5GB repo bloat. Jini remains kilobytes in size. Code moved into Jini retains its original Open Design license headers, augmented with `// Ported from Open Design (commit <hash>)` to guarantee provenance.

## 15. What Not to Generalize Yet

Do not generalize Open Design's project/workspace filesystem semantics, custom design systems, plugin marketplace specifics, data-root legacy fallbacks, or the packaged Electron desktop wrapper. These are highly specific product decisions that provide no value to a generic engine until a second consumer explicitly requires them.

## 16. Estimated Effort and Critical Path

*   **Elapsed Time:** 6–8 weeks.
*   **Engineering Effort:** 1 lead architect + 2 cloud agents.
*   **Critical Path:** Decomposing `ChatPane.tsx` state -> Extracting `jini-chat-react` -> Decomposing `apps/daemon/src/server.ts`.
*   **Uncertainty:** The highest risk is the undocumented state coupling between `useConversationChat.ts` and `ChatPane.tsx`, which may require more manual intervention than estimated.

## 17. Failure Modes and Reasons This Design Could Be Wrong

*   **Failure Mode 1:** `jini-chat-react` becomes an empty wrapper because Open Design requires too many custom injected slots, leading to an over-engineered, leaky abstraction.
*   **Failure Mode 2:** The sparse clone approach frustrates local development because TypeScript language servers fail to cross the repo boundary cleanly during refactoring.
*   **Why this could be wrong:** A Monorepo Federation (putting Jini and OD in the same pnpm workspace temporarily) might allow for atomic refactoring commits across both domains, which is safer during highly volatile early extractions.

## 18. Blind Spots

*   **Missing Architecture Option:** Web Components or Micro-frontends. The brief assumes React packages, but Web Components would make Jini truly framework-agnostic.
*   **Unasked Question:** How does Jini handle user authentication, telemetry, and rate-limiting if the generic daemon HTTP server is extracted?
*   **Framing Assumption:** The assumption that Open Design's current codebase is modular enough to extract via adapters without requiring a fundamental rewrite of the state-management layer.

## 19. Decision Checklist (Requires User Approval)

- [ ] Approve wiping the current dirty Jini repository and converting it to a clean engine structure.
- [ ] Approve the `blank-engine-with-OD-as-reference` strategy over a monolithic fork.
- [ ] Approve the use of a Git sparse clone for the reference integration.
- [ ] Approve the separation of React presentation (`jini-chat-react`) from Next.js routing.
- [ ] Approve the structure of the `tasks.json` ledger.

## 20. Implementation Backlog (First 10 Tasks)

*Sized for resumable cloud-agent sessions.*

1.  **Initialize Jini Base:** Wipe dirty Jini, create top-level folders (`project-runner`, `packages`, `docs`), and initialize `tasks.json`. (Goal: Clean repo state).
2.  **Configure Runner Clone:** Write `project-runner/bin/jini-sync-open-design` to establish the sparse `.gitignore`d clone of OD. (Validation: Script runs and clones successfully).
3.  **OD Chat Characterization:** In OD repo, write boundary Vitest tests for `ChatPane` and `ChatComposer` rendering outputs. (Validation: Tests pass on `origin/main`).
4.  **Extract Chat Pure Helpers:** In OD repo, move pure stateless formatting functions out of `ChatPane.tsx` into `features/chat/model/`. (Validation: `pnpm typecheck` and tests pass).
5.  **Jini Core Bootstrapping:** Create `packages/jini-core` with initial `ChatEvent` and `ChatRuntimeAdapter` TypeScript interfaces. (Validation: `tsc` compiles cleanly).
6.  **OD Artifact Slice:** In OD repo, isolate all artifact parsing logic into `features/artifacts/`. (Validation: OD build succeeds, zero UI changes).
7.  **Jini Artifact Package:** Move the isolated artifact parsers from OD into `packages/jini-artifacts` in the Jini repo. (Validation: Package builds independently).
8.  **OD Consumes Jini Artifacts:** Update OD repo to import `jini-artifacts` instead of local files. (Validation: E2E tests pass).
9.  **Daemon Adapter Seam:** In OD repo, implement the `AgentHost` adapter interface wrapping existing `server.ts` daemon endpoints. (Validation: Agents still spawn correctly).
10. **Chat React Base:** Extract `MessageRow` and `ToolCard` from OD into `packages/jini-chat-react`, converting OD-specific components into injectable slots. (Validation: Storybook or isolated tests render generic components).

## 21. Assumptions and Top 5 Risks

**Assumptions:**
- The user's `server.ts` rewrites are stable enough to build adapters around.
- Open Design's UI state can be decoupled from Next.js routers without rewriting the entire app.

**Top 5 Risks & Mitigations:**
1.  **Risk:** Agent sessions overwrite each other's ledger updates. **Mitigation:** Strict file locking mechanism in `tasks.json` using lease timestamps.
2.  **Risk:** Jini becomes a massive repo. **Mitigation:** Use Git sparse checkout `blob:none` and strictly `.gitignore` the reference clone.
3.  **Risk:** Open Design upstream diverges wildly during extraction. **Mitigation:** Small, atomic package extractions merged directly back into OD `origin/main` continuously.
4.  **Risk:** Cloud agents mutate Jini incorrectly. **Mitigation:** Validation commands (typecheck, tests) must pass locally before the runner allows a `done` transition.
5.  **Risk:** React slot injection causes severe performance regressions. **Mitigation:** Enforce React `memo` and strict referential equality checks on injected components in `jini-chat-react`.

```txt

exec
/bin/bash -lc "rg -n '"'^#|''^##|''^###'"' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
1:# Seat 1 — codex / gpt-5.6-sol (reasoning=high) — Blind First-Round Submission
3:# Executive Recommendation
7:## Verified Repository Evidence
20:# Controlling Questions — Direct Answers
42:# Proposed Repository Topology
116:# Package and Module Boundaries
135:# Daemon Core and Adapter Design
185:# Agent and CLI Discovery Design
247:# Frontend Feature-Slice and Reusable UI Design
283:## Frontend extraction sequence
298:# Open Design Integration Strategy
323:# Project Runner and Durable Ledger
325:## Files
378:## Task states and legal transitions
394:## Lease and locking model
415:## Committed versus ephemeral
436:## Engine run ledger
462:# Cloud Agent Workflow
479:# CBM, Graphify, and Understand Anything Export Strategy
537:# Migration Phases With Exit Criteria
551:# Daemon Extraction Sequence
568:# Testing and Compatibility Strategy
590:# Security, Recovery, Observability, and Cost
616:# Repository Size, Provenance, and Licensing
633:# What Not to Generalize Yet
652:# Estimated Effort and Critical Path
666:# First 10 Concrete Implementation Tasks
686:# Failure Modes and Reasons This Design Could Be Wrong
698:# Blind Spots
704:# Assumptions
715:# Top Five Risks and Mitigations
723:# Decision Checklist
741:## Self-assessment against the rubric

exec
/bin/bash -lc "sed -n '537,740p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos/open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
exec
/bin/bash -lc "sed -n '247,322p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos/open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 exited 1 in 0ms:
sed: /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos/open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md: No such file or directory

 exited 1 in 0ms:
sed: /Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos/open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md: No such file or directory

exec
/bin/bash -lc "sed -n '537,740p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# Migration Phases With Exit Criteria

| Phase | Work and exit criteria | Rollback |
|---|---|---|
| 0. Preserve and rebaseline | Preserve current Jini dirty work, broken symlink provenance, branch heads, stash, and remotes. Create an approved clean Jini engine baseline. No user work is lost. | Continue using existing Jini/OD checkouts unchanged. |
| 1. Characterize Open Design | Current upstream source selected; golden runtime, HTTP/SSE, artifact, chat, cancellation, and resume tests pass. Source map established. | Revert tests/docs only; runtime unchanged. |
| 2. Jini foundation | Protocol, engine ports, runner, leases, context manifests, reference apps, and package guards work without OD imports. | Jini remains unused; OD unaffected. |
| 3. Runtime vertical slice | Durable run ledger, runtime registry, discovery, one structured adapter, HTTP, CLI, and reference UI complete a real run. | Remove Jini canary; OD still owns execution. |
| 4. Open Design runtime canary | OD adapter can select legacy or Jini runtime. Golden mock traces and failure classifications match; security review passes. | Flip to legacy implementation and pin previous dependency. |
| 5. Runtime ownership transfer | Codex and Claude differences, resume, mid-turn input, auth, model discovery, cancellation, and crash recovery pass. Two OD releases use Jini by default. | Restore legacy default for one release; retain migrated data. |
| 6. Artifacts and frontend | Artifacts, reducers, message UI, and composer primitives are consumed through OD adapters. Vite reference app passes. | Feature flag switches individual UI slices to legacy. |
| 7. Second consumer | A real non-OD product uses runtime plus chat/artifacts without importing `open-design`. Conformance suite passes. | Keep packages pre-1.0; do not remove remaining compatibility paths. |
| 8. Stabilize and retire | Jini 1.0 contracts, security policy, support window, migration guide, and release ownership approved. Legacy OD paths removed capability-by-capability. | Pin prior Jini version; restore legacy path from retained release branch. |

# Daemon Extraction Sequence

1. Freeze generic event/error/runtime contracts from existing tests.
2. Extract `platform` and generic `sidecar` primitives with provenance.
3. Define durable run, event, conversation, and native-session stores.
4. Define `RuntimeAdapterV1` and capability negotiation.
5. Extract executable discovery, launch resolution, diagnostics, and config invalidation.
6. Add one structured adapter—Codex—plus recorded mock traces.
7. Add Claude to force validation of open stdin, stream-JSON, and specified-ID resume.
8. Build the generic run coordinator: prompt input, event normalization, cancellation, retry, resume, and recovery.
9. Add HTTP/SSE and CLI transports over the same services.
10. Add workspace, artifact, credential, and prompt-augmentation ports.
11. Implement the Open Design composition adapter.
12. Shadow and cut over one runtime path before extracting further product services.

The daemon path is roughly 18–34 engineer-weeks. The run coordinator and compatibility work dominate uncertainty.

# Testing and Compatibility Strategy

Required layers:

- Compile-time package-boundary guards
- Runtime schema validation at every HTTP/event boundary
- Adapter conformance tests supplied by Jini
- Recorded CLI trace replay for each runtime and parser
- Golden legacy-versus-Jini event comparisons
- SQLite migration/restart/crash tests
- HTTP and CLI parity tests
- Cancellation and process-tree termination tests
- Security tests for path traversal, origin/auth, credentials, env leakage, and unsafe executable overrides
- React reducer/component tests
- Accessibility and visual regression tests
- A minimal non-Next reference application
- Open Design end-to-end canaries using its existing tools-dev harness

Protocol changes carry a version field and migration function. Jini should support the current and previous minor adapter API during a documented deprecation window. Unknown event variants must be preserved as typed extension/raw events rather than discarded.

Proof of reusability requires a real second product before 1.0. The reference app proves packaging and decoupling, but does not by itself prove product fitness.

# Security, Recovery, Observability, and Cost

Security defaults:

- Localhost-only server unless explicitly configured otherwise
- Capability-scoped tool and filesystem grants
- Canonical workspace roots and allowed-directory checks
- Minimal child environment allowlist
- Opaque credential handles; no credentials in DTOs or logs
- Per-run MCP/tool configuration with trust policy
- Process-group cancellation and orphan reconciliation
- Versioned database migrations with backups and idempotent recovery
- Raw malformed stream retention in protected diagnostic storage

Observability should capture run ID, task ID, runtime/adapter version, model, state transitions, retries, resume attempts, event lag, token/cost data when reported, validation outcomes, and compatibility version—without recording prompt contents by default.

Cost controls:

- Deterministic scanners and graph queries before LLM summarization
- Small/mini models for scoped summaries, inventory classification, ledger maintenance, and mechanical moves
- Strong models for ADRs, security, parser semantics, migrations, and cross-package review
- At most one strong-model implementation pass and one independent strong review per high-risk task
- Incremental scoped graph refreshes; full refresh only after structural/package changes or release checkpoints
- Cache summaries by repository commit and tool configuration
- Hard task token/time budgets with handoff rather than unconstrained continuation

# Repository Size, Provenance, and Licensing

| Reference option | Decision |
|---|---|
| Vendored Open Design copy | Reject: duplication, confusing ownership, costly checkout |
| Git submodule | Reject as default: small pointer but fragile cloud/agent checkout and auth behavior |
| Git subtree | Reject for OD source: duplicates history/content and invites accidental edits |
| Sparse partial clone | Use on demand in ignored `.jini/cache/open-design/` |
| Generated source snapshot | Use only for deliberately extracted files with provenance |
| No local checkout | Default for consumers; runner materializes one when required |

`foundry/integrations/open-design/upstream.lock.yaml` should pin the canonical URL, user fork URL, relevant branches, commit SHAs, and selected patch/stash artifacts. `source-map.yaml` records each extracted module’s original path and commit.

Use `git format-patch`/`git am`, history-filtered transfer, or equivalent provenance-preserving methods for substantive code moves. Preserve original authors. Jini should retain Apache-2.0, add a `NOTICE`, retain upstream notices, and mark modified files as required by the license.

`AI-Dev-Shop/` is only about 12 MB locally, is required in every checkout, and consists largely of agent instructions/templates. Keep it as a pinned vendored subtree or synchronized snapshot with an upstream lock; a package or submodule would make cloud-agent availability less reliable.

# What Not to Generalize Yet

Keep these in Open Design until a second consumer demonstrates a common need:

- Brands and design-system catalogues
- Design templates and craft rules
- Plugin marketplace semantics
- Open Design project creation/import rules
- Memory and automation product behavior
- Media providers and model presets
- Critique Theater
- Library/community/social features
- Product analytics taxonomy
- Desktop updater/release-channel identity
- Open Design’s complete BYOK provider surface
- Deployment and design-finalization workflows

Jini may expose ports these features use, but should not own their domain models.

# Estimated Effort and Critical Path

Assuming two or three experienced engineers with agent assistance:

- Foundation, runner, protocol, provenance: 4–7 engineer-weeks
- Runtime core, discovery, persistence, Codex/Claude adapters: 14–24 engineer-weeks
- OD daemon adoption and compatibility: 8–16 engineer-weeks
- Artifacts and reusable frontend: 14–25 engineer-weeks
- Second-consumer hardening and 1.0 operations: 6–12 engineer-weeks

Work can overlap; a realistic elapsed range is roughly four to seven months. Total engineering effort is more meaningful than calendar precision and is likely 45–80 engineer-weeks. Uncertainty is high—approximately ±40%—because the largest seams are currently untyped and the second consumer is unspecified.

Model/tool cost should be controlled per task rather than estimated as a false dollar total. Graph generation and strong-model architecture/security review are the significant variable costs; tests, typechecking, and deterministic indexing should dominate routine validation.

# First 10 Concrete Implementation Tasks

Precondition: the user approves preserving the current dirty Jini state and creating a clean engine baseline.

| ID | Repository and scope | Goal | Validation |
|---|---|---|---|
| JINI-001 | Root: `package.json`, `pnpm-workspace.yaml`, `AGENTS.md`, `LICENSE`, `NOTICE`, `docs/adr/0001-*` | Create minimal Node 24/pnpm Jini workspace and neutrality guards. | `pnpm install --frozen-lockfile`; `pnpm guard`; `pnpm typecheck` |
| JINI-002 | `project-runner/schemas/**`, `project-runner/src/ledger/**`, `project-runner/tests/**` | Implement task parsing, transition validation, dependency resolution, and deterministic `next`. | `pnpm --filter @jini/project-runner test`; `pnpm --filter @jini/project-runner typecheck` |
| JINI-003 | `project-runner/src/leases/**`, `src/sessions/**`, tests | Implement local locks, remote-ref CAS leases, expiry/reap, scope-conflict detection, and handoffs. | Runner unit tests plus a temporary bare-remote integration test |
| JINI-004 | `foundry/integrations/open-design/{upstream.lock.yaml,source-map.yaml,ownership.yaml}`, `tools/provenance/**` | Record Open Design source refs and validate every imported file’s provenance/license fields. | `pnpm provenance:check`; `pnpm guard` |
| OD-001 | `apps/daemon/tests/runtimes/**`; port tests only from commits `75fd4afa4`/`780917104` | Establish current-upstream golden SSE/run behavior without moving implementation. | `pnpm --filter @open-design/daemon typecheck`; focused Vitest; `pnpm guard` |
| JINI-005 | `packages/protocol/src/**`, schemas and tests | Define `RunEventV1`, run states, errors, runtime descriptors, conversation DTOs, and version negotiation. | `pnpm --filter @jini/protocol test`; typecheck; schema fixture validation |
| JINI-006 | `packages/runtime/src/**`, tests | Define `RuntimeAdapterV1`, capability unions, registry, fake adapters, and conformance test kit. | `pnpm --filter @jini/runtime test`; typecheck |
| JINI-007 | `packages/persistence-sqlite/src/**`, migrations, tests | Implement durable run/event/conversation/session stores and restart recovery. | Package tests including crash/reopen and migration tests |
| JINI-008 | `packages/platform-node/**`, `packages/runtime-node/src/discovery/**`, tests | Extract product-neutral executable discovery and persisted detection snapshots. | Both package tests; PATH/config invalidation fixtures; `pnpm guard` |
| JINI-009 | `packages/runtime-node/src/adapters/codex/**`, mock fixtures | Add first real structured adapter with model/auth probes, captured-ID resume, cancellation, and event normalization. | Adapter conformance suite plus recorded Codex mock replay |
| JINI-010 | `packages/engine/**`, `packages/daemon-node/**`, `packages/client/**`, `packages/cli/**`, `apps/reference-daemon/**` | Complete one end-to-end run through library, HTTP/SSE, CLI, durable ledger, and Codex adapter. | Package tests; reference-daemon integration test; `jini run --json` smoke test |

Artifact characterization and extraction should be tasks 11–13; Open Design runtime canary adoption should begin only after task 10 is stable.

# Failure Modes and Reasons This Design Could Be Wrong

- Cross-repository releases may impose more coordination cost than temporarily hosting Jini packages inside Open Design.
- The daemon’s product prompt/artifact behavior may be too entangled to isolate without changing observable results.
- Generic UI slots may become an indirect reconstruction of every Open Design prop.
- Native CLI behavior may change too quickly for stable adapter packages.
- Remote Git-ref leasing may be disallowed by repository permissions; the lease backend would then need a transactional service.
- A second consumer may require a different language, runtime, or UI framework, invalidating the Node/React package emphasis.
- The copied Jini checkout may contain valuable uncommitted work not visible through its broken symlink; rebaselining before recovering it would be destructive.

Evidence that would change my strategy: an explicit maintainer agreement to host Jini packages inside Open Design for a bounded incubation period, or a second consumer whose deployment constraints rule out Node/React. In that case, I would incubate packages in the OD monorepo or make the protocol/conformance suite—not the implementation—the first Jini deliverable.

# Blind Spots

- **Viable missing option:** a protocol-only Jini repository containing schemas and conformance tests, with independent daemon/UI implementations remaining in their product repositories.
- **Question the group should be asking:** what exact second product, deployment environment, and first workflow must Jini support? Without that, “generic” APIs are being designed against only one real consumer.
- **Framing assumption most likely wrong:** daemon execution and reusable chat UI may not need to ship as one engine product or stabilize on the same release schedule.

# Assumptions

- Apache-2.0 remains the desired license.
- Jini remains TypeScript/Node 24 with pnpm.
- React remains the initial reusable UI target.
- Maintainers can change and release both repositories.
- Cloud agents have permission to create task branches and lease refs after approval.
- Open Design’s freshly fetched upstream main will be the behavioral source, not the current local branch.
- No existing external consumer depends on the present copied Jini repository.
- A real second consumer will be selected before Jini 1.0.

# Top Five Risks and Mitigations

1. **Hidden behavior loss in untyped god-files.** Mitigate with current-upstream characterization tests, shadow execution, mock trace replay, and small cuts.
2. **Open Design/Jini drift.** Mitigate with single-owner `ownership.yaml`, source maps, conformance kits, exact pins, and no long-lived duplicated implementation.
3. **Loss of current Jini work.** Mitigate by preserving the dirty tree, broken symlink target information, `src.orig`, branches, and stashes before rebaselining.
4. **Premature abstraction/package sprawl.** Mitigate by requiring a runtime/security/release reason for each package and delaying product domains until a second consumer exists.
5. **Subprocess and credential exposure.** Mitigate with canonical paths, capability grants, minimal environments, opaque credentials, protected session handles, and adversarial security tests.

# Decision Checklist

The user must approve these before implementation:

- [ ] Preserve the current dirty Jini state, then establish a clean engine baseline rather than refactoring the copied product tree.
- [ ] Canonical Jini repository owner/URL and whether it will be public.
- [ ] Apache-2.0 plus Open Design attribution/NOTICE policy.
- [ ] Publishable package scope, such as `@jini/*`.
- [ ] Package-first strangler strategy and two-repository ownership model.
- [ ] Initial runtime order: Codex first, Claude second.
- [ ] The concrete second consumer and its minimum acceptance workflow.
- [ ] Vendored/subtree synchronization policy for `AI-Dev-Shop/`.
- [ ] Permission for `project-runner` to create/delete remote lease branches and isolated worktrees.
- [ ] Security defaults for subprocess sandboxing, network access, tool grants, and telemetry.
- [ ] Which server-rewrite tests or patches should be recovered; no stale rewrite branch should be merged wholesale.
- [ ] Whether the frontend memory-slice and other local/stashed refactors should be rebased, archived, or completed separately.
- [ ] Release/deprecation window and how long Open Design legacy paths remain available.


exec
/bin/bash -lc "sed -n '247,322p' \"/Users/la/.claude/harness-tmp/claude-501/-Users-la-Desktop-Programming-OSS-Repos-open-design/c1b8b62a-a134-4b5a-8e28-7380f8b7ae05/scratchpad/jini-debate/round1/seat1-codex-clean.md\"" in /Users/la/Desktop/Programming/OSS-Repos/open-design
 succeeded in 0ms:
# Frontend Feature-Slice and Reusable UI Design

Use three layers:

1. `@jini/artifacts`: pure artifact parsing, manifests, question forms, and renderer selection.
2. Headless chat state inside `@jini/chat-react`: reducer/controllers usable through hooks.
3. Presentational React components with explicit slots.

Core client contract:

```ts
interface ChatClient {
  createRun(input: CreateRunInput): Promise<RunHandle>;
  streamRun(runId: string, after?: number): AsyncIterable<RunEventV1>;
  cancelRun(runId: string): Promise<void>;
  sendRunInput?(runId: string, input: MidTurnInput): Promise<void>;
  loadConversation(id: string): Promise<Conversation>;
  listRuntimes(): Promise<RuntimeDescriptorV1[]>;
}
```

Required product slots/adapters:

- `scopeProvider` for project/workspace context
- `runtimePicker`, `modelPicker`, and capability-aware controls
- `attachmentResolver` and attachment renderer
- `artifactRegistry` and `filePreviewAdapter`
- `toolRendererRegistry`
- `questionFormHandler`
- `commentsAdapter` and `feedbackSink`
- `analyticsSink`
- `composerActions`
- design tokens/class-name hooks

The reusable package should use React peer dependencies, standard web APIs behind injected transports, CSS Modules/CSS variables, and no Next.js APIs. A Vite reference application must consume it.

## Frontend extraction sequence

1. Add characterization tests for artifact parsing, question forms, message ordering, Todo snapshots, queues, errors, attachments, and composer payloads.
2. Extract pure artifact types/parsers from `apps/web/src/artifacts/*`.
3. Move run-event folding, tool deduplication, message derivation, and conversation state into pure reducers.
4. Introduce `ChatClient` while the Open Design implementation still calls existing daemon providers.
5. Split `ChatPane` into controller, render-item builder, message list, message row, pinned-state region, and product slots.
6. Split `ChatComposer` into draft model, submit builder, input component, attachment tray, capability controls, and product action slots.
7. Extract generic message, question-form, tool-shell, artifact-shell, and composer components.
8. Build the Vite reference application using a fake/in-memory transport.
9. Publish a canary package and switch Open Design behind a feature flag.
10. Remove legacy components only after visual, accessibility, streaming, and compatibility parity.

Expected frontend effort is roughly 14–25 engineer-weeks, with 8–14 calendar weeks if work overlaps. Composer and file/artifact behavior create the largest uncertainty.

# Open Design Integration Strategy

Maintain an ownership manifest per capability:

```yaml
runtime-registry:
  state: od-owned | shadowed | jini-owned
  source_commit: ...
  jini_version: ...
  od_adapter_path: ...
  compatibility_suite: ...
```

Flow rules:

- Before cutover, bugs are fixed in Open Design and referenced by the extraction task.
- During shadowing, the same golden tests run against legacy and Jini implementations.
- After cutover, generic bugs are fixed in Jini first, released as a canary/patch, then consumed by an Open Design dependency bump.
- Product bugs stay in Open Design.
- No capability may remain indefinitely in two editable implementations.
- Open Design should consume exact Jini versions initially, then use controlled ranges after stability.
- Upstream Open Design changes are reviewed by source-map ownership. A changed extracted source path opens a compatibility task; it is not automatically copied into Jini.

The current memory branch should be reconciled onto current upstream separately. It should not define Jini’s baseline, and the stash should be preserved or promoted into a named branch/patch before any checkout cleanup.


