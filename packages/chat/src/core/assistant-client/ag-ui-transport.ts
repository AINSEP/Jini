import { describeErrorForLog } from '@jini-ai/core/model-facing-tool-errors';
/**
 * @module assistant-transport-ag-ui
 * ADR-059: a host-injected official HttpAgent owns HTTP, SSE framing and event validation for a
 * projection of the same daemon lifecycle. No second run lifecycle or local SSE parser lives here.
 * HttpAgent.run returns a cold Observable: subscribe to start it, then resolve startAgUiRun on
 * the first notification, rather than await the Observable or wait for the whole run to finish.
 * Mid-stream abort arrives as RUN_ERROR{code:"abort"} on the normal event path and finishes cleanly.
 * Before headers, abort instead rejects fetch and reaches subscription.error; inspect the signal
 * there so an intentional stop cannot become a user-facing failure.
 */
import type { Message, RunAgentInput, RunStartedEvent } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import { createAgUiToAgentTranslationState, translateAgUiEventToAgentEvent } from "../ag-ui/event-reduction.js";
import type { AgUiToAgentTranslationState } from "../ag-ui/event-reduction.js";
import type { AgUiEvent, CustomEventNames } from "../ag-ui/event-projection.js";
import type { ChatMessage } from "../messages.js";
import type { RunHandlers, StartRunInput } from "../transport.js";
import type { DurableRunBinding } from "./durable-run-subscription.js";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

export { createAgUiFetchAgent } from "./ag-ui-fetch-agent.js";
export type { AgUiFetchAgent } from "./ag-ui-fetch-agent.js";

export interface AgUiClient {
 readonly abortController: AbortController;
 abortRun(): void;
 run(input: RunAgentInput): { subscribe(observer: { next: (event: unknown) => void; error: (error: unknown) => void; complete: () => void }): unknown };
}
export interface AgUiClientPorts {
 readonly onLiveEvent?: (required: { event: AgUiEvent }) => boolean;
 readonly endpoint: string; readonly runIdPrefix: string; readonly customEventNames: CustomEventNames;
 readonly mintId: (required: Record<string, never>, optional: Record<string, never>) => string;
 readonly createAgent: (required: { url: string; threadId: string }, optional: Record<string, never>) => AgUiClient;
 /** Opt-in: bind each start to the durable Local CLI lifecycle. Absent, behavior is unchanged. */
 readonly durableLocalCli?: AgUiDurableLocalCliBinding;
}

/** The prepared Local CLI start (`prepareLocalRunStart`): the same launch projection, agent
 *  selection, message identity and conversation binding the Local CLI acceptance sends. */
export interface LocalRunLaunch {
  readonly contextRef: Record<string, unknown>;
  readonly agentId?: string | undefined;
  readonly messageId?: string | undefined;
  readonly conversationId?: string | undefined;
}

/** The canonical durable run a host accepted for one AG-UI start. */
export interface AcceptedAgUiRun { readonly runId: string; readonly messageId: string; readonly conversationId: string }

/** Neutral host hooks that bind an AG-UI delivery segment to the durable chat lifecycle. The
 *  logical message is durable; the AG-UI stream only delivers part of it. */
export interface AgUiDurableLocalCliBinding {
  /** Project the prepared launch onto the wire request. `wire` keeps the client segment ID. */
  prepareRunInput(required: { input: StartRunInput; wire: RunAgentInput; launch: LocalRunLaunch }, optional?: Record<string, never>): RunAgentInput;
  /** Interpret the validated RUN_STARTED as an acceptance, or `undefined` when it carries none. */
  readAcceptedRun(required: { event: RunStartedEvent; input: RunAgentInput }, optional?: Record<string, never>): AcceptedAgUiRun | undefined;
  /** Follow the canonical run's saved checkpoints. `signal` is detach only, never Stop. */
  followAcceptedRun(required: AcceptedAgUiRun & { handlers: RunHandlers; signal: AbortSignal }, optional?: Record<string, never>): void;
  /** Explicit Stop of the canonical run. Called at most once per accepted run. */
  cancelAcceptedRun(required: AcceptedAgUiRun, optional?: Record<string, never>): Promise<void>;
  cancelPendingRun(required: { messageId: string; conversationId: string }, optional?: Record<string, never>): Promise<void>;
}

