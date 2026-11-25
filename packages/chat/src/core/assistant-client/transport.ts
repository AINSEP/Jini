import type { ChatMessage } from "../messages.js";
import type { ChatTransport, ReattachRunOptions, RunHandlers, StartRunInput } from "../transport.js";
import type { RunNotices } from "../run-events/entry.js";
import type { AgUiRunClient } from "./ag-ui-transport.js";
import type { DurableRunBinding } from "./durable-run-subscription.js";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";
import { historyForTranscript, undeliveredUserPrompt } from "./transport-prompt.js";
import { buildLocalCliContextRef, refusalError, startTransportRun } from "./transport-run.js";
import { consumeByokStream, handleByokFrame, subscribeToRun, type TransportCtx } from "./transport-stream.js";

/** Per-turn dispatch input; hosts may return their fuller saved settings without UI dependencies. */
export interface AssistantExecutionConfig {
  mode: 'local-cli' | 'byok';
  byok: {
    protocol: 'anthropic' | 'openai' | 'azure' | 'google';
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens?: number | undefined;
  };
}

export interface AssistantTransportOptions {
  /**
   * Read fresh on every `startRun` call, never captured once — matching `AssistantDock.tsx`'s own
   * `runContext` convention (see that file's doc on why `frontendBindToken` is read the same way):
   * the operator can flip the runtime picker's mode mid-session, and a captured value would keep
   * routing every later turn through whichever mode was selected when the transport was first
   * built (`AssistantDock.tsx` memoizes the transport once, for the reason its own comment gives —
   * rebuilding it would drop in-flight runs).
   */
  getExecutionConfig?: (required: Record<string, never>, optional: Record<string, never>) => AssistantExecutionConfig;
  /**
   * ADR-059's AG-UI canary toggle — deliberately separate from {@link AssistantExecutionConfig}'s
   * closed `'local-cli' | 'byok'` union so enabling the canary does not extend the host's saved
   * execution modes. Read fresh on every `startRun` call, same "never captured" convention
   * {@link getExecutionConfig} already establishes, for the same reason: an operator can flip this
   * mid-session without rebuilding the memoized transport.
   */
  getAgUiEnabled?: (required: Record<string, never>, optional: Record<string, never>) => boolean;
  /**
   * Agent ids whose own CLI/ACP session already carries multi-turn conversation memory across
   * spawns — `@jini-ai/agent-runtime`'s `resumesSessionViaCli`/`resumesSessionViaAcpLoad`, projected
   * client-safe as `AssistantAgentSummary.carriesOwnMemory` (`assistant/agents.ts` in the host server).
   * {@link runPrompt}'s own doc has the full "used to send only the newest message" background; this
   * option is the inverse regression it introduced for exactly these agents — see `startRun`'s Local
   * CLI branch below, which resends the doc's own contract instead of the full transcript ONLY for an
   * agentId this set contains: "the caller trusts this adapter's CLI to carry its own multi-turn
   * conversation memory... and should skip resending the rendered transcript on follow-up turns"
   * (`types.ts`). Resending it anyway would duplicate everything the daemon's own `--resume`/
   * `session/load` already restores (`packages/daemon/src/session-coordination.ts`).
   *
   * Read fresh on every `startRun` call, same "never captured" convention {@link getExecutionConfig}/
   * {@link getAgUiEnabled} already establish: the admin's own `/api/agents` probe resolves
   * asynchronously and can still be in flight when this transport is first built, and an operator can
   * switch the Local CLI agent pick mid-session.
   *
   * Omitted, or an agentId absent from the returned set, keeps today's behavior — the full transcript
   * is sent. That is the SAFE default for a def this option's source has not resolved as resume-capable
   * yet: sending redundant history to a resume-capable def costs extra tokens, but withholding history
   * from a stateless def would silently erase its memory — the two failure directions are not
   * symmetric, so "unknown" must resolve to "send everything," not to "send only the latest message."
   */
  getResumeCapableAgentIds?: (required: Record<string, never>, optional: Record<string, never>) => ReadonlySet<string>;
  /**
   * This pane's conversation id, adopting one if none is active yet —
   * `useAssistantChats.ensureConversationId` (`hooks/use-assistant-chats.hooks.ts`), wired through
   * `AssistantDock`'s `useAssistantTransport`. Awaited by `startRun` ONLY when `input.context` names
   * no conversation, which in practice means the first turn of a chat.
   *
   * Why the transport has to be the one to ask: the admin adopts a conversation lazily, from the
   * first message delta — and `@jini-ai/chat`'s `useChatPane.sendPrompt` freezes `runContext(...)`
   * into `input.context` BEFORE calling `conversation.sendMessage(...)`, the very call that produces
   * that delta. So on turn 1 there is no id to capture yet, and `runContext` (synchronous by
   * contract) has no way to wait for one. `startRun` is the last point in the chain that can still
   * `await`, which makes it the only place the run can acquire the identity its agent-CLI session id
   * gets filed under. Without it, `agent-daemon-server.ts`'s `onStarted` skipped its entire
   * session-capture subscription for turn 1, and turn 2 — sent only the bare latest user message,
   * trusting a resume that had nothing stored — answered with none of the conversation.
   *
   * Contract: resolves `null` rather than rejecting when creation fails. `startRun` treats that as
   * "send the turn anyway, with no conversationId" — one run with no resumable session is a far
   * smaller loss than a run that never happens.
   */
  ensureConversationId?: (required: Record<string, never>, optional: Record<string, never>) => Promise<string | null>;
  /**
   * Writes one user message to durable storage — `useAssistantChats.persistUserTurn`
   * (`hooks/use-assistant-chats.hooks.ts`), wired through `AssistantDock`'s `useAssistantTransport`.
   * Awaited by `startRun` on the Local CLI path before `POST /api/runs`, including a delta's pending
   * PUT. Acceptance persists the same message with its stub if the browser write fails. See
   * {@link persistUserTurnBeforeDispatch} for the defect and the idempotency contract.
   *
   * Optional for transports without the dock's persistence hook; acceptance still receives the
   * exact user message, and the delta-driven `flush` can write the same ID afterward.
   * Its rejection is swallowed at the call site rather than failing the turn.
   */
  persistUserTurn?: (required: { conversationId: string; message: ChatMessage }, optional: Record<string, never>) => Promise<void>;
}

