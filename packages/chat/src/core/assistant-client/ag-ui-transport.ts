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
import type { Message, RunAgentInput } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import { createAgUiToAgentTranslationState, translateAgUiEventToAgentEvent } from "../ag-ui/event-reduction.js";
import type { AgUiToAgentTranslationState } from "../ag-ui/event-reduction.js";
import type { AgUiEvent, CustomEventNames } from "../ag-ui/event-projection.js";
import type { ChatMessage } from "../messages.js";
import type { RunHandlers, StartRunInput } from "../transport.js";
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
}
export interface AgUiEventContext {
  collected: AgentEvent[]; handlers: RunHandlers; state: AgUiToAgentTranslationState; finish: () => void;
}
export interface AgUiRunClient {
  isAgUiRunId(required: { runId: string }, optional?: Record<string, never>): boolean;
  handleAgUiEvent(required: { event: AgUiEvent; ctx: AgUiEventContext }, optional?: Record<string, never>): void;
  startAgUiRun(required: { input: StartRunInput; handlers: RunHandlers }, optional?: Record<string, never>): Promise<{ runId: string }>;
  resumeAgUiRun(required: { input: StartRunInput; handlers: RunHandlers; threadId: string; parentRunId: string; resume: NonNullable<RunAgentInput["resume"]> }, optional?: Record<string, never>): Promise<{ runId: string }>;
  reattachAgUiRun(required: { handlers: RunHandlers }, optional?: Record<string, never>): Promise<void>;
  fetchAgUiRunStatus(required: Record<string, never>, optional?: Record<string, never>): Promise<null>;
  stopAgUiRun(required: { runId: string }, optional?: Record<string, never>): Promise<void>;
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

/** Drops the turn's two handles: its registry entry (so `stopAgUiRun` cannot reach a dead agent) and
 *  its listener on the host signal. Safe to repeat. */
function forgetRun({ turn }: { turn: AgUiRunTurn }, _optional: Record<string, never> = {}): void {
  turn.agents.delete(turn.runId);
  turn.signal.removeEventListener("abort", turn.abort);
}

/** The one place a turn is finished: `onDone` receives the collected events exactly once, however
 *  many of RUN_FINISHED, an abort, a stream error and `complete` arrive. */
function settleRunOnce({ turn }: { turn: AgUiRunTurn }, _optional: Record<string, never> = {}): void {
  if (turn.settled) return;
  turn.settled = true;
  forgetRun({ turn });
  turn.handlers.onDone(turn.collected);
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
  const finish = () => settleRunOnce({ turn });
  return new Promise<{ runId: string }>((resolve, reject) => {
    let startSettled = false;
    turn.agent.run(runAgentInput).subscribe({
      next: (event) => {
        if (!startSettled) {
          startSettled = true;
          resolve({ runId: turn.runId });
        }
        handleAgUiEvent({ event: event as AgUiEvent, onLiveEvent: ports.onLiveEvent, ctx: { collected: turn.collected, handlers: turn.handlers, state, finish } });
      },
      error: (error: unknown) => {
        forgetRun({ turn });
        const err = runStreamError({ error });
        if (!startSettled) {
          startSettled = true;
          reject(err);
          return;
        }
        // Aborting BEFORE headers arrive rejects the underlying fetch() itself, surfacing here
        // rather than through `handleAgUiEvent`'s `code: "abort"` check (module doc).
        if (turn.agent.abortController.signal.aborted) {
          finish();
          return;
        }
        // Error THEN finish: an errored Observable never calls `complete`, so without this the turn
        // is never settled and the events collected before the failure never reach `onDone`. Same
        // order as `subscribeToRun`'s `end` listener, so the run is still recorded as failed.
        turn.handlers.onError(err);
        finish();
      },
      complete: () => {
        // An empty stream has no first notification to settle the start promise.
        if (!startSettled) {
          startSettled = true;
          resolve({ runId: turn.runId });
        }
        finish();
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
  { ports, agents, input, handlers, resume }: { ports: AgUiClientPorts; agents: Map<string, AgUiClient>; input: StartRunInput; handlers: RunHandlers; resume?: { threadId: string; parentRunId: string; resume: NonNullable<RunAgentInput["resume"]> } },
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
  const abort = () => agent.abortRun();
  input.signal.addEventListener("abort", abort, { once: true });

  const turn: AgUiRunTurn = { runId, agent, signal: input.signal, abort, handlers, collected: [], agents, settled: false };
  const state = createAgUiToAgentTranslationState({ customEventNames: ports.customEventNames }, {});
  return subscribeRun({ turn, runAgentInput: { ...toRunAgentInput({ input, runId, threadId }),
    ...(resume ? { parentRunId: resume.parentRunId, resume: resume.resume } : {}) }, state, ports });
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
  return {
    isAgUiRunId: ({ runId }: { runId: string }, _optional: Record<string, never> = {}) => runId.startsWith(ports.runIdPrefix),
    handleAgUiEvent: ({ event, ctx }, _optional: Record<string, never> = {}) => handleAgUiEvent({ event, ctx, onLiveEvent: ports.onLiveEvent }),
    startAgUiRun: ({ input, handlers }: { input: StartRunInput; handlers: RunHandlers }, _optional: Record<string, never> = {}) => startRun({ ports, agents, input, handlers }),
    resumeAgUiRun: ({ input, handlers, threadId, parentRunId, resume }, _optional: Record<string, never> = {}) => startRun({ ports, agents, input, handlers, resume: { threadId, parentRunId, resume } }),
    reattachAgUiRun,
    fetchAgUiRunStatus,
    /** An AG-UI run's only cancellation handle is the `HttpAgent` {@link startRun} registered for
     *  this exact id — same shape as BYOK's `stopRun` branch. */
    stopAgUiRun: async ({ runId }: { runId: string }, _optional: Record<string, never> = {}) => { agents.get(runId)?.abortRun(); },
  };
}