/** What `startAgUiRun` needs to bind a durable start: the prepared launch and the binding store. */
export interface AgUiDurableStart {
  readonly launch: LocalRunLaunch;
  readonly bindRun: (required: { runId: string; binding: DurableRunBinding }, optional: Record<string, never>) => void;
}
export interface AgUiEventContext {
  collected: AgentEvent[]; handlers: RunHandlers; state: AgUiToAgentTranslationState; finish: () => void;
}
export interface AgUiRunClient {
  isAgUiRunId(required: { runId: string }, optional?: Record<string, never>): boolean;
  handleAgUiEvent(required: { event: AgUiEvent; ctx: AgUiEventContext }, optional?: Record<string, never>): void;
  startAgUiRun(required: { input: StartRunInput; handlers: RunHandlers; durable?: AgUiDurableStart }, optional?: Record<string, never>): Promise<{ runId: string }>;
  resumeAgUiRun(required: { input: StartRunInput; handlers: RunHandlers; threadId: string; parentRunId: string; resume: NonNullable<RunAgentInput["resume"]> }, optional?: Record<string, never>): Promise<{ runId: string }>;
  reattachAgUiRun(required: { handlers: RunHandlers }, optional?: Record<string, never>): Promise<void>;
  fetchAgUiRunStatus(required: Record<string, never>, optional?: Record<string, never>): Promise<null>;
  stopAgUiRun(required: { runId: string }, optional?: Record<string, never>): Promise<void>;
  /** True for a canonical run ID this client accepted through its durable binding. */
  readonly durableLocalCli?: boolean;
  isAcceptedAgUiRun?(required: { runId: string }, optional?: Record<string, never>): boolean;
}
/** Only the originating attachment can authorize page execution. Read its token and tab for every
 * turn; caller-supplied tool definitions never authorize or execute a transcript event.
 * @complexity O(1) time and space.
 * @overallScore 100 */
function frontendBinding({ input }: { input: StartRunInput }, _options = {}): Record<string, string> {
  const token = input.context?.["frontendBindToken"];
  const tabId = input.context?.["frontendTabId"];
  return {
    ...(typeof token === "string" && token.length > 0 ? { frontendBindToken: token } : {}),
    ...(typeof tabId === "string" && tabId.length > 0 ? { frontendTabId: tabId } : {}),
  };
}

/** What one in-flight turn's start, subscription and single settle share. `agents` is the owning
 *  client's registry, so forgetting a turn is one step wherever it happens. */
interface AgUiRunTurn {
  readonly runId: string;
  readonly agent: AgUiClient;
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly handlers: RunHandlers;
  readonly collected: AgentEvent[];
  readonly agents: Map<string, AgUiClient>;
  settled: boolean;
  readonly durable?: DurableTurn;
}

/** One accepted canonical run: Stop through any route reaches `cancelAcceptedRun` once. */
interface AcceptedEntry { readonly accepted: AcceptedAgUiRun; cancel?: Promise<void> }

/** Durable-binding state of one turn. `accepted` flips once; afterwards the segment is delivery only. */
interface DurableTurn {
  readonly binding: AgUiDurableLocalCliBinding;
  readonly start: AgUiDurableStart;
  readonly acceptedRuns: Map<string, AcceptedEntry>;
  readonly input: StartRunInput;
  readonly cancelSignal: AbortSignal | undefined;
  readonly requestStop: () => void;
  stopRequested: boolean;
  pendingCancel?: Promise<void>;
  accepted?: AcceptedEntry;
}

/**
 * Dispatches one already-parsed AG-UI event. `HttpAgent` owns SSE framing and per-event zod
 * validation entirely, and hands us finished event objects. `RUN_ERROR` with `code: "abort"` is the
 * real package's own convention for a mid-stream abort (see module doc) — routed to `finish()`, not
 * `onError`. Every other event is reduced through {@link translateAgUiEventToAgentEvent} and
 * forwarded to both `collected` (the final transcript `onDone` receives) and `handlers.onEvent`
 * (live rendering).
 */
