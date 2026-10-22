/**
 * Shared surface-exchange ABI. The daemon owns the store and ask/report implementation;
 * consumers inject those ports without depending on the daemon runtime.
 */
import type { SurfaceEmission, SurfaceEmitter } from './tool-registry.js';

/**
 * The callback param carrying an exchange id from a rendered surface back to the server.
 *
 * Double-underscored to keep it clear of a surface's real fields, and named in one place because
 * three parties must agree on it: whatever builds the surface, the route that routes on it, and the
 * handler that opened the exchange.
 *
 * This is MCP-UI's carrier specifically, because an mcp-ui surface can only answer by issuing a tool
 * call, so its correlation has to ride inside that call's params. A channel that can name the
 * exchange directly should do so — `mcp-ui-tool-calls-route.ts` also accepts a top-level
 * `exchangeId`, and A2UI/`surface_request` correlate by their own `surfaceId`.
 */
export const SURFACE_EXCHANGE_ID_PARAM = '__exchangeId';
/**
 * The callback param a surface's Cancel action sets, so a dismissal resolves the exchange
 * immediately instead of stranding the agent until the idle deadline.
 *
 * Carried as data rather than as a distinct {@link SurfaceMessage} status: "the human answered, and
 * the answer was no" is genuinely an answer, and only the tool that built the surface knows what a
 * dismissal means for its own result.
 */
export const SURFACE_DISMISSED_PARAM = '__dismissed';
/**
 * The callback param carrying free text a human TYPED — into the chat composer — as their answer to
 * an outstanding surface, rather than clicking the rendered form.
 *
 * ## The deadlock this exists to break
 *
 * A held-open exchange can only be resolved by a message that names it, and until now every param
 * shape a surface posts back was one the FORM produced. A human who reads the question, ignores the
 * dialog and types the answer into the composer therefore resolved nothing: their message was queued
 * behind the very run it was meant to unblock, and the agent sat parked until the idle deadline
 * fired minutes later.
 *
 * ## Why it is a separate param rather than the tool's own answer fields
 *
 * Prose is not a selection. A tool whose answer fields are option VALUES the model itself supplied
 * (`assistant_ask_choice`'s `choice`/`selections`) would, if prose were poured into them, report to
 * the model that the administrator picked an option that was never offered. Carrying typed text
 * under its own name is what forces each tool to decide, explicitly, what a typed answer means for
 * its own result — and lets a tool that has no safe reading of one simply ignore it.
 *
 * ## What it deliberately cannot do
 *
 * It cannot confirm anything. `classifyConfirmationAnswer` reads only a literal `decision:
 * "confirm"`, so a typed answer arriving at a confirmation-shaped exchange fails closed to
 * `"declined"` with no code change and no exception — which is the correct reading of "the human
 * wrote a sentence instead of clicking Confirm". Nothing here should ever grow a prose-to-consent
 * mapping.
 *
 * Double-underscored, and named here rather than at a tool, for the same reason as
 * {@link SURFACE_EXCHANGE_ID_PARAM}: several parties must agree on the spelling.
 */
export const SURFACE_TYPED_ANSWER_PARAM = '__typedAnswer';
/**
 * Which inbound route may answer an exchange. `"mcp-ui"` (the host's default) is a tool-call-shaped answer
 * posted to the MCP-UI route; `"a2ui"` is a renderer message posted to the A2UI route. A2UI posts
 * carry no `toolId`, so without this an A2UI message could land in, and cancel, a pending MCP-UI
 * confirmation of the same principal.
 */
export type SurfaceAnswerChannel = string;
/** Who an exchange belongs to. Checked on every delivery; a mismatch is a rejection, not a warning. */
export interface SurfaceExchangeBinding {
  /** The tool that opened it. A message for one tool cannot resolve another's exchange. */
  readonly toolId: string;
  /** The principal whose run opened it: one human's answer must not land in another's call. */
  readonly principalId: string;
  /** The route allowed to answer it; omission uses the store's injected default channel. */
  readonly channel?: SurfaceAnswerChannel;
}
/**
 * One inbound message, or the reason there will not be one.
 *
 * The non-`received` cases are part of the contract rather than error handling (ADR-055 Decision 6):
 * blocking moves the timeout story, it does not remove it, and a handler must be able to tell the
 * model something true about which happened.
 */
export type SurfaceMessage = { status: 'received'; params: Record<string, unknown> } | { status: 'expired' } | { status: 'abandoned' };
/** Why a delivery did not reach an exchange. Reported to the browser, never to the model. */
export type SurfaceDeliveryRejectionReason = 'unknown-or-closed' | 'binding-mismatch';
export type DeliverResult = { ok: true } | { ok: false; reason: SurfaceDeliveryRejectionReason };
/** A live, two-way conversation bound to one in-flight tool call. */
export interface SurfaceExchange {
  /** Correlation handle embedded in the human's answer carrier; not a secret. */
  readonly id: string;
  /**
   * Sends one message out to the human.
   *
   * @throws {Error} If the exchange has already ended — the same posture the daemon's emitter takes,
   * because a message sent onto a settled call has no way to be answered.
   */
  send(args: { emission: SurfaceEmission }, optional?: Record<string, never>): Promise<void>;
  /**
   * Waits for the next inbound message.
   *
   * Returns a buffered one immediately if the human answered while the handler was busy. Once the
   * exchange has ended, returns that terminal status rather than hanging — so a handler looping on
   * `receive()` terminates instead of waiting out the transport.
   */
  receive(_args: Record<string, never>, optional?: Record<string, never>): Promise<SurfaceMessage>;
  /** Ends the exchange idempotently. Pending receives resolve "abandoned"; an ended exchange is unchanged. */
  close(_args: Record<string, never>, optional?: Record<string, never>): void;
  /**
   * When the exchange expires if nothing more happens, in epoch ms: the earlier of the idle and
   * lifetime deadlines. Activity moves the idle one, so read it right before rendering a deadline
   * for the human; a card drawn just before its `send()` shows a deadline a few ms early, never late.
   */
  expiresAtMs(): number;
}
/** Messaging helpers do not require deadline tracking. Hosts may supply a conversation port
 * without a deadline; the daemon store always returns the full, dated SurfaceExchange. */
