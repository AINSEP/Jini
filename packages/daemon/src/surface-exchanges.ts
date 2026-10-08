/**
 * @file A **surface exchange**: a two-way, multi-message conversation with a human, held open inside
 * one agent tool call.
 *
 * ## What this is
 *
 * The agent calls a tool. The tool opens an exchange, sends something for a person to look at, and
 * waits. The person answers. The tool may send again — a follow-up question, an updated component
 * tree, a validation error — and wait again, any number of times. When it is done it closes the
 * exchange and returns, and the human's answers are the tool call's ordinary result. The agent is
 * still alive the whole time, which is what makes the transcript correct by construction rather than
 * reconstructed afterwards (ADR-055 Decision 4).
 *
 * A one-shot ask — show a form, get one submission — is the degenerate case, expressed by
 * {@link askOnce}. It is a helper over this, not a separate mechanism.
 *
 * ## Channel-agnostic on purpose
 *
 * Nothing here knows what a surface *is*. Outbound messages are `@jini-ai/core`'s
 * {@link SurfaceEmission}, which names its own channel; inbound answers are plain records. That is
 * what lets one exchange drive MCP-UI (an HTML surface answering by tool call), A2UI (`createSurface`
 * → action → `updateComponents` → action, which is inherently multi-turn), the run protocol's own
 * channel-neutral `surface_request`/`surface_response` pair, or a paradigm that does not exist yet.
 * The transports differ; "hold the agent's call open and pass messages both ways" does not.
 *
 * ## The inbound buffer is a correctness requirement, not a nicety
 *
 * A message can arrive while the handler is between {@link SurfaceExchange.receive} calls — busy
 * composing its next send. Without somewhere to put it, that message is dropped and the exchange
 * deadlocks on an answer the human already gave. So deliveries queue. This is the one thing that is
 * genuinely painful to retrofit onto a one-shot store, which is why it is here before there is a
 * multi-turn channel wired to need it.
 *
 * ## Opening requires an emitter, so the other deadlock is unrepresentable
 *
 * The second deadlock is structural: a handler waiting for an answer to a message it never managed
 * to send. The daemon reads surfaces out of a *completed* tool result, so the return value cannot
 * carry a message the same call is waiting on — only `ToolExecutionContext.emitSurface` can.
 * {@link SurfaceExchangeStore.open} therefore takes that emitter as a required argument. A handler
 * with no emitter cannot open an exchange at all, and must fail closed without an interactive channel.
 *
 * ## Not a secret
 *
 * An exchange id is a **correlation handle**. It says which in-flight call a message belongs to and
 * confers nothing — contrast the former token store, which minted a genuine secret because the
 * delete it guards is a second tool call the model could otherwise make itself (ADR-055 Decision 3).
 * Ids here are stored in the clear and compared with `===`. Copying that module's hashing and
 * constant-time comparison would imply a security property this handle does not carry.
 *
 * The property this file IS responsible for is narrower: **a message resolves at most one waiting
 * receive, on an exchange opened by the same tool for the same principal.**
 *
 */
import type { Clock, IdGenerator } from '@jini-ai/core/primitives';
import type { SurfaceEmission, SurfaceAnswerChannel, SurfaceExchangeBinding, SurfaceMessage, SurfaceExchangeConversation, SurfaceDeliverySpec, SurfaceExchangeStore } from '@jini-ai/core';
export {
  SURFACE_EXCHANGE_ID_PARAM, SURFACE_DISMISSED_PARAM, SURFACE_TYPED_ANSWER_PARAM,
} from '@jini-ai/core';
export type {
  SurfaceAnswerChannel, SurfaceExchangeBinding, SurfaceMessage, SurfaceDeliveryRejectionReason,
  DeliverResult, SurfaceExchange, SurfaceExchangeConversation, SurfaceDeliverySpec, SurfaceExchangeStore, SurfaceAskThenReport,
} from '@jini-ai/core';
import type { SchedulerPort } from './scheduler.js';
export type { SchedulerPort } from './scheduler.js';

/**
 * How long an exchange may sit with nothing happening before it gives up.
 *
 * Per *turn*, not per exchange: it resets whenever a message is sent or received, so a long
 * multi-turn conversation is not punished for taking several turns — only for a human who walked
 * away. Long enough to read a dialog and decide, short enough that an abandoned tab does not hold a
 * live agent subprocess open.
 */
