# Scoping: does the MCP-transport cancellation gap need to be opened?

**Author:** Software Architect (dispatched agent) · **Date:** 2026-08-05 · **Repo:** `/Users/la/Programming/Jini` @ `74d7569d` (+ `a7c0f8b5`, `898303a5`) · **Status:** scoping only, no code changed

## 0. Answer up front, argued in full below

This should **stay closed as a standalone MCP-protocol fix**, and be reframed instead as a much smaller, mostly-non-code task: make sure hosts call the run-cancel path on "stop." The reasoning, in order: the SDK genuinely supports per-call cancellation (§1) and Jini genuinely doesn't wire it (§4) — but the worst concrete consequence, an indefinitely hung confirmation, **already has a working escape hatch that requires zero new code**, because `DelegatedToolBridge` already subscribes to run-level cancellation and that already reaches a hardened `ToolExecutor.cancel()` (§4.3, §5). What's left after that mitigation is a narrower thing — "stop this one call, keep the run alive" — whose real-world value I can't establish (§4.4) and whose blast radius, while genuinely small (§2, §3), is not zero. I think this is worth arguing rather than just asserting, per the brief's invitation to push back — see §6.

## 1. Does the MCP SDK even surface `notifications/cancelled` to a handler? Yes — verified against the installed dependency, not memory

Checked `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0.../dist/esm/shared/protocol.js` and its `.d.ts`, not the spec and not recollection.