function handleAgUiEvent({ event, ctx, onLiveEvent }: { event: AgUiEvent; ctx: AgUiEventContext; onLiveEvent?: AgUiClientPorts["onLiveEvent"] }, _optional: Record<string, never> = {}): void {
  if (event.type === EventType.RUN_ERROR) {
    if (event.code === "abort") {
      ctx.finish();
      return;
    }
    ctx.handlers.onError(new Error(event.message || "AG-UI run failed"));
    ctx.finish();
    return;
  }
  if (event.type === EventType.RUN_FINISHED) {
    onLiveEvent?.({ event });
    ctx.finish();
    return;
  }
  if (onLiveEvent?.({ event })) return;
  for (const translated of translateAgUiEventToAgentEvent({ event, state: ctx.state }, {})) {
    ctx.collected.push(translated);
    ctx.handlers.onEvent(translated);
  }
}

/** Every AG-UI message role requires an id; preserve ChatMessage.id across translation. */
function toAgUiMessage({ message }: { message: ChatMessage }, _optional: Record<string, never> = {}): Message {
  if (message.role === "user") return { id: message.id, role: "user", content: message.content };
  return { id: message.id, role: "assistant", content: message.content };
}

/** The request body of one turn. The daemon owns tool registrations, so `tools` stays empty; blank
 *  messages are left out because they carry nothing to answer. */
function toRunAgentInput(
  { input, runId, threadId }: { input: StartRunInput; runId: string; threadId: string },
  _optional: Record<string, never> = {},
): RunAgentInput {
  return {
    threadId,
    runId,
    state: null,
    messages: input.history.filter((message) => message.content.trim().length > 0).map((message) => toAgUiMessage({ message })),
    tools: [],
    context: [],
    forwardedProps: {
      ...frontendBinding({ input }),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.history.findLast(message => message.role === "user")?.secretRedaction?.secretRedacted ? { secretRedacted: true } : {}),
    },
  };
}

/** Drops the segment's registry entry so `stopAgUiRun` cannot reach a dead agent; an accepted
 *  follower keeps its signal listeners until completion or detach. Safe to repeat. */
function forgetRun({ turn }: { turn: AgUiRunTurn }, _optional: Record<string, never> = {}): void {
  turn.agents.delete(turn.runId);
  if (turn.durable?.accepted) return;
  turn.signal.removeEventListener("abort", turn.abort);
  turn.durable?.cancelSignal?.removeEventListener("abort", turn.durable.requestStop);
}

/** The one place a turn is finished: `onDone` receives the collected events exactly once, however
 *  many of RUN_FINISHED, an abort, a stream error and `complete` arrive. */
function settleRunOnce({ turn, error }: { turn: AgUiRunTurn; error?: Error }, _optional: Record<string, never> = {}): void {
  if (turn.settled) return;
  turn.settled = true;
  forgetRun({ turn });
  // An accepted turn's follower owns the one final transcript and usage.
  if (turn.durable?.accepted) return;
  // Error THEN finish: an errored Observable never calls `complete`, so without this the turn
  // is never settled and the events collected before the failure never reach `onDone`. Same
  // order as `subscribeToRun`'s `end` listener, so the run is still recorded as failed.
  if (error) turn.handlers.onError(error);
  turn.handlers.onDone(turn.collected);
}

/** Stop through the cancel signal or `stopAgUiRun` converges here: one cancel per accepted run. */
function cancelAcceptedOnce({ entry, binding }: { entry: AcceptedEntry; binding: AgUiDurableLocalCliBinding }, _optional: Record<string, never> = {}): Promise<void> {
  entry.cancel ??= binding.cancelAcceptedRun(entry.accepted, {});
  return entry.cancel;
}

/** Explicit Stop cancels the prepared message before acceptance and latches the result for the
 *  accepted run, so a Stop racing acceptance never leaves a run executing or launches it again. */
function requestDurableStop({ durable }: { durable: DurableTurn }, _optional: Record<string, never> = {}): void {
  if (durable.stopRequested) return;
  durable.stopRequested = true;
  if (durable.accepted) {
    void cancelAcceptedOnce({ entry: durable.accepted, binding: durable.binding }).catch(() => undefined);
    return;
  }
  const { messageId, conversationId } = durable.start.launch;
  if (messageId && conversationId) {
    durable.pendingCancel = durable.binding.cancelPendingRun({ messageId, conversationId }, {});
    void durable.pendingCancel.catch(() => undefined);
  }
}

/**
 * Hand an accepted segment to the canonical run. Acceptance precedes waiting: the binding is
 * persisted before start is reported, so a reload or Stop can always address the canonical run.
 * Saved projections replace replay: later segment frames are dropped and the follower renders the
 * one authoritative transcript, so neither view duplicates the other's deltas.
 */