export const DEFAULT_SURFACE_IDLE_TTL_MS = 5 * 60 * 1000;
/**
 * Hard ceiling on one exchange's total life, regardless of activity.
 *
 * Exists because the idle deadline alone is unbounded in aggregate — a human answering every four
 * minutes could hold a call open indefinitely, and the call is not ours to hold: it is an HTTP
 * request from the spawned agent's MCP server, which gives up after 6 minutes (`@jini-ai/mcp`'s
 * delegated-tool deadline). Sized just inside that, so a stalled exchange returns an explicit result
 * the model can read rather than having the transport time out underneath it.
 *
 * **This, not the idle deadline, is what caps a multi-turn conversation today.** Raising it means
 * raising the transport deadline first; the two must move together or the ordering inverts.
 */
export const DEFAULT_SURFACE_MAX_LIFETIME_MS = 5.5 * 60 * 1000;
interface Registered { binding: SurfaceExchangeBinding; accept: (params: Record<string, unknown>) => void }

/** Distinguishes an ended exchange from an emitter failure without matching error text. */
class SurfaceExchangeEndedError extends Error {
  constructor({ id, terminal }: { id: string; terminal: SurfaceMessage }) {
    super(`surface exchange ${id} has already ended`);
    this.terminal = terminal;
  }
  readonly terminal: SurfaceMessage;
}

/**
 * Creates an in-process store of open surface exchanges.
 *
 * In-process necessarily, not merely by choice: an open exchange is a suspended function call in
 * this process's memory. It could not be shared across processes even if that were desirable.
 * `mcp-ui-tool-calls-route.ts` is mounted on the same daemon the handlers run in, which is what makes
 * delivery a direct call rather than another network hop.
 *
 * @param options.idleTtlMs - Per-turn inactivity deadline. See {@link DEFAULT_SURFACE_IDLE_TTL_MS}.
 * @param options.maxLifetimeMs - Total lifetime ceiling. See {@link DEFAULT_SURFACE_MAX_LIFETIME_MS}.
 * @param deps.idGenerator - Id source, injected so a test can assert a known value.
 * @param deps.clock - Wall clock for {@link SurfaceExchange.expiresAtMs}. The injected scheduler owns
 * the timers; the clock dates and checks their deadlines.
 * @complexity O(1) per send/receive/deliver. Each exchange owns two `unref`'d timers.
 */