export type SurfaceExchangeConversation = Omit<SurfaceExchange, 'expiresAtMs'> & Partial<Pick<SurfaceExchange, 'expiresAtMs'>>;
/**
 * What a delivery must prove about itself. `principalId` is load-bearing for every channel — one
 * human's answer must never land in another's call. `toolId` is load-bearing only for a channel
 * whose correlation carrier is itself a tool call: MCP-UI's surface can only answer by issuing one,
 * so it always has a real tool name to offer, and the store checks it.
 *
 * A channel that correlates directly by its own id — A2UI's `surfaceId`, the run protocol's own
 * `surface_request`/`surface_response` — has no natural `toolId` to supply; the browser never
 * learns which tool opened the exchange, only its id. Requiring one anyway would force such a
 * channel to either lie (send a placeholder that means nothing) or grow a lookup this store does
 * not expose. So `toolId` is optional here: when a caller supplies it, it must still match exactly
 * (MCP-UI's behavior is unchanged, byte for byte); when omitted, only `principalId` and the
 * exchange's own unguessable `randomUUID()` id gate the delivery. That pair is still sufficient —
 * the id is not enumerable, and `principalId` is a server-verified session identity, never a value
 * the browser chooses (see `run-ownership.ts`) — so relaxing the caller's OBLIGATION does not
 * relax the exchange's own binding, which `open()` still records honestly as whatever tool actually
 * opened it.
 */
export interface SurfaceDeliverySpec {
  exchangeId: string; params: Record<string, unknown>; principalId: string; toolId?: string; channel?: SurfaceAnswerChannel;
}
export interface SurfaceExchangeStore {
  /**
   * Opens an exchange bound to one in-flight tool call.
   *
   * @param args.emit - The call's live {@link SurfaceEmitter}. Required, not optional: an exchange whose
   * messages cannot reach anybody is a guaranteed deadlock, and taking the emitter here is what makes
   * that state unrepresentable rather than merely discouraged.
   */
  open(args: { binding: SurfaceExchangeBinding; emit: SurfaceEmitter }, optional?: Record<string, never>): SurfaceExchange;
  /**
   * Routes one inbound message to the exchange it names, queueing it if nothing is waiting yet.
   * See {@link SurfaceDeliverySpec} for why `toolId` is optional rather than part of
   * {@link SurfaceExchangeBinding} here.
   */
  deliver(requiredArgs: Pick<SurfaceDeliverySpec, 'exchangeId' | 'params' | 'principalId'>, optionalArgs?: Pick<SurfaceDeliverySpec, 'toolId' | 'channel'>): DeliverResult;
  /**
   * Resolves which open exchange a TYPED answer is for, when the human named none.
   *
   * A person typing into the chat composer does not know exchanges exist, so they cannot carry a
   * {@link SURFACE_EXCHANGE_ID_PARAM} the way a rendered form does. This store is the only thing
   * that knows what is open, so the correlation is recovered here rather than guessed by a client
   * scraping an id out of the surface's own (model-influenced) HTML.
   *
   * Scoped by `toolId` as well as `principalId` on purpose: it is an OPT-IN, not a broadcast. Only
   * a tool that has a safe reading of prose should ever be named here, which is what keeps typed
   * text away from confirmation-shaped exchanges (see {@link SURFACE_TYPED_ANSWER_PARAM}).
   *
   * @returns The single matching open exchange's id, or `undefined` when there is none — or more
   * than one. Ambiguity fails closed: delivering to the wrong one would silently answer a question
   * the human was not looking at, and report their words as an answer to it.
   * @complexity O(n) in the number of open exchanges, which is bounded by concurrent agent runs.
   */
  findTypedAnswerTarget(args: { principalId: string; toolId: string }, optional?: Record<string, never>): string | undefined;
  /** Open, unsettled count — for tests and diagnostics only. */
  size(): number;
}

/** Send a form, handle its answer, report the outcome, and finally close the exchange.
 * Supply `askThenReport` from `@jini-ai/daemon/surface-exchanges` at the host boundary. */
export type SurfaceAskThenReport = <Result>(args: {
  exchange: SurfaceExchangeConversation;
  confirmationEmission: SurfaceEmission;
  handle: (answer: SurfaceMessage) => Promise<{ result: Result; outcome?: SurfaceEmission }>;
}, optional?: Record<string, never>) => Promise<Result>;
