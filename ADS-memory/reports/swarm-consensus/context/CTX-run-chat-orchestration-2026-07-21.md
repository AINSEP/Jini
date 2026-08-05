# Swarm Consensus Context Packet

**Date:** 2026-07-21
**Slug:** run-chat-orchestration
**Project Type:** brownfield
**Question:** What should Jini's run/chat orchestration layer look like, and how should it be built?
**Intended Consumers:** Primary model + peer CLIs (Claude, agy/Gemini, Codex)

## Goal

Jini is a headless, product-neutral, agent-drivable engine extracted from a real product (Open Design, "OD"). It is meant to be consumed as a library by multiple downstream products, each in their own repo: a WordPress-alternative CMS, a desktop shell for that CMS, an AI-driven app-builder (bolt.diy/Lovable-shaped), and a sibling "OD for marketing" product. None of these downstream products exist inside this repo — Jini must stay free of any single consumer's product concepts.

Several kernel primitives are already built and independently tested:

- **`RunLifecycle`** (`packages/daemon/src/run-lifecycle.ts`) — the durable state machine for one agent invocation: `start()`, `emit()`, `finish()`, `onCancelRequested()`, `waitForTerminal()`. Keys every run on one opaque `contextRef: string` — the kernel has no `Project`/`Conversation` noun.
- **`AgentExecutor`** (`packages/daemon/src/agent-executor.ts`) — an in-process `RunLifecycle` driver that spawns a real subprocess for a coding-agent CLI, translates its output into a canonical event vocabulary, and calls `finish()` on completion. It drives the large majority of the registry's 24 agent definitions across four wire-protocol shapes (JSON-stream-tail parsers, ACP JSON-RPC, a pi-rpc JSON-RPC variant, and raw-passthrough "plain" streaming) — **read the file directly for the exact current count and per-format dispatch shape; other work in this same repo is landing on this file concurrently with this debate, so treat any specific number here as approximate.** Its `run(input)` method takes `{runId, agentId, prompt, cwd, env?}` — **`prompt` must already be a fully composed string; `AgentExecutor` does nothing to it.** This is a deliberate, already-documented boundary in the existing code, not an oversight. Note: this file's per-format dispatch pattern (a new `if (streamFormat === '<format>')` branch added alongside the existing ones, each with its own `wire<Format>Lifecycle` helper where the format needs one) is itself directly relevant precedent for gap 3 below — read it as a worked example of "how does a new behavior usually get added to this exact module," not just as a description.
- **`ToolExecutor`/`ToolRegistry`** (`packages/core/src/tool-registry.ts`, `packages/daemon/src/tool-executor.ts`) — a real authorization gate for invoking a named `Tool`: `{descriptor, handler, policy}` registration, `ToolPolicy.authorize()` returns `allow`/`deny`, and every call produces a durable audit trail (`requested → authorized → started → completed/timed-out/cancelled/denied`). This was exercised today by wiring a new capability (`deploy.publish`) behind a deny-by-default policy — the pattern is proven and in active use, not speculative.
- **HTTP/CLI transports** over all of the above (`packages/http`, `packages/cli`) — e.g. `POST /api/runs` durably creates a run record, then hands control to a **host-supplied** `onStarted` callback. There is no default wiring shipped anywhere that automatically starts driving a created run with `AgentExecutor`.

## Scope

**In scope for this question:** the layer that turns "a user sends a message" into "an agent actually runs, streams back useful output, and the conversation continues correctly across multiple turns." Five concrete capability gaps exist today, all confirmed absent (not partially built) by reading the actual source:

1. **No default run→agent execution composition.** `POST /api/runs` creates the run record and calls a host-supplied `onStarted(run, lifecycle)` — nothing in this repo ships a default implementation that wires `RunLifecycle` to `AgentExecutor` automatically. Every consumer must hand-assemble this today.
2. **No prompt/skill/memory composition.** `AgentExecutor.run()` receives an already-composed `prompt: string` and does nothing to it (documented boundary, see above). Nothing in this repo today takes a raw user message plus relevant memory notes plus skill/reference files plus a system prompt and combines them into what actually gets sent to an agent. In OD, this composition is deeply entangled with OD's own product concepts (project, conversation, design-system) and is not portable as-is.
3. **No multi-turn tool-result injection.** When an agent's turn ends because it wants to call a tool (e.g. a stream reports `stop_reason: 'tool_use'`), the current code unconditionally closes the child's stdin rather than injecting the tool's result back into the conversation and continuing. There is no real multi-turn loop today — a turn that wants to call a tool and continue just stops.
4. **No retry classification.** Every `RunLifecycle.finish()` call in the current code passes `resumable: false`, unconditionally, because no failure classifier exists anywhere in this repo to decide whether a given failure is worth retrying. (OD's own real classifier is a large, per-vendor-CLI text-matching heuristic across ~20 different CLI failure-message formats — it was deliberately never ported, as a separate, unscoped concern.)
5. **No agent-session resume.** Some of the already-wired agent CLIs report a resumable session handle in their own output (e.g. one JSON-stream format's `sessionID` field, another's `thread_id`). The existing event-translation code silently drops these fields today — nothing persists or replays them, so a "continue this exact CLI conversation on a later turn" capability that the underlying CLI already supports is currently unusable through this engine.

Two additional structural concerns were identified in a pre-dispatch gap scan and must be addressed by every option, not treated as a later add-on:

6. **Prompt-injection surface.** Whatever mechanism ends up composing prompts (gap 2) and whatever mechanism ends up injecting tool results back into a running conversation (gap 3) both feed content into a live agent conversation that was not typed by the current human user — respectively, content from possibly-agent-written memory notes, and content from a tool's own output. Either is a plausible vector for a malicious or corrupted payload to inject fake conversational turns, role markers, or instructions. State explicitly how each option's design addresses or fails to address this.
7. **Observability of composed/injected content.** If a run misbehaves, can a developer see the exact prompt that was actually sent, and the exact tool-result content that was actually injected mid-conversation? State explicitly what each option does or does not provide here.

**Out of scope for this question** (already decided or already deferred elsewhere, do not re-litigate): whether Jini should host an MCP server (a separate, already-resolved decision to build MCP hosting infrastructure now); the plugin-host / signed-third-party-pack question (proposal exists, awaiting separate sign-off); which specific coding-agent CLIs are supported (24 already registered, driving status is a separate, ongoing effort).

## Architecture Summary

Everything currently built follows one consistent pattern across this whole codebase: **the kernel ships mechanism, never product policy, and every point where a real decision must be made is an explicit, host-supplied injection point with a conservative (usually deny-by-default or no-op) default.** Concrete precedents already in this exact repo:

- `ToolPolicy` has no default that allows anything — a host must explicitly supply a policy, or the default denies every call.
- `AgentExecutor`'s `onCleanupFailure`, `acpPermissionHandler`, `attachAcpSession`/`attachPiRpcSession` are all injectable, defaulting to the real implementation but always overridable, and the module never silently invents its own opinion about what a "correct" agent invocation looks like beyond mechanical wiring.
- `resolveDaemonUrl` (CLI transport) resolves through an explicit precedence chain (flag → env var → injected discovery callback → default) and throws rather than silently guessing when nothing resolves.
- Every "was this dropped or is it deliberately absent" question in this codebase's own documentation is answered explicitly (a `source-map.md` per package records exactly what was ported, what was generalized, and what was deliberately excluded and why) — there is no tolerance in this codebase for a capability quietly becoming someone's undocumented assumption.

## Relevant Files And Artifacts

| Path | Why it matters |
|---|---|
| `packages/daemon/src/run-lifecycle.ts` | The durable run state machine gaps 1, 3, 4, 5 all attach to. |
| `packages/daemon/src/agent-executor.ts` | Where gap 3 (tool-result injection) would need to hook in if it lives at this layer; already has 3 format-specific dispatch branches (JSON-stream, ACP, pi-rpc) as a precedent for how a new behavior gets added without disturbing the others. |
| `packages/core/src/tool-registry.ts`, `packages/daemon/src/tool-executor.ts` | The existing authorization/audit boundary gap 3's tool-result injection must compose with, not duplicate. |
| `packages/http/src/runs.ts` | Where gap 1 (default run→agent wiring) would attach if it lives at the HTTP layer instead of the daemon layer — `RunStartHandler` is the existing host-supplied extension point. |
| `packages/memory/src/llm-provider.ts` | A generic (already-built, today) "call one of N LLM HTTP APIs with a system+user prompt" primitive — relevant precedent for what a *building block* Jini could own (as opposed to a full composition *policy*) might look like, if any option proposes Jini owning composition tooling short of an opinionated pipeline. |
| `packages/daemon/source-map.md` | Full design-decision history for every already-built piece named above, including explicit "why NOT built this way" reasoning for related past decisions. |
| `ADS-memory/reports/jini-port/extraction-plan.md` | The locked kernel-noun boundary (`Run`, `Agent`, `Tool`, `EventLog`, `Principal` — explicitly no `Project`/`Conversation`/`Brand`/`DesignSystem`) that any option must not violate. |

## Constraints

- **No product nouns in the kernel.** The locked architecture (`extraction-plan.md`) explicitly excludes `Project`, `Conversation`, `Brand`, `DesignSystem` from the kernel vocabulary. Any option that requires Jini itself to understand "what a project is" or "what a conversation's history looks like" beyond the opaque `contextRef` string is out of bounds.
- **Composition must not become a second, competing authorization path.** If any option's tool-result-injection design touches tool invocation at all, it must compose with the existing `ToolExecutor`/`ToolRegistry` gate — inventing a parallel mechanism was explicitly rejected for a similar past decision (the plugin-host proposal) and that reasoning should be treated as binding precedent, not re-argued from scratch.
- **Multiple real downstream consumers, not one.** Whatever gets built will be used by at least four different products with materially different needs (a CMS, a desktop app, an AI app-builder, a marketing-design tool). A design that only happens to work for one shape of product (e.g., only single-turn tool use, or only one memory-storage backend) is a real failure mode, not a hypothetical one.
- **Everything shipped needs the same rigor already established on this branch today**: real tests (not just "the code runs"), no coverage achieved by deleting real capability, and an explicit source-map write-up of every design decision and every deliberately-excluded capability.

## Known Unknowns

- Whether prompt/skill/memory composition (gap 2) should be a Jini-owned package at all, or an explicitly-never-Jini's-job downstream concern, is genuinely undecided — this is one of the central questions this debate exists to resolve, not a settled premise.
- Whether retry classification (gap 4) should ship any default policy (even a conservative one) or must always be a bare host-supplied port with zero default behavior is undecided.
- Whether session-resume persistence (gap 5) needs new storage beyond what `RunLifecycle`'s existing `EventLog` already provides, or can be built entirely on top of it, has not been investigated.
- Whether these five gaps should be closed by one cohesive new architectural layer, or as five separately-shippable, independently-useful increments to existing packages, is undecided.

## Source-of-Truth Inputs

| Source | Notes |
|---|---|
| `packages/daemon/src/agent-executor.ts` (current state on this branch) | The actual code implementing the "already built" primitives described above — read directly, not from a summary, before proposing any design that touches it. |
| `packages/daemon/source-map.md` | Full provenance and design-decision history, including several already-resolved "why not X" calls whose reasoning is directly relevant here (e.g. why `resumable` is hardcoded `false` today, why ACP's native tool permission and Jini's own tool execution are kept as two explicit separate paths). |
| `ADS-memory/reports/jini-port/extraction-plan.md` | The locked kernel-noun boundary and the composition model (`Packs own their app-services; kernel owns orchestration only`) this question sits inside of. |

## Shared Prompt Payload

<<<See the Round 1 peer prompt in the same directory / dispatch packet — kept as a separate file so this context packet stays a stable, reusable artifact independent of which specific round is being dispatched.>>>