export function createSurfaceExchangeStore(
  deps: { scheduler: SchedulerPort; clock: Clock; idGenerator: IdGenerator; defaultChannel: SurfaceAnswerChannel },
  { idleTtlMs = DEFAULT_SURFACE_IDLE_TTL_MS, maxLifetimeMs = DEFAULT_SURFACE_MAX_LIFETIME_MS }: { idleTtlMs?: number; maxLifetimeMs?: number } = {},
): SurfaceExchangeStore {
  if (!Number.isFinite(idleTtlMs) || idleTtlMs <= 0 || !Number.isFinite(maxLifetimeMs) || maxLifetimeMs <= 0) throw new Error('surface deadlines must be finite and positive');
  const openExchanges = new Map<string, Registered>();
  return {
    open({ binding, emit }, _optional = {}) {
      // Waiting without a live emitter is a deadlock; reject before allocating any timers or ID.
      if (typeof emit !== 'function') throw new Error('surface exchange requires an emitter');
      const id = deps.idGenerator.newId();
      if (!id || openExchanges.has(id)) throw new Error('surface exchange ID must be unique and nonempty');
      const inbox: Record<string, unknown>[] = [];
      const waiters: ((message: SurfaceMessage) => void)[] = [];
      let terminal: SurfaceMessage | undefined;
      let cancelIdle: (() => void) | undefined;
      let cancelLifetime: (() => void) | undefined;
      const lifetimeDeadline = deps.clock.nowMs() + maxLifetimeMs;
      let idleDeadline = deps.clock.nowMs() + idleTtlMs;
      function end(reason: SurfaceMessage): void {
        if (terminal) return;
        terminal = reason;
        cancelIdle?.();
        cancelLifetime?.();
        openExchanges.delete(id);
        while (waiters.length > 0) waiters.shift()!(reason);
      }
      function expireIfDue(): void {
        const at = deps.clock.nowMs();
        if (at >= idleDeadline || at >= lifetimeDeadline) end({ status: 'expired' });
      }
      function armIdle(): void {
        if (terminal) return;
        cancelIdle?.();
        idleDeadline = deps.clock.nowMs() + idleTtlMs;
        cancelIdle = deps.scheduler.schedule({ delayMs: idleTtlMs, callback: () => end({ status: 'expired' }) });
      }
      // Register only after both timers are installed, so scheduler failure leaves no discoverable exchange.
      try {
        cancelLifetime = deps.scheduler.schedule({ delayMs: maxLifetimeMs, callback: () => end({ status: 'expired' }) });
        armIdle();
      } catch (error) { cancelLifetime?.(); cancelIdle?.(); throw error; }
      openExchanges.set(id, {
        binding: { ...binding },
        accept(params) {
          expireIfDue();
          if (terminal) return;
          armIdle();
          const waiter = waiters.shift();
          if (waiter) waiter({ status: 'received', params });
          // The human can answer while the handler composes its next send. Queue rather than
          // drop: dropping would deadlock the exchange on an answer already given.
          else inbox.push(params);
        },
      });
      return {
        id,
        async send({ emission }, _optional = {}) {
          expireIfDue();
          if (terminal) throw new SurfaceExchangeEndedError({ id, terminal });
          armIdle();
          await emit(emission);
        },
        async receive(_args: Record<string, never>, _optional = {}) {
          expireIfDue();
          // Preserve the original FIFO contract: already delivered answers precede terminal status.
          const buffered = inbox.shift();
          if (buffered) { armIdle(); return { status: 'received', params: buffered }; }
          if (terminal) return terminal;
          return new Promise<SurfaceMessage>(resolve => waiters.push(resolve));
        },
        close(_args: Record<string, never>, _optional = {}) { end({ status: 'abandoned' }); },
        expiresAtMs() { return Math.min(idleDeadline, lifetimeDeadline); },
      };
    },
    deliver(requiredArgs: Pick<SurfaceDeliverySpec, "exchangeId" | "params" | "principalId">, optionalArgs: Pick<SurfaceDeliverySpec, "toolId" | "channel"> = {}) {
      const spec: SurfaceDeliverySpec = { ...requiredArgs, ...optionalArgs };
      const entry = openExchanges.get(spec.exchangeId);
      // Unknown and closed are the same situation to a human whose dialog is no longer waiting.
      if (!entry) return { ok: false, reason: 'unknown-or-closed' };
      if ((spec.toolId !== undefined && entry.binding.toolId !== spec.toolId)
        || (entry.binding.channel ?? deps.defaultChannel) !== (spec.channel ?? deps.defaultChannel)
        || entry.binding.principalId !== spec.principalId) {
        // A wrong-binding delivery must not consume a conversation the right human is still having.
        return { ok: false, reason: 'binding-mismatch' };
      }
      entry.accept(spec.params);
      return openExchanges.has(spec.exchangeId) ? { ok: true } : { ok: false, reason: 'unknown-or-closed' };
    },
    findTypedAnswerTarget({ principalId, toolId }, _optional = {}) {
      let found: string | undefined;
      for (const [id, entry] of openExchanges) {
        if (entry.binding.principalId !== principalId || entry.binding.toolId !== toolId) continue;
        // Two questions for the same human and tool are ambiguous; never guess which prose answers.
        if (found !== undefined) return undefined;
        found = id;
      }
      return found;
    },
    size: () => openExchanges.size,
  };
}

/**
 * The one-shot case: send once, wait once, close.
 *
 * Kept as a helper rather than a second mechanism, because "ask a question and get one answer" is
 * genuinely just the shortest exchange. Anything that later needs a follow-up turn stops calling this
 * and drives the exchange directly, with no change to the store, the route, or the transport.
 */
export async function askOnce(
  { exchange, emission }: { exchange: SurfaceExchangeConversation; emission: SurfaceEmission },
  _optional: Record<string, never> = {},
): Promise<SurfaceMessage> {
  try { return await sendThenReceive({ exchange, emission }); }
  finally { exchange.close({}); }
}

