# `@jini/agui` — provenance

Origin: a 312-line "AG-UI ↔ product adapter" (`packages/agui-adapter/src/{types.ts,encode.ts,index.ts}`)
encoding a product's own run-event stream into the AG-UI wire protocol (CopilotKit's canonical
event shape — https://github.com/ag-ui-protocol/ag-ui) for SSE consumption. The origin repository
was not reachable from this task's environment; the source was inlined verbatim into the dispatch
prompt for this task instead of being read via `git show`. `types.ts` (100 lines) was inlined in
full; `encode.ts` (207 lines) was inlined as a structural summary (the switch's case list and each
case's field mapping, in comments) rather than the literal file body — see the "encode.ts — why
this is a rewrite, not a port" section below for what that means for this port's fidelity.

Per `foundry/docs/jini-port/extraction-plan.md` §12 C2: split the run/chat event family (generic, →
`@jini/protocol`) from the pipeline/genui family (product-specific, must not enter the kernel).
This port follows that split for the five event kinds with no generic meaning going in — but see
"Generalization attempt" below, which supersedes a flat drop for four of those five.

## File map

| Jini file | Origin file | Transform |
|---|---|---|
| `src/types.ts` | `packages/agui-adapter/src/types.ts` (100 lines, inlined verbatim in the task dispatch) | Ported near-verbatim: `AGUIEventKind`, `AGUIEventBase`, `AGUIAgentMessageEvent`, `AGUIToolCallEvent`, `AGUIStateUpdateEvent`, `AGUISurfaceRequestedEvent`, `AGUISurfaceRespondedEvent`, `AGUIRunLifecycleEvent`, `AGUIEvent` — every field name and type unchanged. **De-branded**: the module doc no longer frames this as a product-specific adapter; it now credits AG-UI's own external spec (CopilotKit) directly. No literal product-identity strings existed in the original 100-line inline to begin with (the type shapes themselves are already generic — 'agent asks a question', 'a tool ran', 'the run reached a lifecycle milestone' — which is presumably why the origin repo's own naming scheme was product-agnostic ("AG-UI") rather than branded). |
| `src/encode.ts` | `packages/agui-adapter/src/encode.ts` (207 lines, inlined as a case-list summary, not the literal body) | **Rewritten, not ported** — see the dedicated section below. |
| `src/index.ts` | `packages/agui-adapter/src/index.ts` | Root barrel — re-exports both modules' public surface. Not inlined in the dispatch (assumed to be a plain barrel, consistent with every other package in this repo); written fresh in that shape. |

## `encode.ts` — why this is a rewrite, not a port

The task brief was explicit that this encoder had to be sourced from `@jini/protocol`'s *actual*
current `RunProtocolEvent`/`RunAgentPayload` shape (see `packages/protocol/src/events.ts`,
`run.ts`), not from the origin adapter's own source union — and the origin's inlined `encode.ts`
targeted a completely different event vocabulary (`message_chunk`, `run_started`,
`pipeline_stage_started`, `genui_surface_request`, ...) with no structural correspondence to
`RunProtocolEvent`'s six kinds (`start`/`agent`/`stdout`/`stderr`/`error`/`end`) or
`RunAgentPayload`'s nine variants (`status`/`text_delta`/`thinking_start`/`thinking_delta`/
`tool_use`/`tool_input_delta`/`tool_result`/`usage`/`raw`, pre-this-task). Only the *shape* of the
job carried over: one big per-event-kind switch, unrecognized events silently dropped (`default:
return null`), and a shared base-fields construction (`runId`/`ts`/optional `seq`). Every case body
was designed fresh against this repo's real types. The old→new field-mapping table below documents
this at the level of "which origin case does this new case play the same role as," not "this line
was copied from that line" — because for encode.ts, no line was copied.

### Old → new field-mapping table

