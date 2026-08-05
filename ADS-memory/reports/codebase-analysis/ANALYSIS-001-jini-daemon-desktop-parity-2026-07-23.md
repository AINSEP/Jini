# Codebase Analysis: Jini daemon and desktop parity

- Analysis ID: ANALYSIS-001
- Date: 2026-07-23
- Analyst: CodeBase Analyzer Agent
- Parts: 1 of 1
- Jini revision: `a374e633ce6e45acadc7cbc9cb196816769326f0`
- Open Design revision: `958cc8871a9dace22c6c50f07a347c844892ae48`
- Scope: Jini daemon assembly, HTTP surface, browser host, desktop host, and the live Open Design daemon/desktop clone

## Post-analysis implementation update

Later on 2026-07-23, the missing visible-host slice identified by this report was
implemented:

- `examples/reference-web` is now a runnable Vite + React host using
  `@jini/chat-react` and the real daemon run/SSE protocol.
- `examples/reference-desktop` is now a runnable Electron consumer composed through
  `@jini/desktop-host`.
- `pnpm playground` builds the dependency closure, starts the daemon and renderer, then
  opens the same surface in Chrome and Electron.
- `examples/sample-projects/{starter-site,bug-hunt}` provide disposable workspaces.

This closes FLAW-001 for a reference host and materially narrows FLAW-004. It does not
claim full Open Design UI parity: the OD strangler adapter, artifact canvas, product
settings, and several product-owned control-plane journeys remain outside this slice.
The original analysis below is retained as the evidence that motivated the work.

## Sampling Notice

Files sampled: root/package manifests; `examples/reference-web/**`; `examples/minimal-host/**`;
`packages/{daemon,http,node-host,desktop-host,cli,mcp,sqlite,agent-runtime,chat-core}/**` entry
points, manifests, source maps, and representative composition files; current OD
`apps/{daemon,desktop,web}` manifests and graph-indexed entry points; the retained 2026-07-22 and
2026-07-23 route/live-parity reports.

Files excluded: most individual OD product route implementations, the full 390K-line OD web tree,
most package unit tests, generated `dist`/coverage output, and product-only Jini reference snapshots.
These were excluded because the question is whether a runnable neutral daemon and visible host exist,
not whether every OD product feature should move into the engine.

Confidence levels by finding category:

- Architecture structure: High
- Dependency direction: High
- Test coverage signal: Medium
- Security surface: Medium
- Code quality indicators: Medium

Note: Confidence reflects sample coverage, not model certainty. Important runtime claims are handed
to a subsequent live-verification stage instead of being inferred from static code alone.

## Executive Summary

- Language/Framework: TypeScript; Express daemon; React UI packages; structural Electron/Tauri host adapters.
- Apparent Pattern Intent: neutral headless engine plus product-owned browser/desktop shells.
- Indexed size: Jini 57,295 nodes / 142,053 edges; OD 286,862 nodes / 425,124 edges.
- Source-size signal: OD daemon 460 files / 174,158 LOC; Jini's selected daemon-spine packages
  463 files / 95,653 LOC. These are not like-for-like feature counts and include tests, so they are
  only a scale signal.
- Severity Counts: Critical: 1 | High: 3 | Medium: 4 | Low: 0
- Current State Classification: Headless daemon runnable; user-visible host absent.

The repository has advanced materially beyond the stale 2026-07-18 status reports:
`@jini/node-host#createLocalNodeDaemon` now assembles SQLite durability, lifecycle, agent execution,
Express, security middleware, and a broad generic route set. `examples/minimal-host` exercises a
real HTTP lifecycle and real ACP subprocess fixture. The current blocker is no longer “there is no
daemon”; it is “there is no Jini application shell to look at.”

`examples/reference-web` is only a README and a package manifest: zero `src/**` files, zero runtime
dependencies, and no `dev`, `build`, or `start` script. `@jini/desktop-host` is a real and tested
library, but deliberately takes injected structural Electron/Tauri APIs; it has no `electron` or
`@tauri-apps/*` dependency, no `main` entry, no renderer, and no packaging config. Therefore no
current command can open “the Jini app” in Chrome or as a desktop window.

