# Swarm Consensus Report — Agentic Frontend Control & Tool Scale

**Date:** 2026-07-26
**Mode:** `debate`, 2 rounds (Round 1 blind / Round 2 informed design)
**Repo:** `/Users/la/Programming/Jini`, branch `feat/agentic-capability-layer` @ `39af3eba0`
**Controls:** `max_rounds=2`, `min_confidence=0.90`, `swarm_timeout_seconds=300`
**Packets:** `../context/CTX-agentic-frontend-control-and-tool-scale-2026-07-26.md` (R1), `../context/CTX-agentic-round2-design-2026-07-26.md` (R2)

---

## The Swarm

| Role | Participant | Model | Proof | Rounds |
|---|---|---|---|---|
| **Primary** | Claude Code session (host) | `claude-opus-5[1m]` | host session | R1 frozen, R2 frozen |
| Peer | Claude CLI | `claude-opus-5` | smoke-proven 2026-07-26 (`…154519Z-claude-discovery.md`, `json_ok:true`) | R1, R2 |
| Peer | Codex CLI | `gpt-5.6-sol` @ `model_reasoning_effort=xhigh` | exact id from `~/.codex/config.toml` + live probe | R1, R2 |
| Peer | agy (Gemini) | `gemini-3.1-pro-high` | exact id from `agy models` + live probe | R1, R2 — **Q3/R1 discounted** |
| **In-host subagent** (Addition case) | Fable | `claude-fable-5` | host-resolved | R1, R2 |
| Peer | agy (Gemini) | `gemini-3.6-flash-high` | exact id + live probe | **excluded — `peer_timeout`** |

Primary row non-empty; primary subsection present. Report is valid (not a peer-only run).

## Dispatch Diagnostics

**Method deviations, disclosed rather than glossed:**

1. **Handshake gate adapted.** The framework requires a packet-bound ACK within 60 s *before* the substantive timer. Four liveness probes (all returning `OK`) were substituted, with the ACK line required as the first line of each substantive reply. **Limitation:** `agy` is a buffered (Tier 2) transport — nothing streams — so for that peer the adaptation provides *zero* early warning, which is exactly the failure mode the 60 s gate exists to catch. All returned replies carried a valid packet-bound ACK.
2. **Claude peer tool surface restricted** to `Read,Grep,Glob` (no `Bash`). Full shell in headless mode requires `--dangerously-skip-permissions`, granting write access to the repo to a read-only participant. Cost: that peer could not invoke the cbm CLI — near-zero impact, since the indexes do not contain the seam under debate.
3. **`gemini-3.6-flash-high` excluded** after two attempts: first `Error: timeout waiting for response` at the 5 m default, then a 15 m run stopped at ~12 m as non-productive (Pro completed the same task in ~2 m). Classified `peer_timeout`, not silently dropped.
4. **Gemini 3.1 Pro discounted on R1/Q3 only.** It returned a delete verdict on `@jini/composio` derived from consumer count without opening the file, while the peer that opened it produced citations independently verified as accurate. Its Q1/Q2/R2 work is retained in full. This is a methodological discount, not a penalty for disagreeing.

**Environment defects found and fixed/recorded:**

- `last-known-good.json` carried artifact paths under `/Users/la/Desktop/Programming/Jini/…` — dead since the repo moved. Repaired in place; a fresh `--discover-claude` run then proved `claude-opus-5`.
- **`peer-llm-dispatch.md` is stale in two ways.** Its canonical `agy` invocation omits any permissions flag, so a dispatch needing file tools returns **empty stdout with exit 0** — silent failure — contradicting the same document's "file context is the default, staged, not denied." Its model-string format (`"Gemini 3.1 Pro (High)"`) no longer matches `agy models` (`gemini-3.1-pro-high`), and the doc itself warns a wrong format hangs indefinitely.
- `~/.gemini/antigravity-cli/settings.json` `permissions.allow` held only 5 entries, none of them read tools. Read-only tool entries were added (backed up first) — **but this did not resolve the failure**, because agy's error names a literal placeholder `command(<target>)` and never reveals which tool it denied. The reliable path remains `--dangerously-skip-permissions` **paired with a disposable staged working directory**, where the flag is contained by construction rather than by trust.
- **All three code indexes are stale at `9cb4ffc50`, 28 commits / 261 files behind**, and verifiably do not contain the seam under debate (`search_graph "frontend session registry attach bindRun"` returns `terminal-session.ts` and ACP code). Note `index_status` reports the *current* `head_sha` because it reads git live — it is not evidence of freshness.

---

## Individual Responses

