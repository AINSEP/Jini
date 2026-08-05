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

# Project Runner and Durable Ledger

## Files

```text
project-runner/
├── config.yaml
├── schemas/
│   ├── task.schema.json
│   ├── attempt.schema.json
│   ├── lease.schema.json
│   └── validation-result.schema.json
├── ledger/
│   ├── tasks/JINI-0001.yaml
│   ├── sessions/JINI-0001/<attempt-id>/
│   │   ├── summary.md
│   │   ├── attempt.json
│   │   └── validation.json
│   └── compatibility/*.yaml
└── src/...
```

Task schema:

```yaml
schemaVersion: 1
id: JINI-0001
title: Establish protocol package
status: ready
priority: 20
repository: jini
source:
  branch: main
  commit: <exact-sha>
target:
  branchPrefix: task/JINI-0001
scope:
  include: [packages/protocol/**]
  exclude: [packages/runtime-node/**]
goal: Define versioned run and runtime contracts.
dependsOn: []
adrRefs: [docs/adr/0002-protocol-versioning.md]
compatibilityRefs: [runtime-events-v1]
approval:
  required: false
validation:
  - id: protocol-test
    cwd: .
    command: pnpm --filter @jini/protocol test
    required: true
    timeoutSeconds: 300
attemptLimit: 3
lastOutcome: null
```

## Task states and legal transitions

```text
draft → ready | cancelled
ready → claimed | cancelled
claimed → running | ready | blocked
running → awaiting_review | blocked | failed | ready
blocked → ready | cancelled
failed → ready | cancelled
awaiting_review → done | running | blocked
done → ready              # human-approved reopen only
any nonterminal → superseded
```

`claimed` and `running` are overlays from the active lease/attempt. Attempt outcomes are `active`, `handed_off`, `succeeded`, `failed`, or `abandoned`.

## Lease and locking model

- Cross-machine authority: remote branch/ref `jini-lease/<task-id>`.
- Claim: atomic ref creation; only one claimant succeeds.
- Renewal: heartbeat every ten minutes with a 45-minute TTL and expected-old-SHA compare-and-swap.
- Lease contains owner identity, attempt ID, branch, source commit, scope digest, expiry, and token hash.
- The secret lease token stays in ignored local state.
- Expired work is never silently discarded. Reaping records the branch head and an `abandoned` attempt before returning the task to `ready`.
- Offline mode uses an OS file lock and may not claim tasks marked `remoteRequired`.
- Active scope overlap is checked before claim. Overlap may be overridden only by an explicit coordination record.

A new agent selects work by filtering for:

1. `ready`;
2. all dependencies `done`;
3. required approvals satisfied;
4. source commit still valid;
5. no active lease;
6. no overlapping active scope;
7. then lowest priority number and stable task ID.

## Committed versus ephemeral

Committed:

- Task definitions and state changes
- ADR and compatibility links
- Attempt summaries and branch/commit identifiers
- Required validation commands and structured results
- Blockers, failure classification, final outcome
- Small sanitized logs needed to reproduce a failure

Ephemeral/local or object-storage-only:

- Lease secret
- Credentials and environment values
- Raw prompts and model transcripts unless explicitly approved
- Worktree paths and PIDs
- Full command logs and coverage artifacts
- Graph databases, embeddings, caches
- Native runtime session handles

## Engine run ledger

This is separate from the development task ledger. Jini’s daemon should durably store:

```text
runs(id, status, runtime_id, adapter_version, workspace_ref,
     lease_owner, lease_expires_at, last_event_seq, error_json, timestamps)

run_events(run_id, seq, event_type, payload_json, created_at)

runtime_sessions(conversation_id, runtime_id, encrypted_handle,
                 adapter_version, updated_at)
```

Engine run states:

```text
queued → starting → running → awaiting_input | cancelling
running → succeeded | failed | orphaned
awaiting_input → running | cancelling | failed
cancelling → cancelled | failed
orphaned → starting | failed | cancelled
```

Expired daemon leases produce `orphaned`; recovery resumes only when the adapter declares a compatible resume capability.

# Cloud Agent Workflow