export interface AssistantTransportPorts {
 readonly runsUrl: string; readonly byokTurnUrl: string; readonly byokRunIdPrefix: string; readonly notices: RunNotices;
 readonly fetch: typeof fetch;
 readonly mintId: (required: Record<string, never>, optional: Record<string, never>) => string;
 readonly projectPrompt: (required: { prompt: string; context: StartRunInput["context"] }, optional: Record<string, never>) => string;
 readonly projectInput: (required: { input: StartRunInput }, optional: Record<string, never>) => StartRunInput;
 readonly bindRun: (required: { runId: string; binding: DurableRunBinding }, optional: Record<string, never>) => void;
 readonly runBinding: (required: { runId: string }, optional: Record<string, never>) => DurableRunBinding | undefined;
 readonly followRun: (required: { runId: string; handlers: RunHandlers; signal?: AbortSignal }, optional: Record<string, never>) => void;
 readonly acceptRun: (required: { body: unknown; signal?: AbortSignal; requestSignal?: AbortSignal; messageId: unknown; conversationId?: string }, optional: Record<string, never>) => Promise<Response>;
 readonly agUi: AgUiRunClient;
}

export interface ByokFrameContext { collected: AgentEvent[]; handlers: RunHandlers; finish: () => void }
export interface ByokStreamContext extends ByokFrameContext { runId: string; controller: AbortController }
export interface AssistantTransportClient {
  createAssistantTransport(required: { options?: AssistantTransportOptions }, optional?: Record<string, never>): ChatTransport;
  historyForTranscript(required: { history: readonly ChatMessage[] }, optional?: Record<string, never>): ChatMessage[];
  undeliveredUserPrompt(required: { history: readonly ChatMessage[] }, optional?: Record<string, never>): string;
  buildLocalCliContextRef(required: { input: StartRunInput; prompt: string; resolvedConversationId?: string }, optional?: Record<string, never>): Record<string, unknown>;
  handleByokFrame(required: { frame: { event: string; data: string }; ctx: ByokFrameContext }, optional?: Record<string, never>): void;
  consumeByokStream(required: { body: ReadableStream<Uint8Array>; ctx: ByokStreamContext }, optional?: Record<string, never>): Promise<void>;

}