## Parity Matrix

| Surface | Open Design | Jini now | Assessment |
|---|---|---|---|
| Daemon process | Product daemon with CLI/bootstrap and hundreds of product routes | `createLocalNodeDaemon` is real and runnable | Neutral core boot parity exists |
| Durable run lifecycle | Product DB/event persistence and recovery | SQLite `EventLog`, rehydrate, create/stream/reconnect/cancel/restart-replay | Strong generic parity; live check required |
| Coding-agent subprocess | OD runtime registry and multiple stream formats | Default `AgentExecutor`, 24 registered defs per current source comments, ACP fixture in minimal host | Substrate present; consumer prompt/cwd policy remains host-owned |
| HTTP | 345 graph-indexed unique `/api` method+path endpoints, mostly product-specific | Broad generic route packs; node host auto-mounts runs, agents, memory, terminals, provider proxy, media, connectors, research, xAI, health and daemon ops | Raw endpoint percentage is misleading; generic-family parity is substantial, product parity is intentionally absent |
| Run endpoints | 13 `/api/runs*` endpoints including product GenUI/feedback/result surfaces | Basic create/list/get/cancel/native SSE; AG-UI projection exists separately | Core lifecycle parity, not OD product-run parity |
| Provider proxy | Anthropic/OpenAI/Azure/Google/Ollama + catch-all | Same five providers + catch-all after July 22 fixes | Route-family parity achieved; several wire paths were live-audited |
| Health/ready/version | `/api/health`, `/api/ready`, `/api/version` | Same API routes plus bare variants | Mostly parity; version payload deliberately remains simpler |
| Research/xAI | Product routes | Present and live-diffed on 2026-07-23 | Known divergences documented and intentional |
| Connectors | OD connector catalog/OAuth/Composio product surface | Generic auth/storage/payments/db/realtime capability-provider routes | Different abstraction, not endpoint parity |
| Product routes | Projects, artifacts, design systems, brands, plugins, marketplace, Figma, etc. | Excluded from `@jini/*` | Correct neutrality boundary, not a gap |
| OD adapter | Full OD daemon is the consumer to strangle behind Jini | `foundry/integrations/open-design` contains reference snapshots/manifest/tests, not a runnable adapter daemon | No consumer parity proof yet |
| Browser app | Full Next web product | `examples/reference-web` has no implementation | Absent |
| Desktop app | Real Electron package/runtime plus product shell/updater | Structural Electron/Tauri adapter library only | No runnable desktop shell |
| UI parity | Full OD web product | Reusable `chat-*`, `renderers-react`, and `ui` packages | Package fragments exist; no integrated visual parity target |

## Findings

### FLAW-001

- Severity: Critical
- Category: Missing runnable user journey
- Location: `examples/reference-web/package.json`, `examples/reference-web/README.md`,
  `packages/desktop-host/package.json`

There is no browser or desktop application to launch. The browser host has no source or scripts.
The desktop package is intentionally a library of ports/adapters, not an executable app. This blocks
the requested workflow: visually inspect Jini, compare it with OD, then test/install the chat
agentic control plane.

Evidence:

- `examples/reference-web` has exactly two files and zero `src/**` files.
- Its manifest contains only name/version/private/type.
- `@jini/desktop-host` exports compiled library modules and depends only on `@jini/core`.
- Its source map explicitly says Electron/Tauri are injected structural surfaces and the package
  does not depend on the real native runtimes.

### FLAW-002

- Severity: High
- Category: Consumer integration gap
- Location: `foundry/integrations/open-design/`

The locked strangler adapter has not become a runnable OD consumer. The directory contains the
sync-ownership artifacts and frozen references, but no live daemon composition or web/desktop
application. Jini therefore cannot yet prove that real Open Design boots against packed Jini
packages.

### FLAW-003

- Severity: High
- Category: Parity evidence gap
- Location: `packages/http`, `packages/node-host`, retained parity reports

