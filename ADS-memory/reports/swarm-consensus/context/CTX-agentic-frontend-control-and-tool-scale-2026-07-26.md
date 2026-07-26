# Swarm Consensus Context Packet

**Date:** 2026-07-26
**Slug:** agentic-frontend-control-and-tool-scale
**Project Type:** brownfield
**Question:** For a general-purpose, product-neutral agent engine, (1) what is still structurally missing before an AI can fully drive a consumer product's frontend, (2) how should a tool catalog and its discovery work, (3) which parts of the existing agentic surface are dead or load-bearing, and (4) where exactly should the line fall between "make the demo work now" and "make this scale to hundreds of tools plus meta-tools that let an agent explore and reason about tools without flooding its context"?
**Intended Consumers:** Primary model + peer CLIs

---

## Goal

Produce a ranked slate of approaches the maintainer can act on this week, with the "now" work and the "scale" work explicitly separated, and with any recommendation stating what it would cost to reverse.

## Scope

**In scope:** the agent-facing capability/tool layer of the Jini engine — how a capability is declared, discovered, authorized, executed, and routed to a live browser surface; what belongs in the neutral engine vs. a consumer product; which existing modules are unused.

**Out of scope:** the chat UI's visual design; the CLI-agent process supervisor (`AgentExecutor`); persistence/storage engine choice; anything in the `AI-Dev-Shop/` pipeline toolkit.

---

## Architecture Summary

Jini is a headless, agent-drivable engine extracted from a product called Open Design. The engine (`packages/@jini/*`) must stay product-neutral; consumers live in other repos. Boundaries are CI-enforced (`pnpm guard`): engine packages may not import product or example code, and `@jini/protocol` may not import product DTOs.

**The tool-execution path that already exists and works, end to end:**

1. A CLI agent (e.g. `claude`) is spawned for a run. The daemon injects an MCP server into its launch config, scoped to exactly one `runId` (closed over at construction; never a model-supplied argument).
2. The model calls the MCP tool `execute_delegated_tool({toolId, input})`.
3. That posts to `POST /api/delegated-tool-calls`, which is the only caller of `createDelegatedToolBridge`.
4. The bridge calls `ToolExecutor`, which applies, in order: policy authorization (deny-by-default), human confirmation, timeout, cancellation, output truncation, and an audit record.
5. `ToolExecutor` looks the tool up in a `ToolRegistry` and invokes its handler.

**The browser-addressing layer, built but not yet wired to anything:**

- `FrontendSessionRegistry` (`packages/daemon/src/frontend-session-registry.ts`): a surface calls `attach({sessionId, capabilities}, deliver)` once when it opens; a run is later associated with the surface that originated it via `bindRun(runId, sessionId)`; a tool handler calls `invoke(runId, capabilityId, input, signal)` and awaits `settle(...)`. Attach and bind are separate because a chat pane mounts long before a run exists.
- HTTP transport (`packages/http/src/frontend-sessions.ts`): `GET /api/frontend-sessions/stream` (SSE; the daemon mints the session id and sends `{type:'attached'}` first) and `POST /api/frontend-sessions/:sessionId/responses`. There is deliberately no register/unregister pair — the connection *is* the session.
- `createFrontendCapabilityRegistrations` (`packages/daemon/src/frontend-capability-tools.ts`, committed today): turns a capability manifest into `ToolRegistration`s whose handlers do nothing but route through the registry — so a browser capability inherits the same `ToolExecutor` gate as a server-side tool.

**The capability vocabulary** (`packages/chat-core/src/agentic/`) is pure data — no DOM, no transport, no framework:
- 6 `page.*` verbs: `find_elements`, `highlight`, `scroll_to`, `click`, `fill`, `navigate`.
- 7 `chat.*` verbs: `send_message`, `set_draft`, `select_agent`, `cancel_run`, `reset_conversation`, `set_working_directory`, `get_state`.
- Each carries `{id, description, inputSchema, risk: 'read'|'write', surface: 'session'|'server', requiresConfirmation?}`.
- Elements are addressed only by a `data-agent-element` handle the page published — never a CSS selector, never `eval`, never a scan of `document`.
- Credential/payment/OTP/hidden/read-only/disabled fields are refused even when tagged.

