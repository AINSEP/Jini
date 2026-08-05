# Jini — Proposed Structure (debate subject, v1)

Grounded in read-only recon of open-design (OD), open-design-agentic, and the four consumers. This is the CURRENT PROPOSAL to be adversarially critiqued — not settled.

## Goal (binding)

Jini = a general-purpose reusable engine for MANY products, with NO Open Design tilt. OD is one consumer. Confirmed consumers: **Open Design** (design tool), **Open-Marketing** (OD-for-marketing; a full engine fork), **Zana** (bolt/lovable/replit-on-desktop; independent, re-derived the arch with zero @open-design imports), **Tovu-Runner** (desktop operator host; reuses engine, swaps only apps/web/src). Frontend must move to **Vite** (not Next; less memory). Chat UI = **refactored ChatPane/ChatComposer**, NOT CopilotKit (AG-UI only as an interop protocol via the existing agui-adapter).

## Harvest source

Primary source = **open-design-agentic** (most advanced trunk): already has Vite server option, ChatPane+ChatComposer decomposed into `features/chat-pane`+`features/chat-composer`, providers/dom split, agent-tools/browser-actions, plus the AI-Dev-Shop + ADS-memory automation harness. Fall back to OD main only where agentic lacks something.

## Repo strategy

Fresh empty `git init` (NOT gut-down of the 1.6GB OD copy). Preserve valuable branches via `git bundle` first. Populate package-by-package in dependency order with `git filter-repo`/`format-patch` to preserve authorship. Apache-2.0 + NOTICE crediting nexu-io/open-design. OD referenced for ongoing sync via a sibling blobless mirror (`--filter=blob:none`), never submodule/in-tree. Per-package `source-map.md` watermark + `scripts/sync-upstream.ts`.

## Top-level tree

```
jini/
├── packages/                         # THE ENGINE (@jini/*), product-neutral
│   ├── protocol/                     # generic DTOs/events/SSE carved from OD contracts (~8 pure files + agent-tools/)
│   ├── agent-runtime/                # runtimes/ registry + 25 CLI defs + 4 stream parsers + discovery + capability unions
│   ├── daemon-core/                  # createDaemon({ports}) composition root; 10 typed ports replacing any-typed ServerContext
│   ├── persistence/                  # SQLite run/event/conversation stores behind ports
│   ├── platform/                     # OS process/file primitives (verbatim lift)
│   ├── sidecar/                      # NDJSON-IPC runtime (verbatim lift)
│   ├── sidecar-proto/                # neutral; identity injected
│   ├── desktop-host/                 # host-adapter iface → electron + tauri impls; RenderService port
│   ├── chat-core/                    # framework-free types + pure parsers (no React/DOM)
│   ├── chat-react/                   # REFACTORED ChatPane/ChatComposer → headless hooks + presentational + slots
│   ├── artifacts-react/              # RendererRegistry + srcDoc sandbox
│   ├── workspace-react/              # app-shell layer: layout/panels/command-palette/settings/theming (candidate)
│   ├── components/                   # generic primitives
│   ├── agui-adapter/                 # AG-UI event encoder (existing, de-OD'd) — interop seam
│   ├── plugin-runtime/ registry-protocol/ metatool/ download/ diagnostics/ release/
│   ├── code-exec/                    # sandboxed exec + live dev-server preview (Zana needs; OD lacks) — CANDIDATE
│   ├── terminal/                     # PTY port (Zana/OM) — CANDIDATE
│   └── capability-registry/          # auth/storage/payments/db providers (Tovu/Zana) — CANDIDATE
│
├── integrations/
│   └── open-design/                  # THE OD ADAPTER (product-coupled)
│       ├── contracts/                # @od/contracts (~85 OD DTOs/prompts/analytics) → depends on @jini/protocol
│       ├── identity/                 # product name/appId/OD_* env/--od-stamp-* (injected)
│       ├── daemon/                   # OD product daemon (harvested decomposition) → consumes @jini/*
│       ├── web/                      # OD full feature-sliced Vite app (shell, providers, state, all OD features)
│       └── launcher-proto/
│
├── examples/reference-web/               # Vite+React reference host w/ fake transport
├── examples/minimal-host/            # ~35 lines, imports ONLY @jini/* — reusability proof + lint target
│
├── automation/                       # THE AI AUTOMATION LAYER (adopted from open-design-agentic)
│   ├── AI-Dev-Shop/                  # multi-agent delivery pipeline + skills + routing + spec-providers (adopt as-is)
│   ├── ADS-memory/                   # durable committed memory: governance/(constitution,adrs,contracts), sessions/, specs_as_built/(architecture.md+dependency-graph.yaml)
│   └── project-runner/               # the MISSING durable execution runtime: leases (git-ref CAS), queue, sandbox, resumable claim, sync-od, refresh-context
│
├── docs/ (architecture.md, extraction-plan.md, extraction-provenance.md, AGENTS.md)
├── scripts/ (guard.ts, check-engine-boundaries.ts, check-protocol-purity.ts)   # R1-R6 boundary rules incl. product-neutrality string scan
├── pnpm-workspace.yaml  package.json  tsconfig.base.json  LICENSE(Apache-2.0)  NOTICE
```

## Key architecture decisions

1. **Ports/adapters daemon.** `createDaemon({ports})` factory; OD product routes register via a `routeModules` opt-in array from foundry/integrations/open-design. `PortsCoverRoutes<>` compile-time check.
2. **Engine needs ports OD lacks** (code-exec/live-preview, terminal/PTY, capability-registry) so it isn't OD-shaped — driven by Zana/Tovu/OM.
3. **Boundary lint from commit 1** (R1 engine isolation, R3 protocol purity downward-only, R5 product-neutrality string scan — harvest Open-Marketing's existing `product-neutrality.test.ts`).
4. **Frontend = hybrid**: engine ships headless packages; each product is a Vite feature-sliced app implementing slots. Frontend restructuring (App shell, providers, state, router, all features) is a MAJOR workstream, not just ChatPane/Composer.
5. **Automation adopted, not invented**: AI-Dev-Shop + ADS-memory come from open-design-agentic; project-runner is the thin durable execution/lease runtime on top.
6. **Extraction = strangler**: OD stays green until the final adapter-wiring flip; every task carries characterization tests + mock-replay parity.

## Dependency-ordered extraction (high level)

protocol → agent-runtime ∥ persistence → daemon-core → generic routes → OD adapter wiring; in parallel: platform/sidecar/components leaves → desktop-host; chat-core → chat-react/artifacts-react → workspace-react → reference-web/minimal-host. Automation layer (AI-Dev-Shop/ADS-memory adopt + project-runner build) can proceed independently.

## Known open questions

- Is `workspace-react` (reusable app-shell) engine, or should the shell stay per-product?
- Are code-exec/terminal/capability-registry v1, or parked until a consumer needs them?
- ~19 engine packages — too granular? Should some merge?
- Does the automation/ layer belong IN the Jini repo, or as a separate repo consumed by it?
- Monorepo-per-product vs each consumer in its own repo consuming published @jini/*.