function acceptDurableTurn(
  { turn, durable, event, runAgentInput }: { turn: AgUiRunTurn; durable: DurableTurn; event: RunStartedEvent; runAgentInput: RunAgentInput },
  _optional: Record<string, never> = {},
): AcceptedAgUiRun | undefined {
  const accepted = durable.binding.readAcceptedRun({ event, input: runAgentInput }, {});
  if (!accepted) return undefined;
  const entry: AcceptedEntry = { accepted, ...(durable.pendingCancel ? { cancel: durable.pendingCancel.catch(() => durable.binding.cancelAcceptedRun(accepted, {})) } : {}) };
  durable.accepted = entry;
  durable.acceptedRuns.set(accepted.runId, entry);
  durable.start.bindRun({ runId: accepted.runId, binding: { messageId: accepted.messageId, conversationId: accepted.conversationId } }, {});
  if (durable.stopRequested) void cancelAcceptedOnce({ entry, binding: durable.binding }).catch(() => undefined);
  durable.binding.followAcceptedRun({ ...accepted, handlers: { ...turn.handlers, onDone: (final) => {
    turn.handlers.onDone(final);
    durable.acceptedRuns.delete(accepted.runId);
    durable.cancelSignal?.removeEventListener("abort", durable.requestStop);
    turn.signal.removeEventListener("abort", turn.abort);
  } }, signal: turn.signal }, {});
  if (turn.signal.aborted) {
    durable.cancelSignal?.removeEventListener("abort", durable.requestStop);
    if (entry.cancel) void entry.cancel.finally(() => durable.acceptedRuns.delete(accepted.runId)).catch(() => undefined);
    else durable.acceptedRuns.delete(accepted.runId);
  }
  return accepted;
}

/** Durable mode settles start only on acceptance; returns the canonical ID once, else undefined. */
function durableStartEvent(
  { turn, event, runAgentInput, ports }: { turn: AgUiRunTurn; event: AgUiEvent; runAgentInput: RunAgentInput; ports: AgUiClientPorts },
  _optional: Record<string, never> = {},
): { accepted?: AcceptedAgUiRun; drop: boolean } {
  const durable = turn.durable;
  if (!durable) return { drop: false };
  if (durable.accepted) {
    ports.onLiveEvent?.({ event });
    if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) settleRunOnce({ turn });
    return { drop: true };
  }
  if (event.type !== EventType.RUN_STARTED) return { drop: false };
  const accepted = acceptDurableTurn({ turn, durable, event, runAgentInput });
  if (accepted) ports.onLiveEvent?.({ event });
  return accepted ? { accepted, drop: true } : { drop: false };
}

/**
 * Deliberately racing the Observable's first `next`/`error`/`complete` against this Promise rather than
 * awaiting it directly — `HttpAgent.run()` returns a cold Observable, never a Promise (module
 * doc). The subscription itself keeps running after this Promise settles, driving `handlers`
 * through to `settleRunOnce` in the background — matching `startByokRun`'s "resolves once STARTED, not
 * once finished" contract.
 */
function subscribeRun(
  { turn, runAgentInput, state, ports }: { turn: AgUiRunTurn; runAgentInput: RunAgentInput; state: AgUiToAgentTranslationState; ports: AgUiClientPorts },
  _optional: Record<string, never> = {},
): Promise<{ runId: string }> {
  return new Promise<{ runId: string }>((resolve, reject) => {
    let startSettled = false;
    const finish = (error?: Error) => {
      if (turn.settled) return;
      if (!startSettled) {
        turn.settled = true;
        forgetRun({ turn });
        reject(error ?? new DOMException("Run cancelled", "AbortError"));
        return;
      }
      settleRunOnce({ turn, ...(error ? { error } : {}) });
    };
    turn.agent.run(runAgentInput).subscribe({
      next: (event) => {
        if (turn.settled) return;
        const frame = event as AgUiEvent;
        const step = durableStartEvent({ turn, event: frame, runAgentInput, ports });
        if (step.accepted) {
          startSettled = true;
          resolve({ runId: step.accepted.runId });
        }
        if (step.drop) return;
        if (frame.type === EventType.RUN_ERROR && frame.code !== "abort") { finish(new Error(frame.message || "AG-UI run failed")); return; }
        if (!startSettled) {
          const launch = turn.durable?.start.launch;
          if (launch?.messageId && launch.conversationId && !(frame.type === EventType.RUN_STARTED && frame.runId === runAgentInput.runId)) return;
          startSettled = true;
          resolve({ runId: turn.runId });
        }
        handleAgUiEvent({ event: frame, onLiveEvent: ports.onLiveEvent, ctx: { collected: turn.collected, handlers: turn.handlers, state, finish } });
      },
      error: (error: unknown) => {
        // Aborting BEFORE headers arrive rejects the underlying fetch() itself, surfacing here
        // rather than through `handleAgUiEvent`'s `code: "abort"` check (module doc). After a
        // durable acceptance a lost segment is not a failed run: the follower owns the outcome.
        finish(turn.agent.abortController.signal.aborted || turn.durable?.accepted ? undefined : runStreamError({ error }));
      },
      complete: () => {
        // An empty stream has no first notification to settle the start promise.
        finish(turn.agent.abortController.signal.aborted || turn.durable?.accepted ? undefined : new Error("The assistant stopped before replying. Send your message again."));
      },
    });
  });
}