### Primary — `claude-opus-5[1m]` (frozen both rounds)
R1: identified blindness as the top gap; discovery-in-tool-result; call-time availability; `webmcp.ts` bypassed-not-dead; namespacing as the one-way door. **Wrong on two counts:** claimed routing existed end-to-end (it does not — `bindRun` has no caller), and recommended deleting `@jini/composio` before reading `catalog.ts`. R2: proposed `CapabilityProvider` bundling manifest+policy+execute with namespace ownership enforced by prefix assertion; state on descriptor; one meta-tool.

### Peer — `claude-opus-5`
R1: proved routing does not exist (`grep -c sessionId packages/http/src/runs.ts` → 0); proved no `list_changed` support anywhere; identified composio's catalog as the artifact Q2 asks to invent. R2: **found the confused-deputy hole in `frontendSessionId`** and proposed `bindToken`; `settle?()` quiescence with honest `settled:false`; `PageChange[]` diff; `MinimalPageDriver` (5 methods → 8 via adapter); `valueWithheld`.

### Peer — `gpt-5.6-sol` @ xhigh
R1: found `FrontendCapabilitySpec` is a **lossy** projection dropping `inputSchema`/`risk`/`surface`; surface claims are unverified evidence, not authority; `ToolExecutor` truncates strings only. R2: **found that `createLocalNodeDaemon` mounts neither `registerDelegatedToolRoutes` nor MCP injection** — the settled plan was incomplete; **found the WebMCP hook path bypasses `ToolExecutor` entirely** — a second execution path already in shipped code; oversized structured output should fail atomically rather than truncate; `revision`/`pageRevision` for optimistic concurrency; `value: {kind:'redacted'}`.

### Peer — `gemini-3.1-pro-high`
R1: strong on scale/cache analysis and the three-tier degradation matrix; **Q3 discounted** (see Diagnostics). R2: 18-step flow matching the others hop-for-hop; corrected `describe()` implementation with `checked`/`value`/`disabled`/`visible`; `run-session-binding.ts` lifecycle module; proposed `ToolPolicy.authorize` gain a third return value `'confirm'`. Extension-points section was the weakest — largely restated existing types, invariants stated as documentation rather than mechanism.

### In-host subagent — Fable
R1: **found the demo's readback is broken by construction** (`dom-page-driver.ts:40` prefers `data-agent-label` over `textContent` while `AgentLab.tsx:244` labels the status span statically); found the root `AGENTS.md` falsely claims `createLocalNodeDaemon` "does not exist". R2: argued **against** flipping label precedence (label is stable ontology, live text is data); keep `find_elements` state-free; **specified the discovery wire using composio's existing field names** so a composio-backed catalog slots in with no migration; **found executed-but-unreported replay** (SSE dies after `deliver`, before the response POST → model retries → double-click); server-side schema validation; facade must never return the registry.

---

## Synthesis

### Unanimous (5/5, independently, Round 1)

1. The agent **acts blind** — no element state, no read verb, receipts instead of observations. Larger than discovery.
2. Discovery belongs in a **tool result**, never `tools/list` (past the prompt-cache boundary; no `listChanged` exists).
3. Availability is enforced at **call time**; list-time filtering is advisory. *This is what makes every discovery scheme reversible.*
4. `webmcp.ts` is **shadowed, not dead**.
5. **Tool-id namespacing** is the primary one-way door.
6. `@jini/metatool` leaves the engine set.

### Resolved in Round 2

| Question | Resolution | Basis |
|---|---|---|
| End-to-end flow | Settled — four designs match hop-for-hop | convergence |
| Bind provenance | **`bindToken`, not `frontendSessionId`** | security: any caller learning a session id could bind its run to someone else's tab |
| Label vs live text | **Do not flip precedence**; add a separate `state.text` channel | label is ontology, text is data; flipping re-breaks `find_elements` determinism |
| Bridge + DOM driver location | **Promote into `@jini/chat-react`** | leaving them in `examples/` makes the consumer story copy-paste; no new package (constraint 5) |
| Does the facade return the registry? | **Never** | returning it hands consumers `invoke` — a gate bypass |
| Quiescence | **`settle?()`**, honest `settled:false` when absent | otherwise the post-action snapshot races the re-render |
| `@jini/composio` | **Kept**; discovery wire borrows its field names now | turns preservation into a design decision with a payoff |
| Structured output | Bound at `ToolExecutor`; **fail atomically**, do not partially truncate | a truncated JSON object is invalid, not merely shorter |

### Open — Coordinator's call

**`page.read` vs state-on-descriptor.** Claude: no new verb, `find_elements` already *is* the read verb and was missing state. Fable: keep `find_elements` state-free — state on every descriptor bloats the largest payload exactly where bounding is broken. Codex and Pro want both.

