# Swarm Consensus — Round 2 Rebuttal Packet

**Date:** 2026-07-26
**Slug:** agentic-frontend-control-and-tool-scale — Round 2
**Round 1 packet:** `CTX-agentic-frontend-control-and-tool-scale-2026-07-26.md` (read it first if you have not)
**Disclosure state:** INFORMED. Round 1 was blind. This round the Coordinator discloses its own withheld position, every cross-participant delta, and the evidence it gathered between rounds.

---

## What every participant independently converged on

Four positions were formed without sight of each other. These were unanimous. **Do not spend this round re-arguing them** — attack them only if you now think the consensus is wrong.

1. **The agent acts blind, and that is the largest gap — larger than discovery.** `AgentElementDescriptor` carries `{handle, role, label, labelTruncated, page}` and no state (`packages/chat-core/src/agentic/element-handles.ts`). `page.click` returns a synthesized receipt (`page-executor.ts:140`), not an observation. The example's own suggested prompt — "Check off 'Water the window plants'" (`examples/reference-web/src/AgentLab.tsx:268`) — cannot be verified by the agent that performs it.
2. **Discovery belongs in a tool *result*, never in `tools/list`** — it lives past the prompt-cache boundary, so a changing callable set costs nothing.
3. **Availability is resolved at call time, not list time.** List-time filtering is a token-economy hint; treating it as correctness opens a TOCTOU window that a closed tab makes real.
4. **`webmcp.ts` is duplicated, not dead.** `useChatPaneAgentControl.hooks.ts:15-26` re-declares the registration shape and `:249-259` rebuilds it by hand, while `toWebMcpTool` exists for exactly that.
5. **Tool-id namespacing is the primary one-way door.**
6. **`@jini/metatool` leaves the engine package set.**

---

## Coordinator findings, withheld in Round 1, now disclosed

The Coordinator's own frozen first pass agreed with all six points above. It was **wrong about two things**, both caught by peers and then verified independently:

**(a) "Routing exists; only discovery is missing" — false.** Routing does not exist end to end. `bindRun` is the required input to every capability call (`frontend-session-registry.ts:164` reads `runBindings` first) and it has **no caller and no wire field**. Verified at `39af3eba0`: `grep -c sessionId packages/http/src/runs.ts` → **0**; the only `bindRun` occurrences outside the registry itself are a `dist/` type declaration and a prose comment in `frontend-sessions.ts:28` delegating the job to "the composition root," which does not do it. Every capability call today fails at `frontend-session-registry.ts:167`.

**(b) "Delete `@jini/composio`" — false, and it would have repeated a recorded prior failure.** It is not a stub. `packages/composio/src/catalog.ts` contains a working tool-catalog design, verified by direct read: conservative safety classification from name/scope/description (`classifyConnectorToolSafety`), a three-way split between advertised `toolCount`, `curatedToolNames`, and a runtime `allowedToolNames` execution allowlist, cursor pagination (`toolsNextCursor`/`toolsHasMore`), and fail-closed `inputSchemaUnsupportedReason` making unparseable-schema tools display-only rather than callable. That is substantially the artifact Q2 asks to be invented.

**(c) A defect in code the Coordinator committed this morning.** `FrontendCapabilitySpec` (`frontend-capability-tools.ts`) is a **lossy** projection: `CapabilityDef` carries `inputSchema`, `risk`, and `surface`, and the factory discards all three, keeping only `id` / `description` / `requiresConfirmation`. No discovery design can be correct until that projection is lossless in neutral terms. This is conceded, not defended.

---

## The live disagreements — this is what Round 2 is for

### D1. What happens to `@jini/composio`? (the sharpest split)

- **Harvest it.** It already implements the catalog Q2 asks for; deleting it and then designing a catalog repeats the exact 2026-07-24 failure of rebuilding shipped code.
- **Keep isolated / incubating, do not promote.** Substantial consumer-never-built work; time-box a real packed consumer or a live-provider contract, otherwise archive. Three months of keeping it costs vendor drift, security maintenance, and accidental public-API commitment.
- **Delete outright** as "100% speculative dead weight."

**Coordinator ruling on method, which you may contest:** the delete verdict was reached from consumer count alone, without opening the file; the harvest verdict cited specific line ranges that were independently verified to exist. That position has therefore been **downweighted for this question only** — its Q1/Q2 analysis is retained in full. If you think consumer count is in fact the right test regardless of contents, argue it.

**Answer specifically:** is "a package with zero consumers but a verified, tested design for a problem we currently have" dead code or a solved sub-problem? What test distinguishes them, and does that test survive being applied to `ag-ui.ts` and `mcp-ui.ts` as well?

### D2. How many meta-tools, and what are they called?

Proposals ranged over `list_capabilities`; `search_tools` + `describe_tool`; and `discover_capabilities` + `describe_capability`. One position argues search and describe must be **separate** so full schemas are fetched only on demand; another argues one tool with a filter is enough at this scale.

**Answer specifically:** one tool or two? Does `describe` earn its own round trip at 18 capabilities, at 100, at 1000? Since these become MCP tool names that consumer prompts will hardcode, treat the naming as part of the one-way door.

### D3. Is the surface's capability claim authority or merely evidence?

An attaching surface sends `?capability=` and the registry stores it verbatim (`frontend-sessions.ts:147,168` → `frontend-session-registry.ts:185`). One position holds this is a **routing hint only** and must be intersected with a server-known manifest before dispatch — a claim is never execution authority. Nothing in the current code does that intersection.

**Answer specifically:** is this a real vulnerability given that `ToolPolicy` already gates every call, or is it defense-in-depth that costs more than it returns? What can a malicious surface actually achieve by over-claiming today?

### D4. Structured output is unbounded

`ToolExecutor` truncates only **string** output (`packages/daemon/src/tool-executor.ts:161`), and MCP then serializes the whole object (`tool-protocol.ts:41`). `page.find_elements` returns an unpaginated array with no cursor. A page with 5,000 tagged elements returns all of them into model context.

**Answer specifically:** is this fixed at the executor (byte-cap structured output), at the capability (pagination in the manifest), or both? Which is the one-way door?

### D5. Reconnect — grace period or fail fast?

`detach()` rejects pending calls and deletes every run binding (`frontend-session-registry.ts:190-199`). A reconnecting tab is minted a *new* `sessionId`, so nothing can re-bind an in-flight run; the unbind closure `bindRun` returns has no caller in any run lifecycle. Proposals: a `rebindRun(runId, oldSessionId, newSessionId)` with a short grace window and an expiring proof of prior ownership, versus an explicit "pause awaiting surface" run state, versus deliberate fail-fast.

**Answer specifically:** which, and does the answer change the wire format (i.e. is it a one-way door or a later addition)?

---

## What every participant must return

1. **Your position now**, per open question D1–D5.
2. **Whether it changed this round, and why.** "Unchanged" is a legitimate answer; say what would have changed it.
3. **The strongest argument against the currently-leading opposing position** — steelman it, then answer it.
4. **What evidence would move you.** Name a file, a measurement, or a test — not a general principle.
5. **Your ranked slate, revised.** Back the leading option with sample code or pseudocode, not prose alone.
6. Cite `path:line`. Mark claims measured / inferred / assumed. Under ~1500 words.

You may read anything in the repository except the coordinator's frozen first pass, which is stored outside it.
