# Swarm Consensus — Round 2: Technical Design & Architectural Pattern

**Date:** 2026-07-26
**Slug:** agentic-frontend-control — Round 2 (design)
**Round 1 packet:** `CTX-agentic-frontend-control-and-tool-scale-2026-07-26.md` — read it first for the architecture summary, measured facts, and constraints.
**Disclosure state:** INFORMED. Round 1 was blind; this round discloses the Coordinator's withheld position, every cross-participant delta, and evidence gathered between rounds.
**Mode change:** Round 1 asked *what* and *whether*. **Round 2 asks *how*.** The output of this round is a design that gets built. Implementation starts immediately after, unless the designs materially diverge — so answer at a level of detail someone can code from.

---

## SETTLED — do not re-argue

Five participants formed positions independently. These were unanimous. Treat them as premises. Contest one only if you have new evidence, and say so explicitly.

1. **The agent acts blind, and that is the largest gap.** Elements expose `{handle, role, label, labelTruncated, page}` and no state. No read verb. Actions return receipts, not observations.
2. **Discovery lives in a tool *result*, never in MCP `tools/list`.** Results sit past the prompt-cache boundary; the tool list stays byte-stable for the whole conversation. The repo has no `listChanged` support (measured) and the MCP server is spawned per run with its tool set fixed at construction.
3. **Availability is enforced at call time.** `resolveTarget` already fails closed naming what is missing; policy is deny-by-default. List-time filtering is advisory UX only. *Because the gate is at call time, every discovery scheme above it is reversible* — this is the load-bearing fact of the whole design.
4. **`webmcp.ts` is shadowed, not dead.** The chat hook hand-rolls the identical projection. Converge it.
5. **Tool-id namespacing is a one-way door.** Ids become tool ids verbatim and get baked into consumer prompts, policies, and audit records.
6. **`@jini/metatool` leaves the engine set.** Zero code imports; speculative by its own provenance doc.

### Also settled — the build plan Round 1 converged on

1. Compose the seam in `createLocalNodeDaemon`: construct the registry, mount the frontend-session routes via the existing `httpExtensions`, pass the manifest through `toolRegistrations`.
2. Add optional `frontendSessionId` to run-start; call `bindRun`; release the binding on terminal state.
3. Implement `ChatPaneAgentBridgeAccess` over the SSE + POST pair; retire `window.__jiniAgentLab`.
4. Add one meta-tool returning discovery as a tool result.
5. Fix the blindness (element state + a read verb), or step 4 buys nothing verifiable.

### Coordinator disclosures (withheld in Round 1)

- The Coordinator's frozen first pass agreed with all six points and independently proposed the same five-step plan.
- **It was wrong that "routing exists."** `bindRun` has no caller; `grep -c sessionId packages/http/src/runs.ts` → 0.
- **It was wrong to recommend deleting `@jini/composio`.** `packages/composio/src/catalog.ts` is a working tool-catalog design (safety classification, advertised/curated/allowlist three-way split, cursor pagination, fail-closed `inputSchemaUnsupportedReason`). Verified by direct read. The current disposition vote is harvest 1 / keep-parked 2 / delete 1, with the delete vote downweighted for judging on consumer count without opening the file. **Treat composio as KEPT for this round** and design so its catalog can slot in later without a rewrite.
- **A defect in code the Coordinator committed this morning, conceded:** `FrontendCapabilitySpec` is a lossy projection — `CapabilityDef` carries `inputSchema`, `risk`, and `surface`; the factory discards all three.
- **The example's readback is broken by construction** (found in Round 1, verified): `dom-page-driver.ts:40` prefers `data-agent-label` over `textContent`, and `AgentLab.tsx:244` labels the status span `"What happened most recently"` while wrapping `{status}`. Checkboxes expose `Item: <title>` and never `done`. The demo is unverifiable by the agent even once the seam is wired.
- **The repo's own `AGENTS.md` is stale**: it states `createLocalNodeDaemon` "does not exist." It does, and it is central to step 1.

---

## Q1 — End-to-end request flow

Trace **one** `page.click` from the moment the model decides to call it, to the moment the model sees the result. Cover every hop, every module, every failure branch.

Start from this skeleton and correct it where it is wrong or underspecified:

```
model → MCP tool call → daemon HTTP → ToolExecutor → ToolHandler
      → FrontendSessionRegistry.invoke → SSE frame → browser bridge
      → PageDriver → DOM → response POST → registry.settle
      → handler resolves → ToolExecutor post-processing → MCP result → model
```