function runStreamError({ error }: { error: unknown }, _optional: Record<string, never> = {}): Error {
  const status = error instanceof Error && "status" in error && typeof error.status === "number" ? `HTTP ${error.status}, ` : "";
  return new Error(`The agent run stream stopped with an error (${status}${describeErrorForLog({ err: error })}); send the message again.`, { cause: error });
}

/**
 * The AG-UI canary run path (ADR-059) — drives a real `@ag-ui/client` `HttpAgent` against
 * `assistant-ag-ui.ts`'s route, same one-turn-per-call shape as `startByokRun`. `credentials:
 * "same-origin"` is explicit even though modern `fetch()` already defaults to it for same-origin
 * requests, matching this transport's other paths' explicitness about the session cookie.
 */
async function startRun(
  { ports, agents, input, handlers, resume, durable: start, acceptedRuns }: { ports: AgUiClientPorts; agents: Map<string, AgUiClient>; input: StartRunInput; handlers: RunHandlers; resume?: { threadId: string; parentRunId: string; resume: NonNullable<RunAgentInput["resume"]> }; durable?: AgUiDurableStart | undefined; acceptedRuns: Map<string, AcceptedEntry> },
  _optional: Record<string, never> = {},
): Promise<{ runId: string }> {
  const runId = `${ports.runIdPrefix}${ports.mintId({}, {})}`;
  // The conversation-level id, stable across turns — a genuine AG-UI `threadId`, distinct from the
  // per-turn `runId` minted fresh above. Falls back to minting one only for a conversation that has
  // none yet (e.g. the very first turn).
  const threadId = resume?.threadId ?? input.conversationId ?? ports.mintId({}, {});

  const agent = ports.createAgent({ url: ports.endpoint, threadId }, {});
  if (input.signal.aborted) throw new DOMException("Run cancelled", "AbortError");
  agents.set(runId, agent);
  const durable = ports.durableLocalCli && start ? durableTurn({ binding: ports.durableLocalCli, start, acceptedRuns, input }) : undefined;
  const abort = () => {
    agent.abortRun();
    if (!durable?.accepted) return;
    const entry = durable.accepted;
    durable.cancelSignal?.removeEventListener("abort", durable.requestStop);
    if (entry.cancel) void entry.cancel.finally(() => acceptedRuns.delete(entry.accepted.runId)).catch(() => undefined);
    else acceptedRuns.delete(entry.accepted.runId);
  };
  input.signal.addEventListener("abort", abort, { once: true });
  const turn: AgUiRunTurn = { runId, agent, signal: input.signal, abort, handlers, collected: [], agents, settled: false, ...(durable ? { durable } : {}) };
  const state = createAgUiToAgentTranslationState({ customEventNames: ports.customEventNames }, {});
  return subscribeRun({ turn, runAgentInput: requestBody({ input, runId, threadId, resume, durable }), state, ports });
}

/** The wire request: the delivery segment's own body, projected by the durable binding when present. */
function requestBody(
  { input, runId, threadId, resume, durable }: { input: StartRunInput; runId: string; threadId: string; resume: { parentRunId: string; resume: NonNullable<RunAgentInput["resume"]> } | undefined; durable: DurableTurn | undefined },
  _optional: Record<string, never> = {},
): RunAgentInput {
  const wire: RunAgentInput = { ...toRunAgentInput({ input, runId, threadId }), ...(resume ? { parentRunId: resume.parentRunId, resume: resume.resume } : {}) };
  return durable ? durable.binding.prepareRunInput({ input, wire, launch: durable.start.launch }, {}) : wire;
}