**Coordinator synthesis (recommended):** neither. Add `withState?: boolean` (default `false`) to `find_elements`, and carry `before`/`after` on write envelopes unconditionally. Default listing stays cheap (Fable's objection); no seventh verb enters a vocabulary where ids are permanent (Claude's objection); the common case needs no second call at all. Cost: a targeted probe reads slightly worse than `page.read(handle)`.

---

## Decision Ledger

| # | Decision | Status | Reversal cost |
|---|---|---|---|
| 1 | Discovery via tool result; MCP list stays static | accepted | low — result payload only |
| 2 | Availability enforced at call time | accepted (already true) | n/a |
| 3 | `bindToken` for bind provenance | accepted | **high if deferred** — breaking wire change + CVE |
| 4 | Tool ids permanent; namespace prefix enforced at registration | accepted | very high |
| 5 | `FrontendCapabilitySpec` de-lossified (`inputSchema`/`risk`/`surface`) | accepted — defect conceded | low now |
| 6 | Observation: `withState` opt-in + write envelopes | **recommended, pending sign-off** | medium (wire format) |
| 7 | Promote bridge + DOM driver to `@jini/chat-react` | accepted | low |
| 8 | `@jini/composio` kept; catalog wire aligned to its field names | accepted — reverses the Coordinator's R1 position | low |
| 9 | `@jini/metatool` leaves the engine set | accepted | low (git preserves it) |
| 10 | WebMCP in-page path is ungated — decide explicitly | **open** | rises with every consumer |
| 11 | Wire `registerDelegatedToolRoutes` + MCP injection into the preset | accepted — newly discovered prerequisite | low |

---

## Final Recommendation

Build in this order. Steps 0–2 are prerequisites nobody had before this debate.

0. **Wire the delegated path into `createLocalNodeDaemon`** — mount `registerDelegatedToolRoutes`, configure MCP injection. Without this the seam has no caller.
1. **De-lossify `FrontendCapabilitySpec`** and validate input schema daemon-side before the round trip.
2. **`bindToken`** — mint alongside the session id, return it on the `attached` SSE event, accept `frontendBindToken` at run-start, resolve token → session in the registry. Build `resumeOf` reattachment at the same time; they are the same mechanism.
3. **Compose the seam** in `createLocalNodeDaemon` via a `createFrontendControl` facade that returns `{httpExtension, toolRegistrations, bindOnStarted}` and **never the registry**.
4. **Promote** `dom-page-driver` + a new `frontend-session-bridge` into `@jini/chat-react`; implement `ChatPaneAgentBridgeAccess`; retire `window.__jiniAgentLab`. Include the executed-`invocationId` dedupe set.
5. **Observation** — `AgentElementState`, `withState` on `find_elements`, write envelopes with `before`/`after`, `settle?()`, and the `state.text` channel that fixes the AgentLab demo without flipping label precedence.
6. **One discovery meta-tool** over a `GET /api/delegated-tools?runId=` route whose wire shape borrows composio's `safety.sideEffect` / `inputSchemaJson` / cursor fields.
7. **Bound structured output atomically** at `ToolExecutor`.

**Cheapest de-risking test** (all five participants converged on its shape): one in-process integration test — attach a surface claiming `page.click`, start a run carrying the bind token, POST a delegated tool call, and assert the invocation arrives over SSE, the response settles it, an audit record exists, **the checkbox state actually changed**, and `page.fill` on `account-password-input` is refused. It will fail on the readback gap until step 5 lands, and that failure is the finding.

**Then decide #10.** Either route the WebMCP callback through the gated daemon path, or disable WebMCP execution — but stop documenting "no second execution path" while shipping one.

---

## Debate Trace

- **R1 → R2, Primary:** held on 6 convergence points; **changed** on routing-exists (peer evidence: `bindRun` has no caller) and on deleting composio (peer evidence: `catalog.ts` verified). Would have been moved on the latter by nothing less than reading the file — which is the lesson.
- **R1 → R2, Claude peer:** held throughout; escalated from "bind is the missing edge" to "bind is a *security* decision" after designing the flow. Would change if session ids were unguessable *and* unreachable by any same-origin script — they are neither.
- **R1 → R2, Codex:** held on lossy projection and claim-vs-authority; **added** the two preset-wiring findings only after tracing the flow end to end, which is what the design round was for.
- **R1 → R2, Fable:** held on readback-broken-by-construction; **refined** its fix from "correct `describe()`" to "add a state channel, do not touch label precedence" — a reversal of its own earlier implication, argued explicitly.
- **R1 → R2, Gemini Pro:** unchanged in substance; strongest on scale analysis, weakest on extension mechanism.
- **Confidence:** ≥0.90 on items 1–5, 7–9, 11. Item 6 recommended pending sign-off. Item 10 open by construction — it is a policy decision, not a technical one.