- `Protocol`'s constructor auto-registers a handler for `CancelledNotificationSchema` — the wire method `notifications/cancelled` — that calls `this._oncancel(notification)` (`protocol.js:27-28`).
- `_oncancel` looks up an `AbortController` keyed by `notification.params.requestId` in `this._requestHandlerAbortControllers` and calls `controller?.abort(notification.params.reason)` (`protocol.js:169-175`).
- Every inbound request gets a fresh `AbortController`, stored in that same map keyed by the request's JSON-RPC id, **before** the registered handler runs (`protocol.js:315-316`).
- The handler is invoked as `handler(request, fullExtra)` (`protocol.js:361`), and `fullExtra.signal = abortController.signal` (`protocol.js:299-300`). The public type for this is `RequestHandlerExtra.signal: AbortSignal` — "An abort signal used to communicate if the request was cancelled from the sender's side" (`protocol.d.ts:173-177`).
- `Protocol.setRequestHandler<T>(schema, handler: (request, extra: RequestHandlerExtra) => ...)` is the real, two-parameter signature (`protocol.d.ts:389`). `Server` (which `@jini-ai/mcp`'s `defaultCreateServer` constructs — `tool-server.ts:122-124`) extends `Protocol` and does not override this.

So the SDK's answer is unambiguous: cancellation is fully implemented and already fires for any real client that sends the notification. This does **not** invalidate the rest of the scoping — it means the gap is entirely on Jini's side, which §2–§4 confirm precisely.

### 1.1 What the SDK does after a cancelled handler eventually finishes — this matters for §4

`protocol.js:357-360` and `:386-389`: after `handler(request, fullExtra)` settles (success or error), the SDK checks `if (abortController.signal.aborted) { return; }` **before** sending a response. A cancelled request never gets a late response sent back — the client-observable behavior of "I cancelled and nothing more arrived" already holds today, for free, regardless of whether Jini's handler itself honors the signal. What does **not** hold today is everything server-side: the handler keeps running to completion (or its own timeout) with no idea it was cancelled, because nothing reads `fullExtra.signal` past this point.

## 2. Where the seam has to go, and whether it's a breaking change

### 2.1 `McpServerLike` is nominally public, practically almost unused outside one file

`McpServerLike` is defined in `packages/mcp/src/server/tool-server.ts:60-72` and re-exported from the package's public barrel, `packages/mcp/src/index.ts:106` (`export type { ..., McpServerLike, ... } from './server/index.js'`). `@jini-ai/mcp`'s `package.json` carries no `"private"` field, so nothing marks it internal-only.

I checked whether Tovu — the one other repo I have visibility into — depends on it. It imports several things from `@jini-ai/mcp` (`byok-tool-surface.ts`, `daemon-auth.ts`, `tool-catalog-query.ts`, `agent-daemon-server.ts`, `mcp-injection.ts`, `surface-exchanges.ts`), but grepping specifically for `McpServerLike` or `createMcpToolServer` across `Tovu/src` returns zero hits. Tovu does not host an MCP server; it consumes the client-side/catalog helpers.

Inside Jini itself, exactly four files reference `McpServerLike` at all: the definition (`tool-server.ts`), the public re-export (`index.ts`), and two test files. Of those, only **one** production call site actually implements or invokes the interface's `setRequestHandler`:

- `tool-server.ts:171-190` registers four handlers (`ListToolsRequestSchema`, `CallToolRequestSchema`, `ListResourcesRequestSchema`, `ReadResourceRequestSchema`), each a single-parameter arrow function — `async (request) => ...`, none reading a second argument.
- `defaultCreateServer` (`tool-server.ts:122-124`) hands back a real SDK `Server` behind an **unsafe cast** (`new Server(info, options) as unknown as McpServerLike`) — it does not structurally implement the interface at all, so widening the interface cannot break this line; TypeScript never checks it.
- The one test fake, `makeFakeServer()` (`tool-server.test.ts:63-80`), types its `setRequestHandler` as `(schema: unknown, handler: (...args: any[]) => any) => void` cast `as McpServerLike['setRequestHandler']` (`:67-69`) — also not structurally checked.
- `tool-server.wire.test.ts` uses the real SDK `Server`, not a hand-written fake (confirmed by its own module doc, `:6`, and its content — I read it and found no custom `McpServerLike` implementation, only real-SDK exercise).

### 2.2 Is widening the `CallToolRequestSchema` overload breaking? No — for a specific, checkable reason

The proposed change is: widen `McpServerLike`'s `CallToolRequestSchema` overload from `handler: (request) => Promise<CallToolResult>` to `handler: (request, extra: RequestHandlerExtra) => Promise<CallToolResult>`, matching the real SDK.

TypeScript's structural function-type compatibility allows a function that declares **fewer** parameters to satisfy a type that accepts **more** — this is the same rule that lets `[1,2,3].map(x => x)` type-check against `Array.prototype.map`'s three-parameter callback type. A one-parameter handler is a valid value wherever a two-parameter-accepting handler type is expected. So:

- `tool-server.ts`'s three untouched registrations (`ListTools`, `ListResources`, `ReadResource`) don't need this overload widened at all — I'm not proposing it for them, since nothing there needs a signal (§2.3).
- The `CallToolRequestSchema` registration, even left as `async (request) => handleToolCall(...)`, **continues to compile unchanged** against a widened overload — no source edit is forced by the type change alone.
- `makeFakeServer`'s `setRequestHandler` is untyped (`any[]`) and needs no change to keep compiling.

What **does** need an edit — but as a deliberate feature change, not a forced breakage — is `makeFakeServer`'s `callTool` method (`tool-server.test.ts:75`: `(request) => handlers.get(CallToolRequestSchema)!(request)`), which calls the registered handler with only one argument. If the production handler is then rewritten to actually *read* `extra.signal`, calling it through the current fake with `extra === undefined` will throw on `extra.signal`. This is contained to **one shared helper function**, not the ~25 call sites that use it (`tool-server.test.ts:133-537`, all going through the one `makeFakeServer()`/`callTool` pair). Concretely avoidable too: writing the production handler as `extra?.signal` (defensive optional-chaining) means the existing fake needs no change at all, and only a *new* test that wants to assert cancellation wiring needs `callTool` extended to accept a second argument.

**Verdict on item 1:** technically a public type; practically, one production call site (already unaffected by the widening itself) and one shared test fixture (needs zero-to-one line changed, at the implementer's discretion). I found no evidence of an external consumer beyond what I could check (Tovu). Residual uncertainty, stated plainly: I cannot rule out an undiscovered external consumer of `@jini-ai/mcp`'s published type outside the two repos I have access to — the package isn't marked private, so this isn't provably zero, only zero in everything I could check.

## 3. Blast radius, counted

To actually thread a signal end to end (`extra.signal` → `McpToolContext.signal` → `execute_delegated_tool`'s handler → `postDaemonJson`'s existing `signal` option):

| Change | File | Lines / count |
|---|---|---|
| Widen one `setRequestHandler` overload | `packages/mcp/src/server/tool-server.ts` | 1 interface member (`:62-65`) |
| Read `extra`, add `signal` to the `ctx` passed to `handleToolCall` | `packages/mcp/src/server/tool-server.ts` | 1 registration (`:176-179`) |
| Add optional `signal?: AbortSignal` to the context type | `packages/mcp/src/server/tool-protocol.ts` | 1 interface field (`McpToolContext`, `:20-33`) |
| Accept and forward it | `packages/mcp/src/server/tool-protocol.ts` | 1 function, `handleToolCall` (`:149-186`), 1 production call site (`tool-server.ts:178`) |
| Actually *use* it | `packages/mcp/src/server/tools/delegated-tool.ts` | 1 handler (`:135-148`) — pass `ctx.signal` into `postDaemonJson`'s already-existing `signal` option (`daemon-client.ts:53`) |
| Handlers that need **zero** change (additive field, ignored) | `packages/mcp/src/server/tools/run-tools.ts` (5 tool defs), `tool-catalog-tools.ts` (2 tool defs) | 0 |
| Test fixture, if the handler is written defensively | `packages/mcp/src/server/__tests__/tool-server.test.ts` | 0 (or 1 shared helper, if not) |

Total production surface: **3 files, roughly 5 small edits**, one of which (`delegated-tool.ts`) is the only place actual cancellation behavior changes — everything else is plumbing an optional field through. This is a small, well-bounded change. I want to be clear that "small" is the honest finding, not an argument by itself for opening it — see §6.

`postDaemonJson` already accepts and correctly combines an external `signal` with its own timeout controller via `AbortSignal.any` (`daemon-client.ts:52-53, 163`) — confirming the triage doc's "consumer ready, producer missing" framing precisely: nothing on the receiving end needs to change.

## 4. What actually breaks today, concretely — and what already doesn't

### 4.1 The mechanical chain

A user hits "stop" mid-`execute_delegated_tool` call, in a real MCP host that sends `notifications/cancelled`:

1. The SDK's own `_oncancel` fires and aborts its internal `abortController` (§1) — invisible to Jini's code, but real inside the SDK.
2. Jini's registered `CallToolRequestSchema` handler (`tool-server.ts:176-179`) never reads that controller's signal. `handleToolCall` → `tool.handler(validatedArgs, ctx)` → (for `execute_delegated_tool`) `postDaemonJson(...)` (`delegated-tool.ts:143-146`) keeps running exactly as if nothing happened.
3. `postDaemonJson` makes a real HTTP POST from the MCP-server subprocess to the daemon's `/api/delegated-tool-calls` route. That connection stays open and healthy — the subprocess didn't die, nothing disconnected. So the **already-shipped** HTTP-layer fix (`898303a5`, `res.on('close')` in `mountJsonRoute`) has nothing to observe: from the daemon's point of view, its client (the MCP subprocess) is still there, still waiting, exactly as it looked before the user hit stop.
4. Daemon-side, `DelegatedToolBridge.execute()` (`delegated-tool-bridge.ts:120-133`) is running `toolExecutor.execute(...)` against a `controller` that is subscribed to `lifecycle.onCancelRequested(runId, ...)` and to `invocation.signal` (the HTTP request's own abort) — **neither of which fires**, because neither the run nor the HTTP connection was cancelled, only the MCP-level call.
5. If the tool being executed requires confirmation (any `requiresConfirmation: true` registration, or a future dynamic one per the DOM-query design's §3.3), `ToolExecutor.execute()` is now parked on `requestConfirmation()` (`tool-executor.ts:408-417`), waiting for a human who, from the user's perspective, already said stop.

### 4.2 What bounds it, and why that bound is weaker than it looks

The `execute_delegated_tool` handler's own request deadline — `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS` (6 minutes) or a host's `delegatedToolTimeoutMs` override (`delegated-tool.ts:36-63`) — eventually aborts `postDaemonJson`'s fetch. That fetch abort tears down the TCP connection to the daemon, which **does** fire `res.on('close')` on the daemon side, which **does** now (post `898303a5`) reach `ToolExecutor.cancel()`, including a pending confirmation. So the hang is not literally infinite — it's bounded by this timeout, eventually.

But read `delegated-tool.ts:36-63` closely: this default is explicitly documented as a *backstop*, and the module's own doc says a host **should raise it** to match "the host's own exchange total-lifetime ceiling" for exactly the case where "a registered handler may legitimately be waiting on a *person*." In other words, the scenario most likely to produce a real user hitting stop mid-call — a slow human-in-the-loop confirmation — is precisely the scenario where a well-configured host has *widened* this timeout, not left it at 6 minutes. A host that correctly tuned this knob for its own UX made the accidental-cancellation bound longer, not shorter. And server-side, `ToolDescriptor.timeoutMs` is unset on every registration reachable this way (confirmed by `delegated-tool.ts:60-61`'s own comment: "`ToolDescriptor.timeoutMs` is unset on every registration today, so `ToolExecutor` arms no timer of its own") — there is no independent server-side ceiling under this path at all.

So: **already bounded, yes — bounded by a number that exists for an unrelated reason (request deadline) and that the system's own design intent pushes upward for exactly the case that matters most.** I don't think "it's bounded" is a strong argument for deprioritizing on its own; §4.3 is the one that actually changes the picture.

### 4.3 The mitigation that already exists and already works: run-level cancellation

I traced this end to end because the triage doc's framing ("only genuine per-call MCP cancellation... doesn't reach the daemon") left open whether *coarser* cancellation already does, and it does:

- `cancel_run` (an already-registered MCP tool, `run-tools.ts:92-119`) calls `POST /api/runs/:runId/cancel`.
- `runCancelRoute` (`packages/http-kit/src/runs.ts:193-202`) calls `deps.lifecycle.cancel(input)`.
- `RunLifecycle.cancel()` (`packages/daemon/src/run-lifecycle.ts:524`) fires whatever listeners are subscribed via `onCancelRequested` for that `runId`.
- `DelegatedToolBridge.execute()` subscribed exactly one such listener at the top of the call: `const unsubscribeCancel = lifecycle.onCancelRequested(runId, () => controller.abort())` (`delegated-tool-bridge.ts:128`).
- That `controller.signal` is what's passed into `toolExecutor.execute(principal, run, toolId, input, controller.signal, emitSurface)` (`delegated-tool-bridge.ts:191-198`) — the exact signal `a7c0f8b5` hardened to reach a still-pending confirmation.

So **cancelling the run already cancels an in-flight `execute_delegated_tool` call today, including a hung confirmation, with no further code changes** — this isn't a proposal, it's already-shipped behavior I verified by reading the concrete call chain. The gap this scoping was asked to size is specifically narrower than "cancellation doesn't work": it's "a bare, call-scoped `notifications/cancelled` that leaves the run itself alive doesn't work." Whether a host's "stop" button sends the narrow notification, the coarser run-cancel, or both, is host behavior I have no visibility into from this repo — flagged as uncertainty, not measured.

### 4.4 What's actually left, and how much it's worth

After §4.3, the remaining gap is: an MCP host that wants "abandon this one slow tool call, but keep the run/conversation going" (rather than "stop everything") has no way to express that today. That is a real, coherent UX distinct from run-cancel — but I want to flag two honest unknowns rather than assume it matters:

1. I could not verify, from this repo, whether any MCP client Jini actually ships against (Claude Code is named throughout `packages/mcp/src` as the observed real client, e.g. `delegated-tool.ts:112`) sends `notifications/cancelled` for a single tool call independent of stopping the whole turn, versus always cancelling at the run/turn level. If it never does, this gap has no live exposure regardless of the SDK's capability.
2. `execute_delegated_tool` is the *only* MCP tool a given subprocess exposes for actually running Jini tools (confirmed by `delegated-tool.ts`'s own module doc, `:16-17`: "Unlike every other tool this package ships (`run-tools.ts`'s five tools, plain static objects), this one is a factory," scoped to one `runId` for the subprocess's entire lifetime) — so there's exactly one call in flight at a time per subprocess. A host wanting to "cancel just this call" inside a single-tool-in-flight subprocess is close in practice to "cancel the run," making the marginal UX value of the narrower mechanism smaller than it would be in a system where many concurrent tool calls share one transport.

## 5. Cheapest-viable option

Given §4.3, the cheapest viable option is **not a code change to `@jini-ai/mcp` at all**: confirm (or, if untrue, arrange) that the MCP-hosting side of a Jini-integrated chat UI calls `cancel_run` when the user hits stop, rather than relying solely on the MCP transport's own per-call cancellation. This closes the dangerous case (indefinite hang on a pending confirmation) using a path that is already implemented, already tested (implicitly, via `delegated-tool-bridge.test.ts` and `tool-executor.test.ts`'s existing cancel coverage), and already hardened by `a7c0f8b5`. This is genuinely close to a documentation/integration-verification task, not an engineering one, and I'd size it at "confirm host wiring" rather than "ship a fix."

If the narrower per-call mechanism is wanted anyway (e.g. a future host genuinely needs "abandon this slow call, keep chatting"), the full fix scoped in §2–§3 is small and well-bounded — 3 files, ~5 edits, non-breaking per §2.2 — and should preserve the `cancelled`-not-`confirmation-denied` invariant *for free*: both paths terminate at the same `controller.signal`/`ToolExecutor.cancel()` mechanism `a7c0f8b5` already hardened, which doesn't distinguish signal sources. No new invariant-preservation work is needed if this is built; it inherits the existing guarantee.

## 6. Recommendation, argued

Stays closed as a standalone item. Not because it's expensive (§2–§3 say it isn't) and not because the SDK doesn't support it (§1 says it does) — because the specific danger this scoping was meant to size (an indefinitely hung human confirmation) already has a working, already-shipped answer that doesn't require this change, and what's left after that is a UX refinement whose real-world demand I can't establish and whose value is structurally capped by "one call in flight per subprocess" (§4.4). Opening it now would be closing a gap that isn't the dangerous one, at a moment when the dangerous one is already handled. If a host team later reports a concrete case of "cancel this call, not the run" mattering to users, §2–§3 already give the exact shape and cost to reopen this with.
