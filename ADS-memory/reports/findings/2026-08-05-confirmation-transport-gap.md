# Finding: no host in this codebase can safely wire a `requiresConfirmation: true` tool

**Author:** QA/E2E (dispatched agent) · **Date:** 2026-08-05 · **Repos:** `/Users/la/Programming/Jini`, `/Users/la/Programming/Tovu` · **Status:** finding, no code changed by this document's author

## 0. The finding, stated once

`ToolExecutor.execute()`'s `requiresConfirmation` gate (`packages/daemon/src/tool-executor.ts`) is real, tested, and reachable in principle — but **no host in either repo builds the `ToolExecutor` with an `ExecutionDelegate` that can actually answer a confirmation.** Setting `descriptor.requiresConfirmation: true` on a tool a host actually registers does not produce a working "ask a human, then proceed or stop" flow. It produces a call that parks on an internal promise forever, with **no timeout protecting it** and **no way for a human to say yes** — the only way out is cancelling the entire run, which reports the call as `cancelled`, not `confirmed` or `denied`. This is a known, deliberate invariant elsewhere in the codebase (a build-time guard in `packages/cms` enforces it already), not something this document is the first to notice — but as far as I can find, it had not been written up as a standalone finding before, and it genuinely blocks a smaller, more precise list than an earlier version of this document claimed — see §3, corrected 2026-08-05 after the first commit (`d5ad2a5b`) overstated the payoff of building a transport by counting two tools that are blocked by something else entirely.

This surfaced from tracing whether Tovu could wire `packages/chat/src/core/agentic/chat-capabilities.ts`'s `CHAT_CAPABILITIES` (which includes `chat.reset_conversation`, `requiresConfirmation: true`) into its running agent daemon, in service of building an E2E test for Jini commit `a7c0f8b5`. The user has since decided to ship the 6 non-confirming `chat.*` verbs and defer `reset_conversation` — see §4(c). This document is the writeup of the gap that decision routed around.

## 1. The mechanism — verified by reading the current source, not the comments about it

All line numbers below were read directly from the file at the time of writing, current `HEAD` (post-`a7c0f8b5`) on `refactor/jini-admin-extraction` in both repos.

- **`createToolExecutor` defaults to no delegate.** `packages/daemon/src/tool-executor.ts:213`: `const { registry, delegate = {} } = options;`. `CreateToolExecutorOptions.delegate` is optional (`:172`); if a host doesn't pass one, `delegate` is `{}` and `delegate.onConfirm` is `undefined`.
- **`requestConfirmation()` always parks when there's no `onConfirm`.** `tool-executor.ts:238-247`:
  ```ts
  function requestConfirmation(request: ToolConfirmationRequest): Promise<ConfirmationDecision> {
    if (delegate.onConfirm) {
      const result = delegate.onConfirm(request);
      if (result !== undefined) return Promise.resolve(result);
    }
    return new Promise<ConfirmationDecision>((resolve) => {
      pendingConfirmations.set(request.executionId, resolve);
    });
  }
  ```
  With no `onConfirm`, execution always falls into the `new Promise` branch. That promise resolves only if something later calls `resumeConfirmation(executionId, decision)` (`:509-515` — sets the decision a human actually gave) or `cancel(executionId)` (`:507` — the abort/deny path).
- **The gate is entered from `execute()` at `tool-executor.ts:408`:** `if (descriptor.requiresConfirmation) { ... confirmation = await requestConfirmation(...) ... }`.
- **The detail most people would miss: the per-call timeout does not protect the parked confirmation.** `tool-executor.ts:442`: `const timeout = startTimeout(controller, descriptor.timeoutMs);` runs **after** the `if (descriptor.requiresConfirmation)` block (`:408-436`) has already resolved. `descriptor.timeoutMs` arms a timer for the handler-run phase only. While parked in `requestConfirmation()`, no timer is running at all — the wait is genuinely unbounded, not merely "bounded generously."
- **Post-`a7c0f8b5`, the only real exit is killing the whole run, and even that doesn't confirm anything.** `a7c0f8b5` (this session, same day) added transport-abort observation for exactly this phase: an `AbortSignal` passed into `execute()` now has a listener registered before the confirmation gate (`tool-executor.ts:350-361`), so a run cancellation or transport disconnect now calls `cancel(executionId)`, which resolves the parked promise with `'deny'` and marks it `cancelledConfirmations` (`:507-515`) so the outcome is honestly reported as `'cancelled'` (`:418-429`) rather than the misleading `'confirmation-denied'`. That is a real, valuable fix — I verified it directly in an earlier task this session (negative-verification revert of `a7c0f8b5` reverted this exact mechanism and confirmed the daemon rebuild landed). **But it only ever produces `cancelled`.** There is still no code path anywhere in either repo that calls `resumeConfirmation(executionId, 'confirm')` for this gate — so a tool gated this way can never actually be told "yes, proceed." The entire lifecycle of a `requiresConfirmation: true` call, as wired today, is: park forever, or park until the run dies and report `cancelled`.
- **Confirmed no host supplies a delegate.** Tovu's only `createToolExecutor` call: `src/assistant/agent-daemon-server.ts:354` — `createToolExecutor({ registry })`. No second argument, no `delegate`. Grepped Tovu's `src/` for any call to `resumeConfirmation`: none.