/**
 * Sends a question and waits for its answer without closing the exchange.
 * Expiry can precede the first send while a caller builds its dialog. Return that terminal result,
 * never emit or consume a buffered confirmation on an ended exchange; emitter failures still throw.
 * @complexity O(1) plus the emitter's cost; no additional buffering or timers.
 */
async function sendThenReceive(
  { exchange, emission }: { exchange: SurfaceExchangeConversation; emission: SurfaceEmission },
  _optional: Record<string, never> = {},
): Promise<SurfaceMessage> {
  try { await exchange.send({ emission }); }
  catch (error) {
    if (error instanceof SurfaceExchangeEndedError) return error.terminal;
    throw error;
  }
  return exchange.receive({});
}
/**
 * Like {@link askOnce}, but for a call whose answer triggers real work whose OUTCOME the human also
 * needs to see — a publish, a delete, a credential save. `askOnce` alone cannot express this: it
 * closes the exchange the instant an answer arrives, so a caller that awaited it and then tried to
 * `exchange.send()` a result would find the exchange already dead (`send()` throws "already ended").
 *
 * ## The defect this exists to fix
 *
 * A confirmation surface's own script (`confirmation.ts`) sets its status text to "Done." the moment
 * the confirming `tools/call` RESOLVES — and for a held-open exchange delivered through
 * `mcp-ui-tool-calls-route.ts`'s Shape 1, that call resolves the instant the click is DELIVERED to
 * the parked agent call (`{delivered: true}`, HTTP 202), which happens before the parked handler has
 * done anything with the answer yet, let alone finished. "Done." therefore means "your click
 * reached the server," never "the thing you asked for actually happened" — a 404, a rejected
 * credential, and a genuine success all render the identical "Done." to the human. `handle` below is
 * where a caller does the real work and decides what actually happened; the outcome emission this
 * function sends afterward is what corrects the record.
 *
 * ## How the correction reaches the screen
 *
 * The outcome emission is expected to reuse the SAME `ui://` URI the confirmation was sent under.
 * `McpUiSurfaceCard` (`@jini-ai/chat`) already collapses a stream to the newest resource per URI —
 * "a stream may re-send an updated document for a surface already on screen (a confirmation that
 * became a result), so the LAST event for each URI wins" (that component's own doc) — and
 * `McpUiHost` keys its iframe by `` `${uri}:${documentText}` ``, so a new document forces a clean
 * remount rather than leaving the confirmation's stale Confirm/Cancel buttons on screen. Neither of
 * those needed a change for this to work; this function only needed to make the SECOND send possible.
 *
 * ## Why `handle` returns the outcome rather than the caller sending it separately
 *
 * Keeping the send here, not in the caller, is what makes the try/catch below unconditional: a
 * caller could forget to wrap its own `exchange.send()`, but every caller of this function gets the
 * protection for free. `outcome` is OPTIONAL in the return — a cancelled/expired/abandoned answer has
 * nothing to correct (the confirmation's own script already reports "Dismissed." for a local cancel,
 * and an exchange that ended via a timeout is already closed, so `send()` would throw anyway); a
 * caller for that branch simply omits it.
 *
 * ## The one invariant this function protects
 *
 * `result` — what reaches the model — must NEVER depend on the outcome emission actually reaching a
 * screen. A human who closed the tab, a `send()` racing a teardown, or any other failure in the
 * human-visible half must be invisible to the tool's own JSON contract, which is why the outcome send
 * is wrapped in its own `try`/`catch` rather than sharing `handle`'s.
 *
 * @param exchange - Opened the same way `askOnce` expects one.
 * @param confirmationEmission - Sent once, exactly like `askOnce`'s own `emission` parameter.
 * @param handle - Runs after the answer arrives (whatever it is — received, expired, abandoned).
 *   Does the caller's real work and returns `result` (returned to THIS function's own caller,
 *   ultimately the model) plus an optional `outcome` emission to report back to the human.
 * @complexity O(1) plus whatever `handle` itself costs — this function adds one conditional send and
 *   the same `close()` `askOnce` already pays.
 */