The newest live comparison explicitly says the baseline routes—runs, agents, native run stream,
terminals, routines, host tools, memory, and DB ops—have not all been live-diffed against OD.
Provider, health, research, and xAI work has strong live evidence; the core interactive control
plane does not yet have one consolidated OD-vs-Jini characterization harness.

### FLAW-004

- Severity: High
- Category: Missing visible composition root
- Location: `packages/chat-core`, `packages/chat-react`, `packages/renderers-react`,
  `packages/ui`, `examples/reference-web`

Reusable UI pieces cannot be evaluated as an app because there is no renderer composition, real
transport binding, routing shell, settings surface, or desktop bridge integration. Package-local
tests cannot establish visual/interaction parity with OD.

### FLAW-005

- Severity: Medium
- Category: Runtime reachability
- Location: `packages/node-host/src/create-local-node-daemon.ts`

The node-host preset auto-mounts a large generic route set, but several implemented surfaces are not
mounted there: routines, delegated tool calls, and the AG-UI run-stream projection. They may be
composed by a consumer pack, but the default “zero-interface boot” does not expose them.

### FLAW-006

- Severity: Medium
- Category: Contract divergence
- Location: `packages/http/src/health.ts`, `research.ts`, `xai.ts`

Some wire divergences are deliberate and documented rather than bugs: the version response is
simpler than OD, research uses Jini's generic not-configured/error convention, and xAI fields/copy
differ. A future OD adapter must translate these where exact consumer compatibility matters.

### FLAW-007

- Severity: Medium
- Category: Agent-host contract
- Location: `packages/node-host/src/create-local-node-daemon.ts`

`CreateLocalNodeDaemonConfig.agents` remains accepted but unused. The host does have a real default
agent executor and registry definitions, and can run through `resolveRunInput`, but the public
configuration surface suggests agent injection that is not implemented.

### FLAW-008

- Severity: Medium
- Category: Status-document drift
- Location: root `AGENTS.md`, `ADS-memory/reports/jini-port/refactor-roadmap.md`,
  `ADS-memory/reports/od-port-status-2026-07-18.md`

Several authoritative-looking status sections still say there is no runnable daemon and that core
packages are placeholders. That was true on July 18 and is false at the sampled July 22 revision.
This drift makes it easy to plan against the wrong bottleneck.

## Test Coverage Signal

- `@jini/node-host`, `@jini/desktop-host`, daemon, HTTP, SQLite, agent runtime, and minimal host all
  declare real test commands and contain extensive test files.
- The minimal host is designed as the packed-tarball release-set proof and covers create, stream,
  reconnect, cancel, restart/replay, and ACP permission flow.
- `examples/reference-web` has no test command because it has no implementation.
- No claim about current pass/fail state is made in this analysis stage; live execution is assigned
  to TestRunner/QA after this report.

## What Was Not Analyzed

- Pixel-level or interaction-level OD UI parity, because Jini has no app surface to compare.
- Every OD route implementation; product-only route families were classified using the existing
  exhaustive route inventory and targeted graph queries.
- Installer/updater parity; locked architecture explicitly keeps those consumer-owned.
- Real vendor credentials and successful live model/OAuth calls.

## Recommended Next Step

1. Live-boot `examples/minimal-host` and a persistent `createLocalNodeDaemon`, inventory the actual
   registered routes, and probe liveness/readiness/status.
2. Confirm the browser and native entry points fail for the expected structural reason—not an
   install issue.
3. Treat a visible Jini shell as a new implementation slice:
   - build `examples/reference-web` first with the real Jini HTTP transport;
   - wrap that same URL in a minimal Electron consumer app using `@jini/desktop-host`;
   - defer updater/installer/product-only OD features;
   - add one OD-vs-Jini user-journey parity matrix for chat, streaming, cancel, reconnect,
     confirmations, terminal/tools, settings, and desktop bridge.

That visible-shell work changes the repo and should enter the normal Spec → architecture approval →
TDD → Programmer path after the live-verification evidence is reviewed.
