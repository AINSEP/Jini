# Jini Engine — "A" Architecture (corrected kernel + ports), for lock-in

Decision made: **Option A** — an abstracted daemon kernel with a typed port/route-pack contract, with **OD's daemon as the first adapter behind the facade** (so upstream OD fixes still `git format-patch` in). This doc folds in the five round-1 fixes. Round 2's job: break this against modularity / extensibility / scale / minimal-integration-complexity, then lock it.

## Core principle

The engine is a **small kernel + a registration contract**. Products don't modify the kernel; they *register* providers, tools, and route-packs and supply their own dependency bundle. OD is just the first product.

## The kernel (drawn at the true minimum — round-1 fix #1)

The kernel knows only these neutral nouns. NO projects, artifacts, design-systems, brands, marketplace in the kernel.

- **RunLifecycle** — start/stream/cancel/resume an agent turn; owns run state.
- **EventSink / EventBus** — the normalized run-event stream (versioned; ordering, replay cursor, idempotency key, cancellation — round-1 fix #4).
- **AgentExecutor** — spawns/drives a coding-agent process via `@jini/agent-runtime` (the existing add-a-file/zero-switchboard registry).
- **ToolRegistry** — discover + call tools, with a real **execution boundary**: authorization, confirmation, audit, timeout, result-size limit (round-1 fix #4). "Tools" = actions.
- **ProviderRegistry** — pluggable infra capabilities keyed by kind: model backends, storage, auth, db, deploy targets, etc. "Providers" = infra. (Terminology fix #5: never say "capability" — it's `Provider` xor `Tool`.)
- **Principal/AuthN** — request principal + authorization context (not just a credential store — round-1 fix #4).

## Composition contract (round-1 fixes #2 and #3 — no global port bag)

There is **no single `DaemonPorts` object**. Instead:

- Each **route-pack** (a cohesive feature: chat, runs, terminal, or an OD product feature) declares its OWN dependency interface: `deps: { runStore, eventSink, … }`.
- The composition function computes the **union** of all registered route-packs' deps and requires the host to satisfy exactly that union. `createDaemon({ routePacks, providers })` → the type system rejects a daemon whose route-packs need a dep no provider supplies. This is a real check (not the vacuous `K extends keyof DaemonPorts`).
- Kernel services (RunLifecycle/EventSink/AgentExecutor/ToolRegistry/ProviderRegistry) are always present; everything else is a route-pack dep.

## App-service layer (round-1 fix #4)

Business logic lives in an **app-service layer** consumed identically by BOTH transports. Route handlers are thin.

- `@jini/http` — HTTP/SSE transport; registers route-packs; no business logic.
- `@jini/cli` — first-class CLI (`--json`, `--prompt-file`) over the SAME app-services. Dual-track is a first-class contract, not an afterthought (this is a big part of "agent-ready": external agents drive the engine via CLI/HTTP/MCP).

## OD as first adapter + the OD-sync strategy (your `daemon/` requirement)

- The engine lifts only the **genuinely generic, stable** parts of OD's daemon that OD already treats as reusable: `agent-runtime` (runtimes/defs/parsers/discovery), `platform`, `sidecar`. These rarely change shape, so lifting them doesn't break OD-sync much.
- OD's **product daemon stays OD-shaped** as the first adapter (`products/open-design/daemon/`), registering OD route-packs (design-systems, brands, figma, deploy-of-designs) and supplying OD's dep bundle. Because it stays structurally close to OD, `git format-patch` from upstream OD keeps applying to it.
- Net: you keep OD-fix-sync where the churn actually is (the product daemon), while the kernel stays clean and neutral.

## Package set (~10 engine packages)

```
@jini/protocol        versioned wire types: run events, tool/provider descriptors, errors,
                      cancellation/replay/idempotency semantics (pure TS, no deps)
@jini/kernel          RunLifecycle, EventSink, AgentExecutor, ToolRegistry, ProviderRegistry,
                      Principal/AuthN, the createDaemon composition function, app-service layer
@jini/agent-runtime   runtimes registry + per-CLI defs + stream parsers + discovery (add-a-file)
@jini/persistence     run/event/conversation stores behind ports; sqlite default impl
@jini/http            HTTP/SSE transport + route-pack registration
@jini/cli             first-class CLI over the app-services (--json)
@jini/platform        OS process/file primitives (verbatim lift)
@jini/sidecar         NDJSON-IPC runtime (+ sidecar-proto; identity injected)
@jini/chat-core       framework-free chat types + pure parsers
@jini/chat-react      refactored ChatPane/ChatComposer → headless hooks + slots
@jini/artifacts-react renderer registry + srcDoc sandbox
@jini/components      generic primitives
# deferred until a 2nd host exists: @jini/desktop-host (electron/tauri + RenderService port)
```

## Products & consumers (separate repos, consume packed/published @jini/*)

```
products/open-design/   OD daemon adapter (format-patch target) + OD route-packs + design/brands/figma + OD web
                        (may live in its own repo; consumes @jini/* as published packages)
```
OD, Open-Marketing, Tovu-Runner are each their own repo consuming `@jini/*`. NO consumer-shaped folders inside the engine — only `examples/minimal-host/` (imports ONLY @jini/*, the neutrality lint target + CI smoke).

## Neutrality gate (round-1 fix #3 — prove, don't assert)

Acceptance for the kernel = a **non-OD fixture** (`examples/minimal-host`) boots `createDaemon` with a stub provider bundle (no project/design/artifact concepts) and completes a chat run + a tool call. API-snapshot review on every `@jini/*` public surface. NOT "OD still works."

## Automation (separate repo, per round-1)

AI-Dev-Shop (pipeline defs) + ADS-memory (durable decisions) + project-runner (execution runtime: queue/lease/sandbox). Consumed by Jini and every consumer alike; not inside the engine.

## Roadmap modules (bolt.diy WISHLIST — features to add later, NOT architecture to copy)

These are `ProviderRegistry`/`ToolRegistry` entries or small modules added when needed — they do not shape the kernel:
- `@jini/deploy` — Netlify / Vercel / GitHub Pages deploy-target providers.
- `code-exec` / live dev-server preview — a provider + preview-URL contract (impl later).
- `terminal` — PTY provider.
- diff-review + edit-lock — tool-execution-boundary UI helpers.

## The five round-1 fixes, mapped

1. Kernel drawn at true minimum (not de-branded ServerContext) → the kernel noun list above.
2. Real composition check (union of route-pack deps) not vacuous `PortsCoverRoutes`.
3. Neutrality proven by non-OD fixture boot + API snapshots.
4. Added: CLI package, shared app-service layer, protocol versioning/cancellation/replay, tool-exec security boundary, Principal/AuthN.
5. Terminology locked: `Provider` (infra) vs `Tool` (action); "capability" banned.