/**
 * Shared HTTP implementation of `@jini-ai/chat/react`'s `ChatTransport` port.
 *
 * TWO run paths live here, selected per-turn by `getExecutionConfig()` (see
 * `createAssistantTransport`'s own doc):
 *
 * 1. **Local CLI** (the original, unchanged path): binds to the real `@jini-ai/http` run surface
 *    the host app's `src/server/runtime/composition/modules/assistant.ts` mounts — `POST /api/runs` to start, `GET
 *    /api/runs/:runId/events` (native `EventSource`) to stream, `GET /api/runs/:runId` for status,
 *    `POST /api/runs/:runId/cancel` to stop. Every SSE frame's `data` is a full `@jini-ai/protocol`
 *    `RunProtocolEvent` (`{kind, payload, ...}`), not chat-core's own `AgentEvent` — chat-core's own
 *    module doc is explicit that this reduction is a transport concern ("a host's transport adapter
 *    is responsible for reducing wire deltas... into the persisted/renderable AgentEvent items"), so
 *    `translateRunAgentPayload` below does that translation.
 * 2. **API · BYOK** (2026-08-04, the execution picker): binds to the host app's `src/server/runtime/composition/modules/assistant-byok.ts`'s
 *    `POST /api/admin/v1/assistant/byok-turn` — one request/response holding the WHOLE turn open,
 *    no separate `EventSource`/reattach/cancel-by-runId (see that route's own header for why, and
 *    what it costs). Its SSE frames carry the SAME `payload.type` vocabulary
 *    (`status`/`text_delta`/`tool_use`/`tool_result`/`usage`/`error`) `translateRunAgentPayload`
 *    already parses for path 1 — deliberately, so this path reuses that exact function rather than
 *    duplicating the translation switch.
 *
 * `text_delta`/`thinking_delta` are forwarded as their own small `AgentEvent` per delta (not
 * accumulated here) — chat-core's own `ChatMessage.events` array is what concatenates them into one
 * growing message, so accumulating twice would double the text.
 */
/** Distinguishes a BYOK-run id (client-minted, no server-side run record) from a daemon-run id
 *  (server-minted, reattachable) wherever a bare `runId` string is all a `ChatTransport` method
 *  receives — see `stopRun`/`fetchRunStatus`/`reattachRun` below for why the distinction matters. */
function isByokRunId({ transport, runId }: { transport: TransportCtx; runId: string }): boolean {
  return runId.startsWith(transport.ports.byokRunIdPrefix);
}

/** `@jini-ai/protocol`'s `RunState` -> chat-core's flat `RunStatus` union (different spelling: `cancelled` vs `canceled`, `pending` vs `queued`). */
function toChatCoreRunStatus(state: string): "queued" | "running" | "succeeded" | "failed" | "canceled" | undefined {
  switch (state) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "canceled";
    default:
      return undefined;
  }
}

/** Reattach by run id; see each branch for why a BYOK or AG-UI run cannot resume. */
async function reattachTransportRun(
  { transport, runId, handlers, options }: { transport: TransportCtx; runId: string; handlers: RunHandlers; options?: ReattachRunOptions | undefined },
  _optional: Record<string, never> = {},
): Promise<void> {
    // A BYOK run has no server-side record to reattach to (module doc's path-2 section) — the
    // stream lived entirely on the original `fetch()`'s response body, which a reload has already
    // discarded. Reporting the run as simply over (an empty `onDone`) is the honest answer: there
    // is no way to resume it, and pretending otherwise would hang the pane waiting for events that
    // can never arrive.
    if (isByokRunId({ transport, runId })) {
      handlers.onDone([]);
      return undefined;
    }
    // Same "no server-side record to resume" reasoning as the BYOK branch above — see
    // `assistant-transport-ag-ui.ts`'s own doc for why this path has no reattach story yet.
    if (transport.ports.agUi.isAgUiRunId({ runId }, {})) {
      return transport.ports.agUi.reattachAgUiRun({ handlers }, {});
    }
    subscribeToRun({ transport, runId, handlers, signal: options?.signal });
    return undefined;
}