export async function askThenReport<T>({ exchange, confirmationEmission, handle }: {
  exchange: SurfaceExchangeConversation; confirmationEmission: SurfaceEmission;
  handle: (answer: SurfaceMessage) => Promise<{ result: T; outcome?: SurfaceEmission }>;
}, _optional: Record<string, never> = {}): Promise<T> {
  try {
    const { result, outcome } = await handle(await sendThenReceive({ exchange, emission: confirmationEmission }));
    if (outcome !== undefined) { try { await exchange.send({ emission: outcome }); } catch { /* Model result remains authoritative. */ } }
    return result;
  } finally { exchange.close({}); }
}
/**
 * Whether the human confirmed, declined, or never answered at all — the fail-closed classification
 * every confirm/cancel-shaped tool call needs (a delete, a commit, a publish, ...). Extracted after
 * this exact logic had been copy-pasted at least 4 times (`features/post/tool-registrations.ts`'s
 * `resolveDeleteDecision`, then `features/custom-credentials`, `features/source-control`, and
 * `features/deployments/publish-agent-tools.ts`, each self-described as mirroring the first), with
 * the SAME "fail closed, never read a missing/malformed decision as consent" fix required at every
 * site (see `classifyConfirmationAnswer`'s own doc).
 *
 * `"declined"` covers an explicit non-`"confirm"` decision — a real Cancel click, and equally a
 * missing, non-string, or unrecognised `decision` field, all fail-closed to the same outcome.
 * `"expired"`/`"abandoned"` mirror {@link SurfaceMessage}'s own non-`"received"` statuses one-for-one
 * (ADR-055 Decision 6: no-answer is a result, not a thrown error).
 */
export type ConfirmationOutcome = { confirmed: true } | { confirmed: false; reason: 'declined' | 'expired' | 'abandoned' };
/**
 * Classifies an already-received {@link SurfaceMessage} as confirmed or not.
 *
 * Pure and synchronous on purpose: a caller that already holds an `answer` from somewhere other than
 * a fresh {@link askOnce} call — `askThenReport`'s own `handle` callback, for instance, which receives
 * the message directly because a second `exchange.send()` still needs to happen afterward — can
 * classify it without a second round trip. {@link resolveConfirmationDecision} below is the `askOnce`
 * convenience built on top of this for callers that do not need that.
 *
 * Fail-closed is the entire contract: only a `params.decision` field that is literally the string
 * `"confirm"` proceeds. A missing field, a non-string value, or any other string must never be read
 * as consent for a destructive or externally-visible action.
 *
 * @complexity O(1).
 */
export function classifyConfirmationAnswer(
  { answer }: { answer: SurfaceMessage },
  _optional: Record<string, never> = {},
): ConfirmationOutcome {
  if (answer.status !== 'received') return { confirmed: false, reason: answer.status };
  return answer.params['decision'] === 'confirm' ? { confirmed: true } : { confirmed: false, reason: 'declined' };
}
/**
 * {@link askOnce} plus {@link classifyConfirmationAnswer} — the whole "ask, then fail-closed classify"
 * sequence every confirm/cancel-shaped delete/commit/publish tool repeats. A caller still owns its own
 * domain-specific result shape for each branch (see e.g. `features/post/tool-registrations.ts`'s own
 * `resolveDeleteDecision`) — this only shares the parked-ask-and-classify mechanics, not the result,
 * so each site's `deleted`/`committed`/`published`/... wording stays exactly what it was.
 *
 * @complexity O(1) plus whatever {@link askOnce} costs.
 */
export async function resolveConfirmationDecision(
  args: { exchange: SurfaceExchangeConversation; emission: SurfaceEmission },
  _optional: Record<string, never> = {},
): Promise<ConfirmationOutcome> {
  return classifyConfirmationAnswer({ answer: await askOnce(args) });
}
/**
 * Cross-domain machinery a surface-raising tool needs that is not a domain dependency at all.
 *
 * Kept separate from `tool-registrations.ts`'s `AssistantToolRegistryDeps` on purpose: that bag is
 * "the same dependencies the admin HTTP routes are built from", which is what makes a tool call and
 * the equivalent human click reach identical domain code. An exchange store is not part of that
 * equivalence — it belongs to the assistant's transport, and only tools that talk to a human mid-call
 * ever touch it. Declared in this module rather than alongside the registration wiring so a tool can
 * name it without importing the file that imports the tool.
 */
export interface AssistantSurfaceDeps {
  /** The handlers and callback route must share this same in-process store. Opening in one store
   * and delivering to another leaves the human's answer unreachable until the deadline expires. */
  readonly surfaceExchanges: SurfaceExchangeStore;
}
