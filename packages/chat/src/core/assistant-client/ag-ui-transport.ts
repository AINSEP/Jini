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
import { createAgUiToAgentTranslationState, translateAgUiEventToAgentEvent } from "../ag-ui/entry.js";
import type { AgUiEvent, AgUiToAgentTranslationState, CustomEventNames } from "../ag-ui/entry.js";
import type { AgentEvent } from "../events.js";
import type { ChatMessage } from "../messages.js";
import type { RunHandlers, StartRunInput } from "../transport.js";

export interface AgUiClient {
 readonly abortController: AbortController;
 abortRun(): void;
 run(input: RunAgentInput): { subscribe(observer: { next: (event: unknown) => void; error: (error: unknown) => void; complete: () => void }): unknown };
}
export interface AgUiClientPorts {
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
  reattachAgUiRun(required: { handlers: RunHandlers }, optional?: Record<string, never>): Promise<void>;
  fetchAgUiRunStatus(required: Record<string, never>, optional?: Record<string, never>): Promise<null>;
  stopAgUiRun(required: { runId: string }, optional?: Record<string, never>): Promise<void>;
}
/** Bind the official client without adding its dependency to every chat consumer. */
export function createAgUiRunClient({ ports }: { ports: AgUiClientPorts }, _options: Record<string, never> = {}): AgUiRunClient {
  /** In-flight AG-UI turns' driving `HttpAgent`, keyed by the client-minted runId — the ONLY way
   *  {@link stopAgUiRun} can cancel a turn: like BYOK, there is no server-side run record on THIS
   *  path to `POST .../cancel` against. Storing the agent (not a bare `AbortController`) lets
   *  `stopAgUiRun` call its own `abortRun()`, which both aborts the fetch AND (per the package's own
   *  convention) surfaces a clean `RUN_ERROR{code:"abort"}` through the normal event path rather than
   *  a raw network error. */
   const agUiAgents = new Map<string, AgUiClient>();
  /**
   * Dispatches one already-parsed AG-UI event. `HttpAgent` owns SSE framing and per-event zod
   * validation entirely, and hands us finished event objects. `RUN_ERROR` with `code: "abort"` is the
   * real package's own convention for a mid-stream abort (see module doc) — routed to `finish()`, not
   * `onError`. Every other event is reduced through {@link translateAgUiEventToAgentEvent} and
   * forwarded to both `collected` (the final transcript `onDone` receives) and `handlers.onEvent`
   * (live rendering).
   */
  function handleAgUiEvent(
    event: AgUiEvent,
    ctx: { collected: AgentEvent[]; handlers: RunHandlers; state: AgUiToAgentTranslationState; finish: () => void },
  ): void {
    if (event.type === EventType.RUN_ERROR) {
      if (event.code === "abort") {
        ctx.finish();
        return;
      }
      ctx.handlers.onError(new Error(event.message || "AG-UI run failed"));
      return;
    }
    if (event.type === EventType.RUN_FINISHED) {
      ctx.finish();
      return;
    }
    for (const translated of translateAgUiEventToAgentEvent({ event, state: ctx.state }, {})) {
      ctx.collected.push(translated);
      ctx.handlers.onEvent(translated);
    }
  }

  /** Every AG-UI message role requires an id; preserve ChatMessage.id across translation. */
  function toAgUiMessage(message: ChatMessage): Message {
    if (message.role === "user") return { id: message.id, role: "user", content: message.content };
    return { id: message.id, role: "assistant", content: message.content };
  }

  /**
   * The AG-UI canary run path (ADR-059) — drives a real `@ag-ui/client` `HttpAgent` against
   * `assistant-ag-ui.ts`'s route, same one-turn-per-call shape as `startByokRun`. `credentials:
   * "same-origin"` is explicit even though modern `fetch()` already defaults to it for same-origin
   * requests, matching this transport's other paths' explicitness about the session cookie.
   */
  async function startAgUiRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }> {
    const runId = `${ports.runIdPrefix}${ports.mintId({}, {})}`;
    // The conversation-level id, stable across turns — a genuine AG-UI `threadId`, distinct from the
    // per-turn `runId` minted fresh above. Falls back to minting one only for a conversation that has
    // none yet (e.g. the very first turn).
    const threadId = input.conversationId ?? ports.mintId({}, {});

    const agent = ports.createAgent({ url: ports.endpoint, threadId }, {});
    agUiAgents.set(runId, agent);
    input.signal?.addEventListener("abort", () => agent.abortRun());

    const messages: Message[] = input.history.filter((message) => message.content.trim().length > 0).map(toAgUiMessage);

    const runAgentInput: RunAgentInput = {
      threadId,
      runId,
      state: null,
      messages,
      tools: [],
      context: [],
      forwardedProps: {
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.history.some(message => message.role === "user" && message.secretRedaction?.secretRedacted) ? { secretRedacted: true } : {}),
      },
    };

    const collected: AgentEvent[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      agUiAgents.delete(runId);
      handlers.onDone(collected);
    };
    const state = createAgUiToAgentTranslationState({ customEventNames: ports.customEventNames }, {});

    // Deliberately racing the Observable's first `next`/`error` against this Promise rather than
    // awaiting it directly — `HttpAgent.run()` returns a cold Observable, never a Promise (module
    // doc). The subscription itself keeps running after this Promise settles, driving `handlers`
    // through to `finish()` in the background — matching `startByokRun`'s "resolves once STARTED, not
    // once finished" contract.
    return new Promise<{ runId: string }>((resolve, reject) => {
      let startSettled = false;
      agent.run(runAgentInput).subscribe({
        next: (event) => {
          if (!startSettled) {
            startSettled = true;
            resolve({ runId });
          }
          handleAgUiEvent(event as AgUiEvent, { collected, handlers, state, finish });
        },
        error: (error: unknown) => {
          agUiAgents.delete(runId);
          const err = error instanceof Error ? error : new Error(String(error));
          if (!startSettled) {
            startSettled = true;
            reject(err);
            return;
          }
          // Aborting BEFORE headers arrive rejects the underlying fetch() itself, surfacing here
          // rather than through `handleAgUiEvent`'s `code: "abort"` check (module doc).
          if (agent.abortController.signal.aborted) {
            finish();
            return;
          }
          // Error THEN finish: an errored Observable never calls `complete`, so without this the turn
          // is never settled and the events collected before the failure never reach `onDone`. Same
          // order as `subscribeToRun`'s `end` listener, so the run is still recorded as failed.
          handlers.onError(err);
          finish();
        },
        complete: () => {
          finish();
        },
      });
    });
  }

  /** No server-side run record exists on this path (module doc) — a reload has already discarded the
   *  original `fetch()`'s response body, so there is nothing to resume. Same honest "already over"
   *  answer `assistant-transport.ts`'s BYOK branch gives for the identical situation. */
  async function reattachAgUiRun(handlers: RunHandlers): Promise<void> {
    handlers.onDone([]);
  }

  /** Same reasoning as {@link reattachAgUiRun} — no server-side run record to fetch status for. */
  async function fetchAgUiRunStatus(): Promise<null> {
    return null;
  }

  /** An AG-UI run's only cancellation handle is the `HttpAgent` {@link startAgUiRun} registered for
   *  this exact id — same shape as BYOK's `stopRun` branch. */
  async function stopAgUiRun(runId: string): Promise<void> {
    agUiAgents.get(runId)?.abortRun();
  }

  return {
   isAgUiRunId: ({ runId }: { runId: string }, _options: Record<string, never> = {}) => runId.startsWith(ports.runIdPrefix),
   handleAgUiEvent: ({ event, ctx }: { event: AgUiEvent; ctx: Parameters<typeof handleAgUiEvent>[1] }, _options: Record<string, never> = {}) => handleAgUiEvent(event, ctx),
   startAgUiRun: ({ input, handlers }: { input: StartRunInput; handlers: RunHandlers }, _options: Record<string, never> = {}) => startAgUiRun(input, handlers),
   reattachAgUiRun: ({ handlers }: { handlers: RunHandlers }, _options: Record<string, never> = {}) => reattachAgUiRun(handlers),
   fetchAgUiRunStatus: (_required: Record<string, never>, _options: Record<string, never> = {}) => fetchAgUiRunStatus(),
   stopAgUiRun: ({ runId }: { runId: string }, _options: Record<string, never> = {}) => stopAgUiRun(runId),
  };
}