Specify, concretely:

- **Every module the request passes through**, named by real file path where it exists, and by proposed path where it does not.
- **The data at each hop** — what shape crosses each boundary, and what is added, removed, or validated there.
- **Where each of these is enforced**, exactly once and no more: authorization; confirmation; input-schema validation; capability-claim checking; timeout; cancellation; output bounding; audit.
- **Every failure branch and what the model sees:** no surface bound; surface does not claim the capability; surface detached mid-call; surface never answers; handle not found on the page; field-fill refused by the credential guard; input fails schema; policy denies; output exceeds bounds.
- **What is new.** For each proposed new module or file: its path, its public signature, what it owns, what it must NOT know about, and which existing module it takes that responsibility from.

Be explicit about the **read/observation** design, since Round 1 made it the top gap: is it a new `page.read` verb, a state field on the element descriptor, a post-condition envelope returned by every write, or some combination? Show the actual shape.

## Q2 — What are we still missing?

Round 1 named: bind provenance and the run-start wire field; reconnect/rebind after reload (a reloaded tab gets a new daemon-minted session id and nothing re-binds); capability claims frozen at attach with no `updateCapabilities`; unbounded structured output (`ToolExecutor` truncates only strings; MCP serializes the whole object; `find_elements` has no cursor); surface claims never intersected with a server-known manifest; cross-frame/iframe drivers absent; no push notification when a surface detaches.

**Name what that list still misses.** Prioritize things that are cheap now and expensive after consumers exist. Operational and product concerns count — a human-visible activity trail of what the agent did to the user's screen was raised in Round 1 and never resolved.

## Q3 — Extension points (NEW — nobody covered this in Round 1, and it is the reason Jini exists)

Jini is an engine other products build on: Open Design, Open-Marketing, Tovu, Zana, each in its own repo, consuming published `@jini/*` packages. None of them may fork the engine, and the engine may not know they exist.

Design the extension surface. Concretely:

1. **How does a consumer register its own capabilities?** Its product has verbs the engine has never heard of — `cms.publish_draft`, `campaign.preview_send`. What is the public API, what does it hand in, and what does the engine guarantee back?
2. **How does a consumer supply its own `PageDriver`?** Its UI is not `data-agent-element`-tagged React; it may be Vue, a canvas, or a native shell. What is the port, and what is the smallest thing a consumer must implement to get all six page verbs?
3. **How does a consumer supply policy?** Deny-by-default is right, but each product has its own rules — a role, a plan tier, a per-workspace grant. Where does that plug in, and how does it see enough context to decide?
4. **What must NOT be extensible?** Name the invariants a consumer must be unable to break even deliberately: the single execution path, the audit trail, the credential-field refusal, session-id minting, and whatever else you identify. For each, say what mechanism enforces it rather than merely documenting it.
5. **What does a consumer's integration actually look like?** Show the code a product author writes — the smallest complete example. If it is more than roughly a screen of code, the extension design has failed.
6. **Versioning and compatibility.** These are published packages with no publish pipeline yet (constraint 7). What is the compatibility promise for a capability manifest, a descriptor, and a tool id across engine versions?

---

## Deliverable format — follow this so designs can be compared for divergence

Implementation begins after this round. Answers are compared section by section; a structured answer makes real disagreement visible and stylistic difference invisible.

1. **`## Flow`** — a numbered end-to-end trace. One line per hop: `N. <module path> — <what it does> — <data out>`.
2. **`## New modules`** — a table: proposed path | owns | public signature | must not know about.
3. **`## Observation design`** — the concrete shape for reading state back, with a code block.
4. **`## Missing`** — a ranked list. Each item: what, why it is cheap now and expensive later, and one-way door yes/no.
5. **`## Extension points`** — one subsection per Q3 item, with real signatures.
6. **`## Consumer example`** — the actual code a product author writes. Code block, not prose.
7. **`## Divergence flags`** — anything you believe the other participants will disagree with you about, stated plainly so it can be adjudicated instead of buried.

Rules: cite `path:line` for claims about existing code. Mark claims measured / inferred / assumed. Prefer real signatures over prose. Under ~2500 words — spend them on code and tables, not preamble. You may read anything in the repository except the Coordinator's frozen first pass, which is stored outside it.
