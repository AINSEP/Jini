import { buildTranscript, latestUserPromptFromHistory } from "../transcript.js";
import type { AgentEvent } from "../events.js";
import type { ChatMessage } from "../messages.js";
import type { ChatTransport, ReattachRunOptions, RunHandlers, StartRunInput } from "../transport.js";
import type { ExecutionConfig } from "@jini-ai/ui";
import * as runEvents from "../run-events/entry.js";
import type { RunAgentPayload, RunNotices } from "../run-events/entry.js";
import type { createAgUiRunClient } from "./ag-ui-transport.js";
import type { DurableRunBinding } from "./durable-run-subscription.js";

export interface AssistantTransportOptions {
  /**
   * Read fresh on every `startRun` call, never captured once — matching `AssistantDock.tsx`'s own
   * `runContext` convention (see that file's doc on why `frontendBindToken` is read the same way):
   * the operator can flip the runtime picker's mode mid-session, and a captured value would keep
   * routing every later turn through whichever mode was selected when the transport was first
   * built (`AssistantDock.tsx` memoizes the transport once, for the reason its own comment gives —
   * rebuilding it would drop in-flight runs).
   */
  getExecutionConfig?: (required: Record<string, never>, optional: Record<string, never>) => ExecutionConfig;
  /**
   * ADR-059's AG-UI canary toggle — deliberately NOT a value on {@link ExecutionConfig}: that type
   * is `@jini-ai/ui`'s own closed `'local-cli' | 'byok'` union, a separate repo/package, and
   * extending it would mean a cross-repo edit this ADR explicitly avoids (Decision 1: "a zero-touch
   * addition to Jini"). Read fresh on every `startRun` call, same "never captured" convention
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
   * `session/load` already restores (`agent-session-resume.ts`).
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
 readonly agUi: ReturnType<typeof createAgUiRunClient>;
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
/** Bind transport effects once; in-flight controllers belong to this client, never the package.
 * Positional run methods implement the existing ChatTransport contract. */
export function createAssistantTransportClient({ ports }: { ports: AssistantTransportPorts }, _options: Record<string, never> = {}): AssistantTransportClient {
  const asString = (value: unknown) => runEvents.asString({ value }, {});
  const readSseFrames = (body: ReadableStream<Uint8Array>) => runEvents.readSseFrames({ body }, {});
  const readTerminalReason = (raw: string | undefined, wrapped: boolean) => runEvents.readTerminalReason({ raw, wrapped }, {});
  const terminalReasonNotice = (reason: string) => runEvents.terminalReasonNotice({ reason, notice: ports.notices.toolStepLimit }, {});
  const translateRunAgentPayload = (payload: RunAgentPayload) => runEvents.translateRunAgentPayload({ payload }, {});

  /**
   * Shared HTTP implementation of `@jini-ai/chat/react`'s `ChatTransport` port (originally ADR-049).
   *
   * TWO run paths live here, selected per-turn by `getExecutionConfig()` (see
   * `createAssistantTransport`'s own doc):
   *
   * 1. **Local CLI** (the original, unchanged path): binds to the real `@jini-ai/http` run surface
   *    `src/server/modules/assistant.ts` mounts — `POST /api/runs` to start, `GET
   *    /api/runs/:runId/events` (native `EventSource`) to stream, `GET /api/runs/:runId` for status,
   *    `POST /api/runs/:runId/cancel` to stop. Every SSE frame's `data` is a full `@jini-ai/protocol`
   *    `RunProtocolEvent` (`{kind, payload, ...}`), not chat-core's own `AgentEvent` — chat-core's own
   *    module doc is explicit that this reduction is a transport concern ("a host's transport adapter
   *    is responsible for reducing wire deltas... into the persisted/renderable AgentEvent items"), so
   *    `translateRunAgentPayload` below does that translation.
   * 2. **API · BYOK** (2026-08-04, ADR-049's picker): binds to `src/server/modules/assistant-byok.ts`'s
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











  const RUNS_URL = ports.runsUrl;
  const BYOK_TURN_URL = ports.byokTurnUrl;
  /** Distinguishes a BYOK-run id (client-minted, no server-side run record) from a daemon-run id
   *  (server-minted, reattachable) wherever a bare `runId` string is all a `ChatTransport` method
   *  receives — see `stopRun`/`fetchRunStatus`/`reattachRun` below for why the distinction matters. */
  const BYOK_RUN_ID_PREFIX = ports.byokRunIdPrefix;

  /**
   * How many trailing messages of a conversation go to the agent.
   *
   * A cap rather than none: each turn cold-boots a fresh subprocess and pays for its whole input, so
   * an uncapped transcript makes every message in a long chat more expensive than the last. 40 is
   * roughly 20 exchanges — beyond what a working session usually needs to stay coherent, and far
   * short of where input cost starts to dominate. `buildTranscript` separately truncates any single
   * oversized message, so this bounds the number of turns, not their size.
   */
  const MAX_TRANSCRIPT_TURNS = 40;

  // The daemon-stream translation (`translateRunAgentPayload`, the terminal notices, `translateRunFrame`)
  // lives in `@jini-ai/chat/core/run-events`, extracted from the host's 2026-09-27 contract, so the API's
  // run finalizer saves exactly what this transport would have. Re-exported here so existing importers
  // and tests keep their paths.


  /**
   * The prompt for one run: the whole conversation so far, not just the newest message.
   *
   * This used to send only the latest user turn, which is why the assistant appeared to have no
   * memory — ask it something, then ask a follow-up, and the second run had never seen the first.
   * That looked like a missing capability and was not: `ChatPane` hands the full history to every
   * `startRun`, and it was being discarded here, in the browser, before the request was even built.
   * Nothing server-side had to change.
   *
   * `buildTranscript` rather than a hand-rolled join, because flattening a transcript has more edges
   * than it first appears: it truncates any single oversized message, escapes `## user`/`## assistant`
   * inside message bodies so a user cannot forge a turn boundary by pasting one, summarizes persisted
   * artifacts instead of replaying them, and prepends a warning when prior-run telemetry shows the
   * context was already large. Every admin turn cold-boots a fresh CLI subprocess, so the transcript
   * IS the memory — and the same property makes an unbounded one expensive.
   *
   * Bounded deliberately: each run is billed, and an unbounded transcript grows the input cost of
   * every subsequent turn in a conversation that has no natural end. {@link MAX_TRANSCRIPT_TURNS}
   * keeps a long-running chat from silently becoming the most expensive thing in the product.
   */
  function runPrompt(history: StartRunInput["history"]): string {
    // `historyForTranscript` first, THEN the cap: dropping failed rows before slicing means the 40
    // turns that survive are 40 real ones, not 40 slots some of which are rows the agent never wrote.
    const recent = historyForTranscript(history as ChatMessage[]).slice(-MAX_TRANSCRIPT_TURNS);
    return buildTranscript({ history: recent });
  }

  /**
   * Whether an assistant message represents a turn the agent actually answered — the single
   * definition both {@link historyForTranscript} and {@link undeliveredUserPrompt} key off.
   *
   * `undefined` counts as answered: rows written before `ai_chat_messages.run_status` existed carry
   * no status at all, and treating those as unanswered would re-send the whole history of every
   * legacy conversation on its next turn. Every non-`succeeded` status counts as unanswered —
   * `failed` and `canceled` obviously, and `queued`/`running` because a run killed mid-flight (a
   * daemon respawn, see `daemon-supervisor.ts`) never reaches a terminal status at all and leaves
   * exactly such a row behind.
   *
   * Do not "simplify" this away by deleting the failed rows at the source instead. That was the first
   * shape proposed for this fix and it is the wrong trade: `run_status='failed'` was ALREADY the
   * explicit failed state, and the only thing missing was somewhere that skips it. The row's
   * `events_json` is the sole durable record of why a run died (exit code, signal, the CLI's own
   * stderr) once the daemon's in-memory event log is gone, and the pane renders it on reload — so
   * dropping the row trades a history bug for a forensics hole. The skip belongs here, on the read
   * side. See {@link historyForTranscript} and `assistant-chats.ts`'s `persistableMessages`.
   */
  function isAnsweredAssistantTurn(message: ChatMessage): boolean {
    return message.runStatus === undefined || message.runStatus === "succeeded";
  }

  /**
   * The history a transcript may be built from: every user turn, and only those assistant turns the
   * agent actually answered.
   *
   * Defect 3 of the 2026-09-11 chat-lifecycle repair. `ai_chat_messages` in
   * the investigated host's `chat.db` holds assistant rows with `run_status='failed'` and
   * `length(content)=0` — the durable trace of a run that died before writing a token. Replayed
   * through `buildTranscript` they become a `## assistant` block with nothing under it: the next run
   * is told the agent replied when what actually happened is that it died, and a failure the user can
   * see in the pane is laundered into an empty answer in the model's context.
   *
   * The rows themselves are deliberately NOT deleted, and this is the fix instead: their
   * `events_json` carries the only surviving record of why the run failed (exit code, signal, the
   * CLI's own stderr), the daemon's event log is in-memory and gone, and the pane renders that notice
   * on reload. Partial output from a failed run stays stored as partial output for the same reason —
   * it is visible to the user, and it is not the agent's answer, so it does not go back into a prompt.
   *
   * @param history - The pane's transcript, oldest first.
   * @returns A new array; the input is never mutated.
   * @complexity O(n) in history length, one pass, no allocation per message.
   */
  function historyForTranscript(history: readonly ChatMessage[]): ChatMessage[] {
    return history.filter((message) => message.role !== "assistant" || isAnsweredAssistantTurn(message));
  }

  /**
   * Prepended when more than one user turn is being sent at once, so the agent is not told the user
   * typed all of it just now. Deliberately absent from the single-turn case — a note on every
   * ordinary message would be a standing lie in the prompt of every turn in every conversation.
   */
  const UNDELIVERED_TURNS_NOTE =
    "[Some of the messages below never reached you: the run that should have answered them failed before it could. Treat them as the user's own words, in order, and answer all of them.]";

  /**
   * The user text a run must carry when the agent carries its own conversation memory: every user
   * turn since the last one the agent actually answered, not only the newest.
   *
   * Defect 2 of the 2026-09-11 chat-lifecycle repair, and the half of it that was actually lossy. In
   * the investigated host's `chat.db` conversation `9289701c-…`, position 5's user text is present in
   * `ai_chat_messages` and absent from every agent-session transcript: the run meant to answer it
   * failed 140 ms after start, so no CLI ever read it — and because
   * {@link resolveLocalCliPrompt} sends only the NEWEST user turn to a resume-capable agent, no later
   * turn ever carried it either. The message was durable the whole time and still lost, permanently,
   * with nothing anywhere saying so.
   *
   * Re-delivering costs a duplicate whenever the CLI did read the prompt before dying, which the
   * agent can reconcile from its own session. Not re-delivering costs the user a message with no
   * trace. The two are not symmetric, so this errs toward the duplicate.
   *
   * @param history - The pane's transcript, oldest first.
   * @returns The prompt text — the bare newest turn in the ordinary case (the previous turn was
   *   answered), or the unanswered turns joined oldest-first behind {@link UNDELIVERED_TURNS_NOTE}.
   *   Falls back to the newest user turn when the history ends in an answered assistant turn and
   *   there is therefore nothing pending.
   * @complexity O(n) in history length — one forward scan for the boundary plus one slice/filter over
   *   the tail. A backwards scan with an early exit would be O(1) in practice but needs `break`, and
   *   `n` here is bounded by one conversation's transcript; this is not a hot path (once per turn).
   *   The result is capped at {@link MAX_TRANSCRIPT_TURNS} for the pathological case of a
   *   conversation whose every run has failed.
   */
  function undeliveredUserPrompt(history: readonly ChatMessage[]): string {
    // `Array.prototype.findLastIndex` would say this in one call, but it is ES2023 and this app
    // targets ES2022 (`apps/admin/tsconfig.json`), so the index is accumulated instead.
    let lastAnsweredIndex = -1;
    history.forEach((message, position) => {
      if (message.role === "assistant" && isAnsweredAssistantTurn(message)) lastAnsweredIndex = position;
    });

    const pending = history
      .slice(lastAnsweredIndex + 1)
      .filter((message) => message.role === "user")
      .slice(-MAX_TRANSCRIPT_TURNS);

    if (pending.length === 0) return latestUserPromptFromHistory({ history: history as ChatMessage[] });
    const newest = pending[pending.length - 1] as ChatMessage;
    const newestText = newest.content.trim();
    const newestAttachmentRefs = JSON.stringify((newest.attachments ?? []).map((attachment) => attachment.path));
    // Collapse resends of the newest text with matching attachment refs: a retry is one request.
    const distinct = pending.filter((message, index) => index === pending.length - 1
      || message.content.trim() !== newestText
      || JSON.stringify((message.attachments ?? []).map((attachment) => attachment.path)) !== newestAttachmentRefs)
      .map((message) => message.content);
    if (distinct.length === 1) return distinct[0] as string;
    return `${UNDELIVERED_TURNS_NOTE}\n\n${distinct.join("\n\n")}`;
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

  /** The durable message owns recovery and terminal state; this subscription follows replacement
   * attempts without writing a browser-inferred failure into history. */
  function subscribeToRun(runId: string, handlers: RunHandlers, signal?: AbortSignal): void {
    ports.followRun({ runId, handlers, ...(signal === undefined ? {} : { signal }) }, {});
  }

  /** Client-minted, not server-minted — see module doc's path-2 section: a BYOK run has no server-side
   *  run record to name it. Prefixed so `stopRun`/`fetchRunStatus`/`reattachRun` below can tell a
   *  BYOK-run id apart from a daemon-run id without any other context. */
  function mintByokRunId(): string { return `${BYOK_RUN_ID_PREFIX}${ports.mintId({}, {})}`; }

  /** In-flight BYOK turns' abort controllers, keyed by the client-minted runId — the ONLY way
   *  `stopRun` can cancel a BYOK turn: unlike the daemon path, there is no server-side run record to
   *  `POST .../cancel` against, so cancellation has to reach back into THIS tab's own in-flight
   *  `fetch`. Entries are removed as soon as a turn settles (normally, on error, or on abort) so a
   *  stale id can never resurrect a finished controller. */
  const byokAbortControllers = new Map<string, AbortController>();



  /**
   * Dispatches one parsed BYOK SSE frame to the right `RunHandlers` call — the `"agent"`/`"error"`/
   * `"end"` handling pulled out of `startByokRun`'s stream-consumer IIFE (2026-08-06, complexity
   * pass), where it sat four levels of nesting deep (async IIFE > `try` > `for await` > `if`/
   * `else if`, with a further nested `if` inside the `"agent"` and `"end"` cases). At module scope it
   * is a single, independently testable function: a plain `{event, data}` frame in, a fake
   * `RunHandlers` to assert against, no `ReadableStream`/`fetch`/timers required.
   *
   * @param ctx.collected - This turn's running event log — the same array `startByokRun` hands to
   *   `handlers.onDone` once the stream ends.
   * @param ctx.finish - `startByokRun`'s own idempotent finish (closes out the turn, deletes its abort
   *   controller, calls `onDone`). Called on `"end"`, exactly as the inline version did.
   */
  function handleByokFrame(
    frame: { event: string; data: string },
    ctx: { collected: AgentEvent[]; handlers: RunHandlers; finish: () => void },
  ): void {
    if (frame.event === "agent") {
      const payload = JSON.parse(frame.data) as RunAgentPayload;
      const translated = translateRunAgentPayload(payload);
      if (translated) {
        ctx.collected.push(translated);
        ctx.handlers.onEvent(translated);
      }
    } else if (frame.event === "error") {
      const payload = JSON.parse(frame.data) as { message?: unknown };
      ctx.handlers.onError(new Error(asString(payload.message) || "BYOK turn failed"));
    } else if (frame.event === "end") {
      const notice = terminalReasonNotice(readTerminalReason(frame.data, false));
      if (notice) {
        ctx.collected.push(notice);
        ctx.handlers.onEvent(notice);
      }
      ctx.finish();
    }
  }

  /**
   * Drains a BYOK turn's SSE body to completion, dispatching each frame via {@link handleByokFrame}
   * and settling the turn through `ctx.finish` — the async IIFE `startByokRun` used to hold its
   * stream-consumer loop in, pulled out to a top-level function (2026-08-06, complexity pass, second
   * pass). `startByokRun`'s own per-function score is already under the per-function ceiling; this
   * split is for the OTHER metric this repo's complexity ceiling tracks — a tool that rolls a nested
   * closure's branches into its enclosing function's total still counted this IIFE as part of
   * `startByokRun` as long as it stayed physically inside the body. Moving it to a sibling top-level
   * function removes it from that rollup instead of just moving it to a different nested scope (a
   * `const` inside `startByokRun` would not have changed the rollup at all).
   *
   * @param ctx.runId - Only used to clear {@link byokAbortControllers} on a genuine (non-abort)
   *   failure — the abort path itself already deletes its own entry in `startByokRun` before this
   *   runs, so `ctx.runId` here is scoped to the error branch alone.
   * @param ctx.controller - Read only for `.signal.aborted`, to tell a deliberate `stopRun`/composer
   *   abort apart from a real stream failure — same distinction the inline version drew.
   */
  async function consumeByokStream(
    body: ReadableStream<Uint8Array>,
    ctx: { runId: string; collected: AgentEvent[]; handlers: RunHandlers; finish: () => void; controller: AbortController },
  ): Promise<void> {
    try {
      for await (const frame of readSseFrames(body)) {
        handleByokFrame(frame, { collected: ctx.collected, handlers: ctx.handlers, finish: ctx.finish });
      }
      ctx.finish();
    } catch (error) {
      byokAbortControllers.delete(ctx.runId);
      if (ctx.controller.signal.aborted) {
        // Cancelled via `stopRun` or the composer's own signal — an expected exit, not a reportable
        // failure. `subscribeToRun`'s `EventSource` has no equivalent branch because `.close()`
        // doesn't reject a promise the way an aborted `fetch`'s body reader does; this mirrors what a
        // cancelled daemon run already looks like to the rest of the pane: silence, not an error toast.
        ctx.finish();
        return;
      }
      // Error THEN finish, same order and same reason as `subscribeToRun`'s `end` listener: reporting
      // alone left the turn unsettled (no `onDone`, so the events collected before the failure were
      // never persisted), and finishing first would record the dead run as succeeded.
      ctx.handlers.onError(error instanceof Error ? error : new Error(String(error)));
      ctx.finish();
    }
  }

  /**
   * The BYOK run path (2026-08-04) — one held-open `POST` to `assistant-byok.ts`, no separate
   * `EventSource`/reattach. See module doc's path-2 section for why this shape differs from
   * `subscribeToRun`'s daemon-path pattern, and what it costs (no reattach after a reload; `stopRun`
   * works via the abort-controller map above instead of a server-side cancel endpoint).
   *
   * @complexity Dominated by the network/stream cost of the turn itself; per-frame parsing is O(1).
   * @overallScore 100
   */
  async function startByokRun(
    input: StartRunInput,
    handlers: RunHandlers,
    byok: ExecutionConfig["byok"],
  ): Promise<{ runId: string }> {
    const runId = mintByokRunId();
    const controller = new AbortController();
    byokAbortControllers.set(runId, controller);
    input.signal?.addEventListener("abort", () => controller.abort());

    // `historyForTranscript` first (Defect 3, 2026-09-11): the empty-content filter below already
    // hides a failed run that produced nothing, but NOT one that emitted a few tokens before dying —
    // that partial output would be sent to the provider as if it were the assistant's answer. This is
    // the same defect as on the Local CLI path, reachable by a second route.
    const messages = historyForTranscript(input.history as ChatMessage[])
      .filter((message) => message.content.trim().length > 0)
      .map((message) => ({ role: message.role, content: message.content,
        ...(message.secretRedaction?.secretRedacted ? { secretRedacted: true } : {}),
      }));

    let response: Response;
    try {
      response = await ports.fetch(BYOK_TURN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          messages,
          ...attachmentIdsField(input),
          // The admin screen, as on the Local CLI path (`buildLocalCliContextRef`): the server puts it
          // in front of the newest message so a BYOK turn knows the open page and where drawings go.
          ...pageContextField(input),
          byok: {
            protocol: byok.protocol,
            apiKey: byok.apiKey,
            ...(byok.baseUrl ? { baseUrl: byok.baseUrl } : {}),
            model: byok.model,
            ...(byok.maxTokens !== undefined ? { maxTokens: byok.maxTokens } : {}),
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      byokAbortControllers.delete(runId);
      throw error instanceof Error ? error : new Error(String(error));
    }

    if (!response.ok || !response.body) {
      byokAbortControllers.delete(runId);
      const detail = await response.text().catch(() => "");
      throw new Error(`BYOK turn failed to start (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }

    const collected: AgentEvent[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      byokAbortControllers.delete(runId);
      handlers.onDone(collected);
    };

    // Deliberately not awaited: `startRun`'s contract (matching the daemon path immediately above)
    // is to resolve `{runId}` once the turn has STARTED, not once it has finished — the response
    // headers (hence this function reaching this point at all) arrive as soon as
    // `assistant-byok.ts` calls `beginStream`, well before generation completes.
    void consumeByokStream(response.body, { runId, collected, handlers, finish, controller });

    return { runId };
  }

  /**
   * Which browser tab a Local CLI run should be allowed to drive, from `ChatPane`'s `runContext` prop
   * (`AssistantDock.tsx` supplies it from the live `FrontendSessionBridge`).
   *
   * Read by name rather than spreading the whole `input.context` blob: `contextRef` is a shared
   * envelope that the host's proxy also writes `principalId` into (`src/server/modules/assistant.ts`),
   * and a spread would let any future `runContext` key silently shadow it — an identity field being
   * overwritten by a UI prop is not a failure mode worth leaving open to save one line.
   *
   * Returns `{}` (omitting the field entirely) when absent, which is a normal state, not an error:
   * the daemon treats a run with no bind token as one with no screen to drive
   * (`agent-daemon-server.ts`).
   */
  function frontendBindTokenField(input: StartRunInput): Record<string, unknown> {
    const frontendBindToken = input.context?.["frontendBindToken"];
    return typeof frontendBindToken === "string" && frontendBindToken.length > 0 ? { frontendBindToken } : {};
  }

  /**
   * The Local CLI picker's live model selection, from `ChatPane`'s `runContext` prop
   * (`AssistantDock.tsx`'s `resolveRunContext`). Same "read by name, not spread" reasoning as
   * {@link frontendBindTokenField} above, and the same "omit when absent" convention. Forwarded as an
   * opaque string — `agent-daemon-server.ts` forwards it the same way, and `AgentExecutor.run()`'s
   * def-level `buildArgs` is what decides what an absent or `'default'` value means for a given CLI
   * (`@jini-ai/agent-runtime`'s `models.ts`/`resolveModelForAgent`).
   */
  function modelField(input: StartRunInput): Record<string, unknown> {
    const model = input.context?.["model"];
    return typeof model === "string" && model.length > 0 ? { model } : {};
  }

  /**
   * The Execution tab's "Reasoning effort" pick, from the same `runContext` seam as {@link modelField}
   * above and forwarded with the identical "opaque string, omit when absent" convention. What turns it
   * into real argv is the def's own `buildArgs` on the daemon side (`claude --effort <level>`, codex's
   * `-c model_reasoning_effort=...`) — nothing here interprets it, and a runtime whose effort is
   * encoded in the model id (antigravity) never sends it at all, because its level is already inside
   * `model`.
   */
  function reasoningField(input: StartRunInput): Record<string, unknown> {
    const reasoning = input.context?.["reasoning"];
    return typeof reasoning === "string" && reasoning.length > 0 ? { reasoning } : {};
  }

  /**
   * Opaque `attachment:<uuid>` capability ids (`ChatAttachment.path` — never a real filesystem path
   * this early; see `@jini-ai/http-kit`'s `attachments.ts` trust-model doc), not the attachments
   * themselves — `contextRef` is the one channel `prompt`/`frontendBindToken` already ride on to reach
   * `agent-daemon-server.ts`'s `onStarted`, which is where these ids get exchanged for real,
   * re-validated paths via `AttachmentStore.claim()`. Nothing on this side of the wire is trusted; the
   * id is inert until the daemon claims it.
   *
   * Returns `{}`, same convention as {@link frontendBindTokenField} above — a run with no attachments
   * is the overwhelmingly common case and should not carry a key for it.
   */
  function attachmentIdsField(input: StartRunInput): Record<string, unknown> {
    return input.attachments && input.attachments.length > 0
      ? { attachmentIds: input.attachments.map((attachment) => attachment.path) }
      : {};
  }

  /**
   * Opaque Agent Plugin ids (`plugin.json`'s own `name`, e.g. `"ui-ux-design"`) the operator has
   * pinned as composer chips — `AssistantDock.tsx`'s `useSelectedAgentPlugins`, threaded here via
   * `ChatPane`'s `runContext` prop the same way {@link frontendBindTokenField}/{@link modelField}
   * above already are. Same "read by name, not spread" and "omit when absent" conventions as those
   * two fields: this is not the plugin's CONTENT, only a reference to it —
   * `agent-daemon-server.ts`'s `onStarted` is where a ref gets resolved against the real installed
   * package on disk and its own text prepended to the prompt (see that function's own doc for the
   * resolution/failure rules). Filtered to non-empty strings for the same reason `attachmentIds` is
   * filtered on the decode side (`run-start-context.ts`'s `parseRunStartContextRef`) — this is the
   * encode side of the same wire value, and a malformed entry here should not silently become a
   * malformed one there.
   */
  function pluginRefIdsField(input: StartRunInput): Record<string, unknown> {
    const pluginRefIds = input.context?.["pluginRefIds"];
    if (!Array.isArray(pluginRefIds)) return {};
    const filtered = pluginRefIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    return filtered.length > 0 ? { pluginRefIds: filtered } : {};
  }

  /**
   * The active conversation id, from `ChatPane`'s `runContext` prop (`AssistantDock.tsx`'s
   * `chats.activeId`, the same `useRunContext` seam {@link frontendBindTokenField}/{@link modelField}/
   * {@link pluginRefIdsField} above already ride). Lets `agent-daemon-server.ts`'s `onStarted` resume
   * this conversation's agent-CLI session across turns instead of spawning cold every time
   * (`server/inbound/assistant/agent-session-resume.ts`) — see that file's own doc. Returns `{}`, same
   * convention as every other optional field here: a run started before any conversation exists yet
   * (or from a future daemon client that never sends one) just gets no session-resume behavior, not
   * an error.
   */
  function conversationIdField(input: StartRunInput, resolvedConversationId?: string): Record<string, unknown> {
    const conversationId = resolvedConversationId ?? input.context?.["conversationId"];
    return typeof conversationId === "string" && conversationId.length > 0 ? { conversationId } : {};
  }

  /**
   * The admin screen this message was sent from (`lib/agent-screen-context.ts`, read by
   * `AssistantDock.hooks.tsx`'s `useRunContext` at send time), so the agent knows what "this page"
   * means. Forwarded as-is when it is a plain object — the daemon's `run-page-context.ts` owns
   * validating and capping its fields, the same split `attachmentIds` has — and omitted otherwise.
   */
  function pageContextField(input: StartRunInput): Record<string, unknown> {
    const pageContext = input.context?.["pageContext"];
    return typeof pageContext === "object" && pageContext !== null && !Array.isArray(pageContext) ? { pageContext } : {};
  }

  /**
   * Assembles the Local CLI path's `contextRef` — everything `startRun`'s daemon branch sends besides
   * `agentId` itself. Pulled out of `startRun` (2026-08-06, complexity pass, second pass) as its own
   * pure function, then split again (2026-09-04, complexity pass) into one pure field-helper per
   * optional field, each above: six independent, unrelated fields, none sharing state or order
   * dependence, each read from `input` by name and included only when present (see each helper's own
   * doc for why). Kept as six separate functions rather than grouped, on purpose — the fields have no
   * conceptual relationship to group them by (identity, execution config, and content all mixed
   * together), and inventing a grouping would obscure the very independence each field's own doc
   * argues for. A plain object in, a plain object out — directly testable with a `StartRunInput`
   * fixture, no `fetch`/`EventSource` involved.
   *
   * @param prompt - The already-built transcript string ({@link runPrompt}'s result) — this function
   *   only decides which of the six OPTIONAL fields ride alongside it, not how the prompt itself is
   *   built.
   * @param resolvedConversationId - {@link resolveRunConversationId}'s answer, when `startRun` had to
   *   adopt a conversation because `input.context` named none (the first turn of a chat). Omitted by
   *   every caller that already has an id on `input.context`, and by this function's own unit tests —
   *   in which case the `context` field is read exactly as before.
   */
  function buildLocalCliContextRef(
    input: StartRunInput,
    prompt: string,
    resolvedConversationId?: string,
  ): Record<string, unknown> {
    return {
      prompt: ports.projectPrompt({ prompt, context: input.context }, {}),
      // The transcript is already sanitized; retain its signal across the daemon JSON boundary.
      ...(input.history.some(message => message.role === "user" && message.secretRedaction?.secretRedacted) ? { secretRedacted: true } : {}),
      assistantMessageId: (input as StartRunInput & { assistantMessageId?: string }).assistantMessageId,
      ...frontendBindTokenField(input),
      ...modelField(input),
      ...reasoningField(input),
      ...attachmentIdsField(input),
      ...pluginRefIdsField(input),
      ...conversationIdField(input, resolvedConversationId),
      ...pageContextField(input),
    };
  }


  /**
   * The conversation id this run must carry, adopting one if the caller had none.
   *
   * @param input - `startRun`'s own input; `input.context.conversationId` wins whenever it is a
   *   non-empty string, so turn 2 onward never touches {@link ensureConversationId} and never issues a
   *   redundant `POST /conversations`.
   * @param ensureConversationId - `AssistantTransportOptions.ensureConversationId`, or
   *   `undefined` for a transport built without it (every test and any non-dock consumer).
   * @returns The id to put on the wire, or `undefined` to omit the key entirely — including when
   *   adoption failed. The `.catch` is load-bearing: `ensureConversationId`'s own contract promises
   *   `null` over a rejection, and this makes that promise safe to depend on even if a future
   *   implementation breaks it, rather than failing the user's turn over a lost session id.
   * @complexity O(1) plus at most one conversation-creation round trip, on the first turn only.
   */
  async function resolveRunConversationId(
    input: StartRunInput,
    ensureConversationId: ((required: Record<string, never>, optional: Record<string, never>) => Promise<string | null>) | undefined,
  ): Promise<string | undefined> {
    const fromContext = input.context?.["conversationId"];
    if (typeof fromContext === "string" && fromContext.length > 0) return fromContext;
    if (!ensureConversationId) return undefined;
    const adopted = await ensureConversationId({}, {}).catch(() => null);
    return typeof adopted === "string" && adopted.length > 0 ? adopted : undefined;
  }

  /**
   * Resolves the prompt string `startRun`'s Local CLI branch sends: the full rendered transcript
   * ({@link runPrompt}) by default, or only what the agent has not already been given
   * ({@link undeliveredUserPrompt}) when `input.agentId` is present in `resumeCapableAgentIds` — see
   * `getResumeCapableAgentIds`'s own doc on {@link AssistantTransportOptions} for the full
   * contract this mirrors. Pulled out of `startRun` (2026-09-04, complexity pass) as its own pure
   * step. `options.getResumeCapableAgentIds?.({}, {})` is still called at the same point in `startRun` as
   * before — only the "which agentIds carries own memory" branch itself moves here, so the "read fresh
   * on every call" convention that doc argues for is unchanged.
   */
  function resolveLocalCliPrompt(
    input: StartRunInput,
    resumeCapableAgentIds: ReadonlySet<string> | undefined,
  ): string {
    const carriesOwnMemory = input.agentId !== undefined && resumeCapableAgentIds?.has(input.agentId) === true;
    // BEHAVIOR CHANGE (2026-09-11, Defect 2): the resume-capable branch was `latestUserPrompt` — the
    // single newest user turn, on the assumption that everything before it is already inside the
    // CLI's own session. That assumption holds only for turns the agent actually answered; a turn
    // whose run died before the CLI read its prompt is in neither place, and nothing ever sent it
    // again. `undeliveredUserPrompt` returns the identical single string in the ordinary case and
    // differs only when there is genuinely something unanswered to catch up on. The
    // `latestUserPrompt` parameter this used to take went with it: `startRun` still computes that
    // string for its own send guard, but this branch has no use for it any more.
    return carriesOwnMemory ? undeliveredUserPrompt(input.history as ChatMessage[]) : runPrompt(input.history);
  }

  /**
   * Writes the newest user turn to durable storage before its run is dispatched, and never fails the
   * turn over it.
   *
   * Defect 2 of the 2026-09-11 chat-lifecycle repair. Message persistence is a client-side
   * `Promise.all` driven by `onMessagesChange` deltas (`use-assistant-chats.hooks.ts`'s `flush`) and
   * run dispatch is a separate `POST /api/runs` here — nothing orders them and nothing makes them
   * atomic, so a browser or daemon death in the window between them could leave a dispatched run whose
   * prompt existed nowhere durable. Await the same PUT when a delta has already scheduled it;
   * acceptance also carries the exact user message and commits it with the assistant stub when
   * browser persistence fails, so sending does not depend on a successful separate PUT.
   *
   * The idempotency key is the message's own id — `assistant-chats.ts`'s `saveMessage` PUTs to
   * `/messages/<id>`, so this write and the `flush` that will race it converge on one row rather than
   * two, and a retry of the same content is free. `useAssistantChats`'s own `persistUserTurn` also
   * marks the id written, so in practice `flush` skips it entirely.
   *
   * @param input - `startRun`'s own input; the newest `role: "user"` message in its history is what
   *   gets written.
   * @param conversationId - The already-resolved conversation (see `resolveRunConversationId`), or
   *   `undefined` when adoption failed — there is no row to write into in that case.
   * @param persistUserTurn - `AssistantTransportOptions.persistUserTurn`, or `undefined`
   *   for a transport built without it (every test and any non-dock consumer).
   * @returns Nothing, always. The `.catch` keeps a failed browser PUT from refusing the user's turn;
   *   durable acceptance is now responsible for committing its copy before dispatch.
   * @complexity O(n) in history length for the newest-user-turn scan, plus one PUT.
   */
  async function persistUserTurnBeforeDispatch(
    input: StartRunInput,
    conversationId: string | undefined,
    persistUserTurn: ((required: { conversationId: string; message: ChatMessage }, optional: Record<string, never>) => Promise<void>) | undefined,
  ): Promise<void> {
    if (conversationId === undefined || persistUserTurn === undefined) return;
    const history = input.history as ChatMessage[];
    const message = [...history].reverse().find((candidate) => candidate.role === "user");
    if (message === undefined) return;
    await persistUserTurn({ conversationId, message }, {}).catch(() => undefined);
  }

  /**
   * Turns `startRun`'s Local CLI `POST /api/runs` response into either a thrown, detailed error or a
   * subscribed run — the two outcomes once the request lands. Pulled out of `startRun` (2026-09-04,
   * complexity pass) as its own step: `response.ok` in, `{runId}` or a thrown `Error` out. The
   * `.text().catch(() => "")` is load-bearing, not decorative — see the inline comment below.
   */
  async function finishLocalCliRun(
    response: Response,
    handlers: RunHandlers,
    signal: AbortSignal | undefined,
  ): Promise<{ runId: string }> {
    if (!response.ok) {
      // A response whose body stream errors out (e.g. a dropped connection) must not turn "the server
      // rejected the request" into "the client crashed reading the rejection".
      const detail = await response.text().catch(() => "");
      throw new Error(`agent run failed to start (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }

    const { run, messageId, conversationId } = (await response.json()) as { run: { id: string }; messageId?: string; conversationId?: string };
    if (messageId && conversationId) ports.bindRun({ runId: run.id, binding: { messageId, conversationId } }, {});
    subscribeToRun(run.id, handlers, signal);
    return { runId: run.id };
  }

  function createAssistantTransport(options: AssistantTransportOptions = {}): ChatTransport {
    return {
      async startRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }> {
        // Guard on the newest USER turn, not on the assembled transcript: a history containing only
        // assistant messages would still produce a non-empty transcript, and sending that as a
        // prompt asks the agent to reply to itself. Shared by both paths below, and reused (rather than
        // recomputed) by the Local CLI branch's own resume-capable check further down.
        const latestUserPrompt = latestUserPromptFromHistory({ history: input.history as ChatMessage[] });
        if (!latestUserPrompt) {
          throw new Error("no user message to send");
        }

        const executionConfig = options.getExecutionConfig?.({}, {});
        // Dispatches on MODE alone, not on whether a key is typed in this browser right now
        // (2026-08-05). `executionConfig.byok.apiKey` is write-only server-side — it is empty on
        // every fresh load even when a credential IS stored — so gating on it here would make BYOK
        // mode permanently unable to dispatch for exactly the case the server-side store exists to
        // support. `assistant-byok.ts`'s route already resolves the credential correctly either way
        // (a locally-typed key wins when present; an empty/omitted one falls back to this admin's own
        // stored row), so an empty `byok.apiKey` is a legitimate turn, not a reason to fall through to
        // the Local CLI path. A turn with genuinely no usable credential anywhere still fails, just one
        // level down — the route's own 400 `"no usable BYOK credential..."` — which is a real,
        // actionable answer instead of the mode picker silently refusing to try.
        if (executionConfig?.mode === "byok") {
          return startByokRun(ports.projectInput({ input }, {}), handlers, executionConfig.byok);
        }

        // AG-UI canary path (ADR-059) — a host-supplied toggle, independent of `executionConfig.mode`
        // (Jini's own closed union, never extended for this). Checked AFTER the byok branch above:
        // BYOK's single-request shape never touches the daemon at all, so there is nothing for this
        // path (which wraps the daemon specifically) to intercept there — the toggle only ever
        // diverts the Local CLI branch below.
        if (options.getAgUiEnabled?.({}, {})) {
          // `historyForTranscript` here rather than inside `startAgUiRun`: that module importing this
          // one would be a cycle, and this is its only caller. Same rule as the BYOK and Local CLI paths.
          return ports.agUi.startAgUiRun({ input: ports.projectInput({ input: { ...input, history: historyForTranscript(input.history as ChatMessage[]) } }, {}), handlers }, {});
        }

        // Local CLI path below. `resolveLocalCliPrompt`'s own doc has the full contract for why an
        // unresolved/absent agentId fails open to the full transcript rather than the bare message.
        const prompt = resolveLocalCliPrompt(input, options.getResumeCapableAgentIds?.({}, {}));
        // Awaited BEFORE the POST, and only on this branch: session resume is a daemon-run concept, so
        // neither the BYOK nor the AG-UI path above has anything to file a session id under. See
        // `resolveRunConversationId` and `AssistantTransportOptions.ensureConversationId`.
        const conversationId = await resolveRunConversationId(input, options.ensureConversationId);
        // Also before the POST, and for the same reason it is awaited rather than fired off: the
        // user's turn must be durable before a run that can fail to deliver it exists at all
        // (Defect 2, 2026-09-11). Ordered after conversation adoption because it needs the id that
        // adoption produces. Known gap, not an oversight: the BYOK and AG-UI branches above return
        // before this point and resolve no conversation id of their own, so neither writes a durable
        // user turn ahead of dispatch — closing that needs those paths to adopt a conversation first.
        await persistUserTurnBeforeDispatch(input, conversationId, options.persistUserTurn);
        const userMessage = [...(input.history as ChatMessage[])].reverse().find((message) => message.role === "user");
        // Acceptance commits the question and stub together even if the separate browser PUT fails
        // or the tab disappears. Carry the exact message ID/payload, never the rendered prompt.
        const base = buildLocalCliContextRef(input, prompt, conversationId);
        const contextRef = userMessage ? { ...base, userMessage } : base;

        const response = await ports.acceptRun({
          ...(input.cancelSignal === undefined ? {} : { signal: input.cancelSignal }),
          requestSignal: input.cancelSignal ?? input.signal,
          body: { contextRef: JSON.stringify(contextRef), agentId: input.agentId, idempotencyKey: base.assistantMessageId },
          messageId: base.assistantMessageId,
          ...(conversationId === undefined ? {} : { conversationId }),
        }, {});

        return finishLocalCliRun(response, handlers, input.signal);
      },

      async reattachRun(runId: string, handlers: RunHandlers, options?: ReattachRunOptions): Promise<void> {
        // A BYOK run has no server-side record to reattach to (module doc's path-2 section) — the
        // stream lived entirely on the original `fetch()`'s response body, which a reload has already
        // discarded. Reporting the run as simply over (an empty `onDone`) is the honest answer: there
        // is no way to resume it, and pretending otherwise would hang the pane waiting for events that
        // can never arrive.
        if (runId.startsWith(BYOK_RUN_ID_PREFIX)) {
          handlers.onDone([]);
          return;
        }
        // Same "no server-side record to resume" reasoning as the BYOK branch above — see
        // `assistant-transport-ag-ui.ts`'s own doc for why this path has no reattach story yet.
        if (ports.agUi.isAgUiRunId({ runId }, {})) {
          return ports.agUi.reattachAgUiRun({ handlers }, {});
        }
        subscribeToRun(runId, handlers, options?.signal);
      },

      async fetchRunStatus(runId: string) {
        // Same reasoning as `reattachRun` above — no server-side run record exists for a BYOK run id,
        // so there is no status to fetch. `null` is this port's existing "unknown/not trackable"
        // value (see the daemon branch below's own `!response.ok` case), not a new state.
        if (runId.startsWith(BYOK_RUN_ID_PREFIX)) return null;
        if (ports.agUi.isAgUiRunId({ runId }, {})) return ports.agUi.fetchAgUiRunStatus({}, {});
        const response = await ports.fetch(`${RUNS_URL}/${encodeURIComponent(runId)}`, { credentials: "same-origin" });
        if (!response.ok) return null;
        const { run } = (await response.json()) as { run: { state: string } };
        return toChatCoreRunStatus(run.state) ?? null;
      },

      async stopRun(runId: string): Promise<void> {
        // A BYOK run's only cancellation handle is the abort controller `startByokRun` registered for
        // this exact id — there is no server-side run to `POST .../cancel` against.
        if (runId.startsWith(BYOK_RUN_ID_PREFIX)) {
          byokAbortControllers.get(runId)?.abort();
          return;
        }
        if (ports.agUi.isAgUiRunId({ runId }, {})) {
          return ports.agUi.stopAgUiRun({ runId }, {});
        }
        const response = await ports.fetch(`${RUNS_URL}/${encodeURIComponent(runId)}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ runId, messageId: ports.runBinding({ runId }, {})?.messageId }),
        });
        // 404: the daemon no longer knows this run (it restarted), so nothing is left running to stop.
        if (response.status === 404) return;
        // `fetch` resolves on any status: without this a refused cancel (401/403/500) resolved exactly
        // like a successful one while the run kept executing. `useRunStream` logs a rejection here.
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`cancelling agent run failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
        }
      },
    };
  }




  return {
   createAssistantTransport: ({ options = {} }: { options?: AssistantTransportOptions }, _optional: Record<string, never> = {}) => createAssistantTransport(options),
   historyForTranscript: ({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never> = {}) => historyForTranscript(history),
   undeliveredUserPrompt: ({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never> = {}) => undeliveredUserPrompt(history),
   buildLocalCliContextRef: ({ input, prompt, resolvedConversationId }: { input: StartRunInput; prompt: string; resolvedConversationId?: string }, _optional: Record<string, never> = {}) => buildLocalCliContextRef(input, prompt, resolvedConversationId),
   handleByokFrame: ({ frame, ctx }: { frame: Parameters<typeof handleByokFrame>[0]; ctx: Parameters<typeof handleByokFrame>[1] }, _optional: Record<string, never> = {}) => handleByokFrame(frame, ctx),
   consumeByokStream: ({ body, ctx }: { body: ReadableStream<Uint8Array>; ctx: Parameters<typeof consumeByokStream>[1] }, _optional: Record<string, never> = {}) => consumeByokStream(body, ctx),
  };
}