1. `runner next` selects a safe task.
2. `runner claim JINI-#### --agent codex|claude` creates the lease and attempt.
3. The runner creates `task/<id>/<attempt>` from the exact source commit and an isolated worktree.
4. It materializes the task packet: instructions, ADRs, source-stamped context reports, scope, and validations.
5. The agent works only inside the declared repository and scope.
6. Heartbeats renew the lease; the runner records checkpoint commits and concise handoffs.
7. `runner validate` executes declared commands and writes structured results.
8. `runner handoff` preserves a resumable branch and session summary when context is low.
9. `runner submit` opens or updates the review branch/PR and marks `awaiting_review`.
10. Merge finalization marks `done`, clears the lease, refreshes affected context, and unblocks dependents.

Human checkpoints are required for repository rebaselining, public API/ADR changes, security-boundary changes, data migrations, licensing, breaking releases, and legacy removal. Characterization tests, mechanical moves, documentation refreshes, and bounded bug fixes may proceed autonomously.

AI-Dev-Shop owns role selection and approval policy. The runner merely enforces that policy and records execution; `AI-Dev-Shop/todo.md` must not become a second task ledger.

# CBM, Graphify, and Understand Anything Export Strategy

```text
context/
├── index.yaml
├── current/
│   ├── open-design.yaml
│   └── jini.yaml
└── snapshots/
    ├── open-design/<commit>/
    │   ├── manifest.json
    │   ├── overview.md
    │   ├── architecture.json
    │   ├── packages.json
    │   ├── symbols.ndjson.zst
    │   ├── hotspots.json
    │   ├── seams/
    │   ├── cbm-query-pack.json
    │   ├── graphify-summary.json
    │   └── understand-summary.json
    └── jini/<commit>/...
```

Every manifest records:

- Canonical repository URL
- Branch and exact commit
- Dirty-tree flag
- Tool name/version/config
- Generation time
- Included/excluded paths
- Export hashes
- Object-storage URI and checksum for large data
- Previous snapshot and refresh reason

Commit:

- Overview documents
- Package/dependency maps
- Top-symbol index
- Key inbound/outbound call summaries
- Hotspot and seam reports
- Small normalized graph exports
- Manifest and freshness metadata

Keep local or in object storage:

- `.codegraph/*.db`
- `.code-review-graph/*.db`
- Codebase Memory databases and embeddings
- Understand Anything intermediate batches and scratch data
- Raw absolute paths, caches, logs, and secrets
- Any single export over 10 MiB or snapshot set over 25 MiB

A task that declares `contextRequired: true` fails closed when its report commit differs from its source commit. Incremental reports may describe a commit range, but must never be presented as a full-current graph.

Current report status must be recorded as incomplete: no valid shareable CBM graph for this checkout, no completed Understand Anything graph, and only local ignored Graphify/CodeGraph databases.

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

## Self-assessment against the rubric

| Dimension | Score | Reason |
|---|---:|---|
| Reusability | 5 | Core packages prohibit product dependencies and require a second consumer. |
| Incremental migration | 5 | Capability-level flags, shadowing, and rollback are explicit. |
| Boundary clarity | 5 | Ports, package dependencies, composition ownership, and forbidden dependencies are defined. |
| Compatibility discipline | 5 | Conformance kits, source maps, golden traces, and exact pins prevent silent drift. |
| Frontend composability | 4 | Strong headless/slot design, but extraction remains substantial. |
| Runtime extensibility | 5 | Rich capability negotiation avoids a lowest-common-denominator adapter. |
| Operational safety | 4 | Security and recovery are explicit; implementation evidence is still pending. |
| Cloud resumability | 5 | Durable tasks, CAS leases, attempts, validation, and deterministic selection are specified. |
| Maintainability | 4 | Boundaries are strong, but the package count requires discipline. |
| Cost efficiency | 4 | Deterministic/scoped analysis is prioritized; full extraction remains expensive. |
| Provenance and sync | 5 | No duplicated source tree; locks, source maps, ownership, and licensing are explicit. |
| Time to first value | 4 | First executable runtime slice arrives early, though initial repository preservation is necessary. |