| Origin case (from the inlined summary) | New case (`src/encode.ts`) | Notes |
|---|---|---|
| `message_chunk` → `agent.message` | `RunAgentPayload.text_delta` → `agent.message` | Same AG-UI target kind; the origin's `done?` flag has no `RunProtocolEvent` equivalent (no "this is the last delta" signal exists on `text_delta` itself — only the run's own terminal `end` event closes the door on more text) — omitted rather than invented. |
| `tool_call` (single case, `status`-tagged) | `RunAgentPayload.tool_use` + `RunAgentPayload.tool_result` → `tool_call` (two cases, correlated) | The origin's source event already carried a `status`/`callId`/`result` combination in one case; `RunProtocolEvent` splits a tool call's start and end into two separate wire events (`tool_use` then `tool_result`, correlated only by an id — `tool_use.id` / `tool_result.toolUseId`). This port's encoder is therefore **stateful** (a `Map<string, {toolName, args}>` correlation table, one per `AguiEncoder` instance) so a `tool_result` can still produce a complete `tool_call` event carrying the original call's `toolName`/`args` alongside the result — see `encode.ts`'s own module doc for why a pure per-event function cannot do this alone, and the "Correlation map design" section below for the adversarial cases this was tested against. |
| `state_update` (direct case) | *(no new case — returns `null`)* | No `RunAgentPayload` variant carries a generic "arbitrary path/value changed" signal, and this task's brief explicitly said not to invent one speculatively for this case. See "Generalization attempt" below for why `genui_state_synced` (the one origin case that *did* map to `state_update`) also did not produce one. |
| `run_started` → `run.lifecycle` (`status: 'started'`) | `RunEvent<'start', ...>` → `run.lifecycle` (`status: 'started'`) | `RunProtocolEvent`'s own kernel-managed `'start'` event plays the exact role the origin's `run_started` case did — direct equivalent, no design work needed. |
| `end` → `run.lifecycle` (`status` ternary) | `RunEvent<'end', RunEndPayload>` → `run.lifecycle` | Same three-way ternary shape (failed / cancelled / else-completed), rebuilt against `RunEndPayload.status`'s actual values (`'succeeded' \| 'failed' \| 'canceled'`, optional) instead of the origin's own `event.status` values — `'canceled'` (one *l*, `RunEndPayload`'s own spelling) maps to AG-UI's `'cancelled'` (two *l*s, `types.ts`'s field value, unchanged from the origin) as two independent modules' independently-chosen spellings, not a typo. |
| `pipeline_stage_started` / `pipeline_stage_completed` → `run.lifecycle` | `RunAgentPayload.stage_start` / `stage_end` → `run.lifecycle` | **Generalized** — see below. `stage_start`/`stage_end` are new, added to `@jini/protocol` by this task. |
| `genui_surface_request` → `ui.surface_requested` | `RunAgentPayload.surface_request` → `ui.surface_requested` | **Generalized** — see below. `surface_request` is new, added to `@jini/protocol` by this task. |
| `genui_surface_response` → `ui.surface_responded` | `RunAgentPayload.surface_response` → `ui.surface_responded` | **Generalized** — see below. `surface_response` is new, added to `@jini/protocol` by this task. |
| `genui_surface_timeout` → `ui.surface_responded` (`respondedBy: 'auto'`) | `RunAgentPayload.surface_response` with `respondedBy: 'auto'` → `ui.surface_responded` | **Generalized**, reusing the same new `surface_response` variant rather than a separate one — see below; this mirrors the origin's own choice to collapse two of its own event kinds into one AG-UI kind. |
| `genui_state_synced` → `state_update` (`path: genui.${surfaceId}`, `value: {persistTier}`) | *(no new case — returns `null`)* | **Attempted, did not generalize cleanly** — see below. |
| *(default)* → `null` | *(default)* → `null` | Same fallback behavior: an unrecognized/not-yet-generalized event is silently dropped, matching "the relay" framing from the origin's own inlined comment. |

Every `RunProtocolEvent`/`RunAgentPayload` variant that has no row above (`stdout`, `stderr`,
`error`; `status`, `thinking_start`, `thinking_delta`, `tool_input_delta`, `usage`, `raw`) also
falls through to `null` — there is no origin case for them because the origin's own event
vocabulary doesn't have direct siblings for Jini's raw-stdio/thinking/status/usage concepts. This
is a straightforward "no equivalent, so drop it" outcome, not a generalization attempt.

## Generalization attempt (Part B.3)

The task brief asked for a genuine attempt at all six OD-specific event kinds
(`pipeline_stage_started`, `pipeline_stage_completed`, `genui_surface_request`,
`genui_surface_response`, `genui_surface_timeout`, `genui_state_synced`), noting that since nothing
in this codebase produces or consumes any of these six today, an incomplete or imperfect
generalization carries zero regression risk to existing behavior. **Five of six generalized
cleanly; one did not** — details below.

### Direction chosen: new `@jini/protocol` `RunAgentPayload` variants (direction (a)), not a `ToolExecutor` generalization (direction (b))

The task brief offered two directions to evaluate per event family: (a) new `RunAgentPayload`
variants flowing through the existing `RunLifecycle.emit('agent', ...)` channel, the same way
`tool_use`/`tool_result` already do; or (b) generalizing `packages/daemon/src/tool-executor.ts`'s
`ExecutionDelegate`/`ToolConfirmationRequest`/`ConfirmationDecision` boundary beyond gating a tool
call, to gate an arbitrary human-in-the-loop request mid-run.

Direction (b) was evaluated and rejected for **all** of the pipeline/genui kinds, not just some:
`ToolExecutor`'s confirm flow is fundamentally "should this **specific, pre-registered** tool run"
— a binary `confirm`/`deny` gate in front of a handler that is already fully specified
(`ToolDescriptor`/`ToolPolicy`/`ToolHandler`, all tool-shaped). `genui_surface_request` is a
different shape entirely: the agent asks an **ad hoc** question with an arbitrary payload and gets
an arbitrary value back — there is no separate "handler" to run after the answer arrives, because
the answer itself *is* the payload. Forcing this through `ExecutionDelegate` would require either:
(i) redefining `ConfirmationDecision` from its current `'confirm' | 'deny'` into an arbitrary-value
carrier, which breaks the meaning every existing (and future) tool-confirmation caller already
relies on; or (ii) registering a synthetic one-off "tool" per ad hoc question purely to borrow the
confirm/resume plumbing — which would pollute `ToolRegistry.list()` (a real, callable-tool
inventory) with non-callable, single-use entries. Both were rejected as forcing a bad fit rather
than finding a real one. Direction (a) fit better across the board: `RunLifecycle.emit('agent',
...)` is already a generic "the driver observed this" channel with no built-in assumption that
every event corresponds to a registered, callable tool — exactly the right level of genericity for
"the agent said/asked something," which is what all five successfully-generalized kinds below
actually are.

### Two-consumer justification (extraction-plan.md's guard against speculative kernel additions)

Normally a new kernel-level event family needs two real consumers before it is justified.
Considered explicitly rather than assumed: **AG-UI (this package) is consumer #1.** A separately
-scoped "chatpane drives the app's own UI" example project (real, already scoped, not part of this
task) is a **plausible** consumer #2 for `stage_start`/`stage_end` and `surface_request`/
`surface_response` — a chat surface that wants to show "stage 2 of 4: reviewing" or render an ad
hoc confirmation prompt would want exactly this shape. Flagging the honest caveat rather than
treating this as settled: `packages/chat-core/src/events.ts`'s own `AgentEvent` union already has
an `{ kind: 'ext'; name: string; data: unknown }` escape hatch specifically so a host can carry
product-specific event kinds through chat-core's envelope *without* a `@jini/protocol` change at
all (see that file's own module doc). That means a real second consumer wanting to *display*
pipeline-stage or surface-request info could plausibly route through `ext` instead of ever needing
these new kernel-level `RunAgentPayload` variants — so the two-consumer bar here is "plausible and
reasoned," not "proven by an existing second caller." Recorded here for a human reviewer to weigh,
not glossed over.

### 1–2. `pipeline_stage_started` / `pipeline_stage_completed` — generalized

New `@jini/protocol` `RunAgentPayload` variants (`packages/protocol/src/events.ts`):
```ts
| { type: 'stage_start'; stageId: string; label?: string; iteration?: number }
| { type: 'stage_end'; stageId: string; iteration?: number }
```
Generic scaffolding for **any** driver that structures a run into named sub-stages — a build
pipeline, a multi-pass review, a plan/execute/verify loop — not tied to OD's own pipeline concept.
Maps to `AGUIRunLifecycleEvent` with `status: 'pipeline_stage_started' | 'pipeline_stage_completed'`
plus `stageId`/optional `iteration` (`src/encode.ts`'s `stage_start`/`stage_end` cases). Fully
tested: with and without `iteration` present, for both the start and end sides
(`src/__tests__/encode.test.ts`, "generalized pipeline-stage events").

### 3–5. `genui_surface_request` / `genui_surface_response` / `genui_surface_timeout` — generalized

New `@jini/protocol` `RunAgentPayload` variants:
```ts
| { type: 'surface_request'; surfaceId: string; surfaceKind: 'form' | 'choice' | 'confirmation' | 'oauth-prompt'; payload: unknown }
| { type: 'surface_response'; surfaceId: string; value: unknown; respondedBy: 'user' | 'agent' | 'auto' | 'cache' }
```
Generic "the agent needs the user to answer something mid-run" scaffolding — deliberately **not**
a UI-component/data-binding protocol (see the A2UI scope note below). `surfaceKind`'s four literal
values and the opaque `payload`/`value: unknown` shape are carried over unchanged from the origin's
own already-generic-shaped taxonomy (a question kind + an opaque body), which the task's own scope
guard confirmed is fine to keep as-is. `genui_surface_timeout` did **not** get its own protocol
variant — it collapses into `surface_response` with `respondedBy: 'auto'`, mirroring the origin
adapter's own choice to collapse its two response-shaped event kinds into one AG-UI kind
(`ui.surface_responded`). Maps to `AGUISurfaceRequestedEvent`/`AGUISurfaceRespondedEvent`
(`src/encode.ts`'s `surface_request`/`surface_response` cases). Fully tested, including the
timeout-shaped `respondedBy: 'auto'` case (`src/__tests__/encode.test.ts`, "generalized surface
request/response events").

### 6. `genui_state_synced` — attempted, did **not** generalize cleanly

The origin maps this to `state_update` with `path: genui.${surfaceId}` and
`value: { persistTier: event.persistTier }`. Attempted direction (a) for this one too: a generic
`{ type: 'state_delta'; path: string; value: unknown }` `RunAgentPayload` variant, which would also
retroactively fill the previously-`null` generic `state_update` direct-mapping case from the
field-mapping table above (one primitive answering two gaps at once looked, at first, like a clean
win). On closer inspection this was rejected: `persistTier` — the *only* real content this event
ever carries — is a concept specific to the origin product's own genui-surface persistence-caching
feature (which tier a surface's state is cached at); it has no meaning to a generic consumer that
doesn't share that feature. Adding a maximally-generic `path: string; value: unknown` bag just to
carry this one narrow, product-specific field would be inventing genericity for its own sake — the
same anti-pattern the task brief explicitly warned against ("don't force a bad design just to have
shipped something"). Unlike `stage_start`/`stage_end` and `surface_request`/`surface_response`
(each a concrete, bounded interaction shape the kernel can reason about), an open `path`/`value`
bag is structurally just "any JSON at any key" — a backdoor that would erode `RunAgentPayload`'s
typed guarantees over time if reused for whatever the next feature needs, rather than that feature
getting its own well-modeled variant. **Falling back to a flag-only recommendation**: if a future
consumer has a genuinely generic run-scoped state-sync need (not tied to one product's caching
tiers), it should get its own concretely-shaped variant at that point, informed by that consumer's
real requirements — not a preemptively generic bag built against a single narrow example. This also
means the top-level `state_update` direct-mapping case (in the main encoder, independent of this
generalization sub-task) legitimately stays `null`, per the task brief's own default expectation.

### A2UI / GenUI terminology note (per the task's scope guard)

Three distinct things, easy to conflate, kept separate throughout this document:

1. **A2UI** (a2ui.org, v1.0) — Google's real, external, much larger declarative-UI-component wire
   protocol: `createSurface`/`updateComponents` build a component tree from a catalog (`catalogId`),
   `updateDataModel` does JSON-Pointer data binding, plus client action events and server
   `callFunction`/`functionResponse` RPCs. **Not implemented or targeted for wire-compatibility
   here** — this task's `surface_request`/`surface_response` generalization is narrow ("agent asks
   a structured question with an opaque payload, gets a value back," no component tree, no
   catalog, no data binding), a different and much smaller problem. If Jini ever wants agents to
   generate genuinely novel UI on the fly (a different use case from driving Jini's *existing* UI,
   which is what a near-term consumer of this generalization actually needs), A2UI is the reference
   spec a future human decision should evaluate — not something to build now.
2. **"GenUI" as an industry-wide category term** — OpenAI's Apps SDK, MCP Apps, Google's A2UI, and
   others all fall under this umbrella (agent-generated/agent-driven UI, broadly). Distinct from
   both of the below.
3. **The origin product's own home-grown "GenUI" feature** — what this task's `genui_surface_*`
   generalization is actually derived from: a specific, narrower human-in-the-loop
   ask/answer pattern (form/choice/confirmation/oauth-prompt), not a general UI-generation system.

## Correlation map design (tool_use/tool_result)

One `Map<string, { toolName: string; args: unknown }>` per `AguiEncoder` instance (not shared
across instances — see `encode.ts`'s own `AguiEncoder` doc for why one instance should correspond
to one run's stream). Adversarial cases explicitly designed and tested
(`src/__tests__/encode.test.ts`, "tool_use/tool_result correlation"):

- **A `tool_result` with no matching prior `tool_use`** (never observed, or already resolved) —
  falls back to `toolName: 'unknown'`, `args: null` rather than throwing; the result is still real
  and worth relaying even without its originating call captured.
- **Duplicate `tool_use` ids** — a second `tool_use` for an already-pending id overwrites the first
  entry; a following `tool_result` correlates against the most recent one. Chosen because nothing
  in `RunProtocolEvent` guarantees ids are never reused within a run, and the most recent call is
  the more useful attribution if they are.
- **A run ending mid-tool-call** — the correlation map is cleared on every `'end'` event. A
  `tool_result` that somehow still reaches the encoder afterward (e.g. a duplicate/replayed event)
  correctly falls back to `unknown` rather than resolving against a call from a run that has
  already terminated, instead of silently leaking map entries across a run's lifetime.
- **Two independent encoder instances never share state** — proven directly (a `tool_use` on one
  instance does not satisfy a `tool_result` on another).

## Tests

`src/__tests__/encode.test.ts` (26 tests) + `src/__tests__/index.test.ts` (2 tests), 28 total.
100% coverage on all 4 metrics for every file with executable statements
(`pnpm --filter @jini/agui exec vitest run --coverage --coverage.include='src/**'`). `types.ts`
reports `0%` on all 4 metrics — this is v8's coverage tool reporting zero-out-of-zero for a
file with no runtime statements at all (pure `interface`/`type` declarations, erased entirely by
`verbatimModuleSyntax`), not an actual gap. This matches an established, pre-existing pattern
already present elsewhere in this repo: `packages/protocol/src/common.ts` (also pure types) reports
the identical `0/0/0/0` today, while `packages/http/src/types.ts` (which has real runtime `ok`/`err`
helper functions alongside its types) reports `100/100/100/100`. Every `RunProtocolEvent`/
`RunAgentPayload` variant the encoder branches on is directly asserted, including every "drops this,
no equivalent" default-fallthrough case, both `seq`-present/absent and injected-clock/default-clock
base-field branches, and the full correlation-map adversarial suite above.

## Dependencies

`@jini/protocol` (workspace) — `RunAgentPayload`/`RunProtocolEvent` (type-only). No dependency on
`@jini/daemon` or `@jini/core` was needed: the generalization work (direction (a), new
`RunAgentPayload` variants) only required a `@jini/protocol` change, not a type from either of
those two packages — direction (b) (which would have needed `@jini/daemon`'s `ToolExecutor` types)
was evaluated and explicitly rejected, see above.

## `@jini/protocol` changes this task made

Added four new `RunAgentPayload` variants (`packages/protocol/src/events.ts`): `stage_start`,
`stage_end`, `surface_request`, `surface_response` — see "Generalization attempt" above for the
full reasoning. Verified zero regression risk before adding them: grepped every `@jini/*` package
for an exhaustive `switch`/`assertNever` over `RunAgentPayload.type` that a new union member could
break (none found — `packages/daemon/src/agent-executor.ts`'s own `switch` is over the *agent-
runtime's* raw stream-event shape, not `RunAgentPayload`, and produces `RunAgentPayload` values
rather than consuming them exhaustively). `packages/protocol`'s own test suite (9 tests, 2 files)
re-run clean after the change — `events.ts` itself carries no runtime logic (all `type`/`interface`
declarations), so there was nothing new to unit-test in that package itself.

## 2026-07-23 — encoder injection boundary

The repaired package-admission guard correctly rejected locked `@jini/http` importing this
incubating package. `@jini/http`'s run-stream now accepts a structural `RunStreamEncoder`;
`examples/reference-web` supplies `createAguiEncoder()` through `@jini/node-host`'s neutral
HTTP-extension context. This preserves a real AG-UI consumer while keeping the dependency arrow
from the product composition root toward both packages.