## 2. This is a known, deliberate invariant elsewhere in the codebase — not an oversight this document discovered fresh

Two independent places in the codebase already say this, in almost the same words, before this document existed:

- **Jini's own build-time guard**, `packages/cms/src/core/tools/registration-kit.ts:113-130`:
  > "`confirmer-must-equal-own-delegatedBy` means 'a human must confirm this, and the confirmer must be the principal who delegated'. A host can only deliver that by building `ToolExecutor` with an `ExecutionDelegate`. Without one, `descriptor.requiresConfirmation` would park the execution on a promise only `resumeConfirmation` can settle — and nothing would call it. The park is also unbounded, because `descriptor.timeoutMs`'s timer is armed only AFTER the confirmation await. So a tool carrying this rule must not be wired at all."

  This is enforced, not just documented: `registration-kit.ts:130` declares
  ```ts
  export const ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT = new Set(["confirmer-must-equal-own-delegatedBy"]);
  ```
  and `registration-kit.ts:378-381` throws at build time if any catalog entry declaring that rule is ever wired:
  > `` `tool-registrations: '${toolId}' declares actorClassRule '${catalogEntry.actorClassRule}', which requires a human-confirmation transport this host has not wired — leave it unwired until one exists (see ACTOR_CLASS_RULES_REQUIRING_CONFIRMATION_TRANSPORT)` ``

  **Verified directly:** `collections_execute_cleanup` is explicitly in `packages/cms/src/content-types/tool-registrations.ts:77`'s `UNWIRED_CONTENT_TYPES_TOOL_IDS` set, so the guard's throw is never actually exercised for it (it's kept out of the registered set deliberately, not caught by the throw at runtime). This is the one tool in this repo (Jini) whose block is genuinely and solely the confirmation-transport gap.

  **Correction (2026-08-05, after this document's first commit):** the first version of this section named `database_execute_migrate_forward` and `backup_execute_restore` alongside `collections_execute_cleanup` as though all three were CMS tools blocked the same way, citing two source comments (`registration-kit.ts:123-124` and `packages/cms/src/taxonomy/agent-tools.ts:30-36`) rather than each tool's own catalog entry. That was flagged honestly as unverified in the original commit, and the coordinator chased it. Both corrections turned out to matter — see §3 for where those two tools actually live and why they are not simply "waiting on a confirmation transport" the way `collections_execute_cleanup` is.

- **Tovu's own doc, written before this trace, saying the same thing about the OTHER flavor of confirmation:** `src/assistant/pending-confirmations.ts:16-21`:
  > "`ToolDescriptor.requiresConfirmation` (`jini-shims.d.ts`) exists and is deliberately never set — `tool-registration-kit.ts` records why: `ToolExecutor` is built with NO `ExecutionDelegate` (`agent-daemon-server.ts`), so setting the flag parks the execution on a promise only `resumeConfirmation` can settle, and no route calls it. The park is unbounded, because `descriptor.timeoutMs`'s timer is armed only AFTER the confirmation await. A boolean flag is therefore not a weaker version of this mechanism; it is a hang."

So: three independent sources (a CMS build-time guard + its comment, a Tovu module doc, and my own direct read of `tool-executor.ts`'s current code) converge on the identical conclusion. This is a load-bearing, cross-repo invariant that has simply never had a fix built for it yet.

## 3. What this currently blocks — corrected count, verified against source rather than citation

The first version of this section listed three CMS tools as equally blocked by the confirmation-transport gap. That was wrong in two ways at once, both caught by chasing the citation this document's own honesty section flagged as unverified: two of the three aren't CMS tools, and two of the three aren't blocked by this gap in the first place. Restated:

- **`collections_execute_cleanup`** (`packages/cms/src/content-types/`) — genuinely blocked by the confirmation-transport gap alone. Confirmed in `UNWIRED_CONTENT_TYPES_TOOL_IDS` (§2); nothing else stands between it and being wired once a transport exists.
- **`chat.reset_conversation`** — same: blocked by the confirmation-transport gap alone, and excluded by the filter shipping now (Programmer is filtering `CHAT_CAPABILITIES` on the `requiresConfirmation` property itself, not by id, so this and any future confirming chat verb are excluded automatically).
- **An `a7c0f8b5` E2E** — same. Traced in an earlier task this session: `content_post_delete` (the tool `development/e2e/destructive-path.spec.ts` uses) never sets `requiresConfirmation` — it uses a completely separate mechanism, Tovu's own `SurfaceExchange` parked inside the handler, which predates `a7c0f8b5` and was never broken by it. `a7c0f8b5`'s actual target — the `pendingConfirmations` gate at `tool-executor.ts:408` — has no live caller anywhere in either repo today. Daemon's own unit tests (`packages/daemon/src/__tests__/tool-executor.test.ts`, updated by `a7c0f8b5` itself) are the honest coverage ceiling for that fix until this gap closes.
- **`database_execute_migrate_forward` / `backup_execute_restore` — live in *Tovu*, not Jini/CMS (`src/features/database/`, `src/features/recovery/`), and are DOUBLE-BLOCKED.** The confirmation-transport gap is real for both, but it is not the *binding* constraint — both are refused earlier, for a different and stronger reason, verified directly against Tovu's own test: `src/assistant/__tests__/tool-registrations.database-recovery.test.ts:228-233` (`database_execute_migrate_forward`) and `:237-242` (`backup_execute_restore`), quoted verbatim:
  > "`database_execute_migrate_forward` is never registered — refused for lack of a `DERIVED_RISK_BY_TOOL_ID` classification, which is itself a stronger guard than the confirmation-transport check alone (an unclassified tool can never reach that second check at all)"

  and the same for `backup_execute_restore` ("same double-blocked guard as `database_execute_migrate_forward`"). **Consequence: building a confirmation transport tomorrow would not wire either of these two.** They would still be refused, earlier, by the risk-classification guard, independent of anything in §1-§2. Listing them as something a transport "unblocks" overstated the payoff of building one.

**Honest total: a confirmation transport alone unblocks one CMS tool (`collections_execute_cleanup`), one chat capability (`chat.reset_conversation`), and one E2E (`a7c0f8b5`) — not three CMS tools.** Still a real case for doing the work; materially smaller than the first version of this document implied.

## 4. The three options, as costed when this was traced, with the decision recorded

- **(a) New engine-level work: a real, generic confirmation transport.** Something `createToolExecutor`'s `delegate.onConfirm` (or a route calling `resumeConfirmation`) can use, generic across any tool that sets `requiresConfirmation`. Nothing like this exists anywhere in the engine today — confirmed by §2's build-time guard, which exists specifically because no such thing has been built yet.
- **(b) New Tovu-side plumbing: generalize the existing MCP-UI mechanism.** Tovu already built a working human-confirmation transport for exactly one tool — `content_post_delete`'s `SurfaceExchange` (`src/assistant/surface-exchanges.ts`), parked inside the handler itself, with real HTTP routes redeeming it (`src/assistant/mcp-ui-tool-calls-route.ts`). Bridging that into a generic `ExecutionDelegate.onConfirm` that any `requiresConfirmation` tool could use — not just this one destructive delete — is real integration work, not a config change.
- **(c) Filtered registration: ship what doesn't need confirmation, defer the rest.** Register only capabilities where `requiresConfirmation` is not `true`. **This is what shipped.** The user decided to ship the 6 safe `chat.*` verbs and exclude `chat.reset_conversation`; Programmer is implementing the filter on the `requiresConfirmation` property itself, not the id, so any future capability with that flag is excluded automatically rather than requiring someone to remember to add it to a denylist.

**(c) is a deferral, not a judgment that confirmation is unnecessary for `chat.reset_conversation`.** The tool's own description calls it "DESTRUCTIVE" and explicitly "Requires explicit confirmation" — that requirement is real and unmet, not waived. The gap in §1-§2 is what has to close before that verb (or `collections_execute_cleanup`, §3's one genuinely-single-blocked CMS tool) can be wired safely. It would NOT, on its own, unblock `database_execute_migrate_forward` or `backup_execute_restore` — those need the separate `DERIVED_RISK_BY_TOOL_ID` classification gap closed first (§3).

## 5. Correction of an assumption made mid-trace, recorded so the next reader doesn't repeat it

While tracing this, I initially suspected the `chat.*` verbs might have no server-side executor at all, and that registering `CHAT_CAPABILITIES` server-side could be incoherent independent of the confirmation question. **That suspicion was wrong, and it's worth naming explicitly:**

- `createFrontendCapabilityRegistrations` (`packages/daemon/src/frontend-capability-tools.ts:127-163`) gives every capability — `page.*` and `chat.*` alike — the identical handler shape: `registry.invoke(ctx.run.id, capability.id, ...)`, routing to whatever browser tab is bound to the run via `FrontendSessionRegistry`. Neither manifest has a server-side executor; both are meant to execute in the browser. That is the architecture, not a gap.
- `packages/agentic/src/page-executor.ts`'s own module doc confirms `page.*`'s "executor" is itself browser-side policy over a `PageDriver` — "nothing here touches the DOM" describes what makes it unit-testable, not where it runs.
- The `chat.*` browser-side counterpart, `packages/chat/src/react/agent-bridge/frontend-session-bridge.ts`, is in fact **more** ready than `page.*`: line 81, `const claims: string[] = CHAT_CAPABILITIES.map((capability) => capability.id);` claims all 7 chat verbs unconditionally, whenever a chat pane connects at all — unlike `page.*`, which is only claimed when a `pageDriver` is supplied (`:83-84`). Tovu's admin already wires this bridge (`apps/admin/src/App.tsx`, `apps/admin/src/components/AssistantDock.tsx`, `apps/admin/src/lib/assistant-transport.ts` all reference it).
- So today, the browser side can already execute `chat.reset_conversation` if asked — the gap is entirely that (1) no server-side tool named `chat.reset_conversation` existed for the agent to call before this session's wiring, and (2) even once registered, the confirmation gate in §1 has nothing to resolve it.

## 6. A smaller, separate risk worth naming while this is being written up: `chat.send_message`

Not destructive, not blocking, but distinct from the other five non-confirming verbs. `chat.send_message` (`packages/chat/src/core/agentic/chat-capabilities.ts`, first entry) lets the agent inject a message into the conversation "as if the user had typed it into the composer and pressed send." Its own comment notes `surface: 'server'` doesn't actually make it callable headlessly today — `createFrontendCapabilityRegistrations` still routes it through the bound frontend session like every other capability, so a run with no surface gets `no frontend is bound` regardless. But once a surface IS bound (which is the normal case for a chat-originated run), the capability lets the agent originate what looks, in the transcript, like the human's own words — a self-prompting/relay risk distinct from (and independent of) the destructive-write risk `reset_conversation` carries. Worth a second look when this manifest's six shipped verbs get their own review, even though it does not block anything and was not part of what this document was asked to trace.

## What is verified vs. inferred, summarized

**Read directly, this session:** `tool-executor.ts:213, 238-247, 350-361, 408-442, 507-515`; `agent-daemon-server.ts:354` (Tovu); `registration-kit.ts:113-130, 378-381`; `pending-confirmations.ts:16-21`; `frontend-capability-tools.ts:127-163`; `frontend-control.ts` (full file, this session's earlier trace); `chat-capabilities.ts` (full file); `page-executor.ts`'s module doc; `frontend-session-bridge.ts:1-40, 81-88`; `content-types/tool-registrations.ts:77`'s `UNWIRED_CONTENT_TYPES_TOOL_IDS`; grep confirming zero `resumeConfirmation` callers in Tovu's `src/`; and, added in this correction pass, `src/assistant/__tests__/tool-registrations.database-recovery.test.ts:228-242` plus a grep confirming `database_execute_migrate_forward`/`backup_execute_restore` are defined in Tovu's `src/features/database/`, `src/features/recovery/` (not Jini/CMS).

**Previously cited from source comments rather than independently chased, now resolved — an example of the honesty-section process working as intended:** the first commit of this document (`d5ad2a5b`) flagged, rather than asserted as fact, that it had not independently verified `database_execute_migrate_forward`/`backup_execute_restore`'s own catalog entries. The coordinator chased it and found two errors at once: they are Tovu tools, not CMS/Jini ones, and they are blocked by a `DERIVED_RISK_BY_TOOL_ID` classification gap that is stronger than and independent of the confirmation-transport gap this document is about. §3 above reflects the corrected, verified count.

**Not attempted:** any check of whether a confirmation-transport primitive exists in a third repo neither of us has visibility into, or whether one is already planned elsewhere.