/** The run's status by id; `null` is this port's "unknown/not trackable" value. */
async function fetchTransportRunStatus(
  { transport, runId }: { transport: TransportCtx; runId: string },
  _optional: Record<string, never> = {},
) {
    // Same reasoning as `reattachRun` above — no server-side run record exists for a BYOK run id,
    // so there is no status to fetch. `null` is this port's existing "unknown/not trackable"
    // value (see the daemon branch below's own `!response.ok` case), not a new state.
    if (isByokRunId({ transport, runId })) return null;
    if (transport.ports.agUi.isAgUiRunId({ runId }, {})) return transport.ports.agUi.fetchAgUiRunStatus({}, {});
    const response = await transport.ports.fetch(`${transport.ports.runsUrl}/${encodeURIComponent(runId)}`, { credentials: "same-origin" });
    if (!response.ok) return null;
    const { run } = (await response.json()) as { run: { state: string } };
    return toChatCoreRunStatus(run.state) ?? null;
}

/** Cancel by run id: a BYOK turn aborts its own in-flight fetch, a daemon run is cancelled server-side. */
async function stopTransportRun(
  { transport, runId }: { transport: TransportCtx; runId: string },
  _optional: Record<string, never> = {},
): Promise<void> {
    // A BYOK run's only cancellation handle is the abort controller `startByokRun` registered for
    // this exact id — there is no server-side run to `POST .../cancel` against.
    if (isByokRunId({ transport, runId })) {
      transport.byokAbortControllers.get(runId)?.abort();
      return undefined;
    }
    if (transport.ports.agUi.isAgUiRunId({ runId }, {})) {
      return transport.ports.agUi.stopAgUiRun({ runId }, {});
    }
    const response = await transport.ports.fetch(`${transport.ports.runsUrl}/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ runId, messageId: transport.ports.runBinding({ runId }, {})?.messageId }),
    });
    // 404: the daemon no longer knows this run (it restarted), so nothing is left running to stop.
    if (response.status === 404) return undefined;
    // `fetch` resolves on any status: without this a refused cancel (401/403/500) resolved exactly
    // like a successful one while the run kept executing. `useRunStream` logs a rejection here.
    if (!response.ok) throw await refusalError({ action: "cancelling agent run failed", response }, {});
    return undefined;
}

/** The `ChatTransport` for one execution-config source; every method is a thin dispatch to a helper above or in `transport-run.ts`. */
function buildChatTransport({ transport, options }: { transport: TransportCtx; options: AssistantTransportOptions }): ChatTransport {
  return {
    startRun: (input: StartRunInput, handlers: RunHandlers) => startTransportRun({ transport, input, handlers }, { options }),
    reattachRun: (runId: string, handlers: RunHandlers, reattachOptions?: ReattachRunOptions) => reattachTransportRun({ transport, runId, handlers, options: reattachOptions }),
    fetchRunStatus: (runId: string) => fetchTransportRunStatus({ transport, runId }),
    stopRun: (runId: string) => stopTransportRun({ transport, runId }),
  };
}

/** Bind transport effects once; in-flight controllers belong to this client, never the package.
 * Positional run methods implement the existing ChatTransport contract. */
export function createAssistantTransportClient({ ports }: { ports: AssistantTransportPorts }, _options: Record<string, never> = {}): AssistantTransportClient {
  const transport: TransportCtx = { ports, byokAbortControllers: new Map<string, AbortController>() };
  return {
    createAssistantTransport: ({ options = {} }: { options?: AssistantTransportOptions }, _optional: Record<string, never> = {}) => buildChatTransport({ transport, options }),
    historyForTranscript: ({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never> = {}) => historyForTranscript({ history }),
    undeliveredUserPrompt: ({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never> = {}) => undeliveredUserPrompt({ history }),
    buildLocalCliContextRef: ({ input, prompt, resolvedConversationId }: { input: StartRunInput; prompt: string; resolvedConversationId?: string }, _optional: Record<string, never> = {}) => buildLocalCliContextRef({ transport, input, prompt, resolvedConversationId }),
    handleByokFrame: ({ frame, ctx }: { frame: { event: string; data: string }; ctx: ByokFrameContext }, _optional: Record<string, never> = {}) => handleByokFrame({ transport, frame, ctx }),
    consumeByokStream: ({ body, ctx }: { body: ReadableStream<Uint8Array>; ctx: ByokStreamContext }, _optional: Record<string, never> = {}) => consumeByokStream({ transport, body, ctx }),
  };
}