/** Durable state for one start. Only the explicit cancel signal is Stop; the detach signal (`signal`)
 *  aborts the delivery segment, because aborting a delivery segment on unload is not Stop. */
function durableTurn(
  { binding, start, acceptedRuns, input }: { binding: AgUiDurableLocalCliBinding; start: AgUiDurableStart; acceptedRuns: Map<string, AcceptedEntry>; input: StartRunInput },
  _optional: Record<string, never> = {},
): DurableTurn {
  const durable: DurableTurn = { binding, start, acceptedRuns, input, cancelSignal: input.cancelSignal, stopRequested: false, requestStop: () => requestDurableStop({ durable }) };
  if (input.cancelSignal?.aborted) durable.requestStop();
  else input.cancelSignal?.addEventListener("abort", durable.requestStop, { once: true });
  return durable;
}

/** No server-side run record exists on this path (module doc) — a reload has already discarded the
 *  original `fetch()`'s response body, so there is nothing to resume. Same honest "already over"
 *  answer `assistant-transport.ts`'s BYOK branch gives for the identical situation. */
async function reattachAgUiRun({ handlers }: { handlers: RunHandlers }, _optional: Record<string, never> = {}): Promise<void> {
  handlers.onDone([]);
}

/** Same reasoning as {@link reattachAgUiRun} — no server-side run record to fetch status for. */
async function fetchAgUiRunStatus(_required: Record<string, never>, _optional: Record<string, never> = {}): Promise<null> {
  return null;
}

/** Bind the official client without adding its dependency to every chat consumer. */
export function createAgUiRunClient({ ports }: { ports: AgUiClientPorts }, _options: Record<string, never> = {}): AgUiRunClient {
  /** In-flight AG-UI turns' driving `HttpAgent`, keyed by the client-minted runId — the ONLY way
   *  `stopAgUiRun` can cancel a turn: like BYOK, there is no server-side run record on THIS
   *  path to `POST .../cancel` against. Storing the agent (not a bare `AbortController`) lets
   *  `stopAgUiRun` call its own `abortRun()`, which both aborts the fetch AND (per the package's own
   *  convention) surfaces a clean `RUN_ERROR{code:"abort"}` through the normal event path rather than
   *  a raw network error. */
  const agents = new Map<string, AgUiClient>();
  /** Canonical runs accepted through the durable binding, keyed by the canonical ID ChatTransport holds. */
  const acceptedRuns = new Map<string, AcceptedEntry>();
  const binding = ports.durableLocalCli;
  return {
    ...(binding ? { durableLocalCli: true } : {}),
    isAcceptedAgUiRun: ({ runId }: { runId: string }, _optional: Record<string, never> = {}) => acceptedRuns.has(runId),
    isAgUiRunId: ({ runId }: { runId: string }, _optional: Record<string, never> = {}) => runId.startsWith(ports.runIdPrefix),
    handleAgUiEvent: ({ event, ctx }, _optional: Record<string, never> = {}) => handleAgUiEvent({ event, ctx, onLiveEvent: ports.onLiveEvent }),
    startAgUiRun: ({ input, handlers, durable }: { input: StartRunInput; handlers: RunHandlers; durable?: AgUiDurableStart }, _optional: Record<string, never> = {}) => startRun({ ports, agents, input, handlers, durable, acceptedRuns }),
    resumeAgUiRun: ({ input, handlers, threadId, parentRunId, resume }, _optional: Record<string, never> = {}) => startRun({ ports, agents, input, handlers, resume: { threadId, parentRunId, resume }, acceptedRuns }),
    reattachAgUiRun,
    fetchAgUiRunStatus,
    /** An AG-UI run's only cancellation handle is the `HttpAgent` {@link startRun} registered for
     *  this exact id — same shape as BYOK's `stopRun` branch. */
    stopAgUiRun: async ({ runId }: { runId: string }, _optional: Record<string, never> = {}) => {
      // An accepted canonical run is stopped by cancelling it, not by dropping its delivery segment.
      const entry = acceptedRuns.get(runId);
      if (entry && binding) return cancelAcceptedOnce({ entry, binding });
      agents.get(runId)?.abortRun();
      return undefined;
    },
  };
}