---

## Measured Facts (verify these; do not take them on trust)

All measured on branch `feat/agentic-capability-layer` at commit `39af3eba0`, 2026-07-26.

**Tool surface as it exists today:**

| Layer | Count | Detail |
|---|---:|---|
| MCP tools an agent can actually see via `tools/list` | 6 | `start_run`, `get_run`, `cancel_run`, `get_active_context`, `list_agents`, `execute_delegated_tool` |
| Registered `ToolRegistry` ids across the repo | ~18 | 6 `page.*`, 7 `chat.*`, `terminal.create`, `daemon.db.{inspect,verify,vacuum}`, `deploy.publish` |
| Mechanisms that enumerate valid `toolId` values for an agent | **0** | `execute_delegated_tool` takes an unconstrained `toolId: string` |

**Reachability of the agentic modules** (`grep -rl <symbol> packages/*/src examples/*/src foundry`, excluding tests and the symbol's own module):

| Symbol / module | Non-test consumers outside its own file |
|---|---|
| `webmcp.ts` — `toWebMcpTool`, `toWebMcpTools` | barrel re-export only |
| `ag-ui.ts` — `toAgUiTool`, `toAgUiTools`, `createAgUiToolResult` | barrel re-export only |
| `mcp-ui.ts` — `MCP_UI_VIEW_METHODS`, `createPageActionRequest`, JSON-RPC helpers | barrel re-export only |
| `createFrontendSessionRegistry` | none — nothing constructs it yet |
| `PAGE_CAPABILITIES` | `chat-core` internals only — never registered as tools |
| `executePageCapability` | `examples/reference-web` only, via a browser global |
| `@jini/metatool` | 8 references, **all in `foundry/docs/**` prose** — zero code imports |
| `@jini/composio` | zero references anywhere in the repo |

Note one specific overlap: `useChatPaneAgentControl.hooks.ts` performs WebMCP tool registration by hand (a local `ModelContextLike` interface + `document.modelContext.registerTool`), while `webmcp.ts` — an adapter written for exactly that projection — is not imported by it.

**Where the demo currently stops:** in the example app (`examples/reference-web/src/AgentLab.tsx`), the six `page.*` verbs are reachable only through a browser global, `window.__jiniAgentLab.run(...)`. Its own comment states this is example-only and must stay so, "a global that drives the page is a capability handed to every script on it." `ChatPaneAgentBridgeAccess` (`packages/chat-react/src/features/chat-pane/types.ts`) is the declared browser-side contract; it has **zero implementations**. So an agent cannot today reach the page, and could not name a `toolId` for it if it could.

**Package count:** 23 shipped vs. 14 in the locked architecture set. Already diagnosed; the recorded fix is an admission-metadata manifest, not deletion.

---

## Constraints

1. **Product neutrality is CI-enforced.** No product identity strings, no imports from `foundry/**` or `examples/**` into `packages/@jini/**`. A design that requires the engine to know about a specific product is invalid.
2. **One execution path only.** Everything must route through `ToolExecutor`. A second path that reaches the same capability while skipping authorization/confirmation/audit is the specific failure this architecture exists to prevent.
3. **The one-way dependency edge.** Server packages (`daemon`, `http`, `core`) must not import the frontend vocabulary (`chat-core`). Structural typing is the established workaround.
4. **Availability is dynamic.** Whether a capability can be served depends on whether a live surface is attached and claims it. A purely static catalog cannot answer "what is callable right now."
5. **Do not add a package** before a second real consumer exists.
6. **Solo maintainer,** working in bounded sessions with LLM assistance. Any plan requiring sustained parallel effort across many weeks is not realistic.
7. **No external consumer exists yet.** There is no publish pipeline; the packed-tarball proof in `examples/minimal-host` is a known-red spec.

---

## The Four Questions

Answer each. Be adversarial: if a premise is wrong, say so and say why.

**Q1 — Full frontend control.** Beyond routing (which now exists) and discovery (which does not), what is *structurally* missing before an AI can drive a real consumer product's frontend? Consider at minimum: reading state back vs. acting; multi-page and multi-tab lifetime; a run outliving the surface that started it; observing the *result* of an action rather than assuming it worked; nested/sandboxed frames; the fact that a page's own `data-agent-*` labels are untrusted text that reaches a model. Name what is missing that this packet has not mentioned.

**Q2 — Tool catalog and discovery.** How should an agent learn which capabilities exist and which are callable *right now*? Candidate approaches, offered as options to critique rather than as a chosen answer — reject any or all and propose better:
- (a) Project MCP `tools/list` directly from the live registry, filtered by what the bound surface claims.
- (b) A persisted catalog (e.g. SQLite) plus a `search_capabilities` query tool. Note: a prior commit `c888dc35f` removed `capability_definitions`/`capability_executions` tables as unconsumed, which deleted the storage half without ever building the discovery half.
- (c) Tiered/progressive exposure — a small always-visible set that can unfold into more.
- (d) Keep one opaque `execute_delegated_tool` and describe the vocabulary in the system prompt instead.
State how each degrades at 10, 100, and 1000 capabilities, and what it does to prompt-cache stability when the callable set changes mid-conversation.

**Q3 — Refactor / dead code.** Given the reachability table above, what should happen to `webmcp.ts`, `ag-ui.ts`, `mcp-ui.ts`, `@jini/metatool`, and `@jini/composio`? Distinguish "unused because the consumer was never built" from "unused because it was speculative." What is the actual cost of keeping an unused-but-correct protocol adapter in a library intended for external consumption, versus deleting it and losing the design work? Is there a test that tells these two cases apart?

**Q4 — "Working now" vs. "scales later".** Draw the line concretely. Which decisions are cheap to reverse later (do the simple thing now) and which are one-way doors that must be right on the first attempt (pay now)? Specifically address: the wire format of a capability descriptor; the identity/namespacing scheme for tool ids; whether availability filtering happens at list time or call time; and whether meta-tools (tools that search, describe, or compose other tools) are a later addition or a load-bearing primitive that changes the design if retrofitted.

---

## Available Tooling — read whatever you want

**You have full read access to the repository.** Nothing is off-limits except one file: the
coordinator's own frozen first-pass answer, which has been physically moved outside the repo so
this round stays blind. Everything else — every package, every test, every design doc, every
prior debate transcript in `foundry/docs/jini-port/`, the `ADS-memory/reports/` history — is
yours to read. Read widely; the packet is a map, not the territory.

Two directories are worth a look and easy to miss: `packages/chat-core/src/agentic/` (the whole
capability vocabulary — 11 files) and its test suite `packages/chat-core/src/__tests__/agentic/`.
The tests encode intent the source doesn't state.

**Depending on how you were dispatched, you have one of two access modes:**

- *Native repo access* (`claude`, `codex`): your working directory is the real repo. You can run
  `rg`, read any path, and invoke the index tools below.
- *Staged tree* (`agy`): your working directory contains a filtered copy — `packages/`,
  `examples/`, `scripts/`, `foundry/`, `ADS-memory/reports/**.md`, and an `indexes/` folder
  holding `GRAPH_REPORT.md` and `knowledge-graph.json`. `node_modules`, `dist`, `coverage` and
  `.git` are excluded. Paths are otherwise identical to the real repo.

### Three code indexes exist — and all three are stale in a way that matters here

| index | what it answers | how to reach it (native mode) |
|---|---|---|
| **codebase-memory-mcp** (61.9K nodes / 153K edges) | does X exist, where, what calls it, trace a chain — BM25 + multi-hop, exact line ranges | `HOME=ADS-memory/.local-artifacts/codebase-memory-mcp-home AI-Dev-Shop/integrations/codebase-memory-mcp/bin/codebase-memory-mcp cli search_graph --help` (also `trace_path`, `query_graph`, `get_architecture`, `search_code`). Project arg is `Users-la-Programming-Jini`. |
| **Graphify** (12.8K nodes / 24.8K links) | whole-repo dependency paths, community structure | read `ADS-memory/reports/graphify-out/GRAPH_REPORT.md` and `graph.json` (12 MB) |
| **understand-anything** (2.5K nodes / 5.8K edges) | what is this for, what invariant does it hold, which layer | read `.understand-anything/knowledge-graph.json` (2.9 MB) |

**Measured staleness warning — read this before trusting any index result.** Both
codebase-memory and understand-anything record their build commit as `9cb4ffc50`. HEAD is
`39af3eba0`: **28 commits and 261 changed files later (+33,095 / −1,996 lines in
`packages/` + `examples/`)**.

The consequence is specific and severe for this debate: **the entire seam under discussion
postdates the indexes and is absent from them.** Verified by direct query —
`search_graph "frontend session registry attach bindRun"` returns `terminal-session.ts:370` and
ACP session code, not the registry; `search_graph "executePageCapability page driver"` returns
Python test fixtures from an unrelated eval suite. `frontend-session-registry.ts`,
`frontend-sessions.ts`, and `frontend-capability-tools.ts` are **not indexed at all**.

So: the indexes are genuinely useful for the *older surrounding* architecture — the tool
registry, the executor, the agent runtime, package dependency structure. They are worse than
useless for the new frontend-control seam. For anything in that seam, read the files directly or
use `rg`. If an index result contradicts a file, **the file wins**.

## Known Unknowns

- No production consumer has driven this surface; all evidence is from one example app.
- Prompt-cache behavior under a changing tool list is asserted by the maintainer but not measured here.
- Whether `data-agent-*` handle allowlisting is workable for a large real application, or collapses under the labeling burden, is untested at scale.
- The three code indexes in this repo were built 28 commits ago and are stale.

## Source-of-Truth Inputs

| Source | Notes |
|---|---|
| `packages/daemon/src/frontend-session-registry.ts` | Module doc states the attach/bind split and the three handled failure modes |
| `packages/daemon/src/frontend-capability-tools.ts` | Manifest → gated `ToolRegistration` projection |
| `packages/http/src/frontend-sessions.ts` | SSE + response routes; why no register/unregister pair |
| `packages/chat-core/src/agentic/*` | Capability vocabulary, page executor, guards, and the three unused adapters |
| `packages/core/src/tool-registry.ts` | `ToolDescriptor` / `ToolPolicy` / `ToolRegistration` shapes |
| `packages/mcp/src/server/tools/{delegated-tool,run-tools}.ts` | The 6 MCP tools an agent can currently see |
| `packages/chat-react/src/features/chat-pane/{types.ts,react/hooks/useChatPaneAgentControl.hooks.ts}` | `ChatPaneAgentBridgeAccess` contract; hand-rolled WebMCP registration |
| `examples/reference-web/src/{AgentLab.tsx,dom-page-driver.ts}` | The only live consumer; the browser-global stopgap |
| `git log`, `grep` sweeps | Counts and reachability in "Measured Facts", reproducible with the stated commands |

---

## Shared Prompt Payload

You are one of several independent models answering the same question. Do not assume the coordinator has already picked an answer — it has deliberately withheld its own position from you this round.

Read the packet above, then go read the repo — see "Available Tooling" for your access mode and for
why the three code indexes will mislead you on exactly this seam. Do not reason from the summary
alone; the summary is a map, the files are the territory. Then answer Q1–Q4.

Requirements for your reply:

1. **Return a ranked slate of at least two options** for the overall direction, with explicit ranking criteria, per-option trade-offs, one recommendation, and the cheapest test that would de-risk the recommendation.
2. **Attack the framing.** If a question embeds a false premise, or the real blocker is something the packet never names, say that first and explain why.
3. **Be concrete about reversibility.** For each recommendation, state what it costs to undo after three months of consumer code depends on it.
4. **Ground claims in the files.** Cite `path:line` when you assert something about the code. If you did not read a file, do not characterize it.
5. **Separate confidence from certainty.** Mark each significant claim as measured, inferred, or assumed.
6. Keep the total reply under roughly 2000 words. Depth over breadth; if you must cut, cut Q3 first.
