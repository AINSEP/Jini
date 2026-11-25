/** Pure chat-event to AG-UI projection; lifecycle state belongs to one run.
 * Daemon payloads are reduced to chat events by `run-events` `translateRunAgentPayload`, the one
 * reducer; this file only projects. AG-UI has no standard field for a tool call's display
 * correlation or for a tool result's error flag, media and outcome, so those ride as extra fields
 * under their chat-event names (the official event schemas are passthrough); `event-reduction.ts`
 * reads them back. Strict interruption ordering closes a message before a tool starts. IDs and custom event names
 * are injected, with official AG-UI types authoritative; auth, routes and encoder stay with the host.
 * The host emits RUN_STARTED and terminal RUN_FINISHED/RUN_ERROR outside this pure projection. */
import { EventType, InterruptSchema, RunAgentInputSchema, type AGUIEvent, type Interrupt } from '@ag-ui/core';
import { readSseFrames, readTerminalReason, translateRunFrame, type RunFrameCarry, type RunFrameOutcome, type RunNotices } from '../run-events/entry.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

export interface EventIdGenerator {
  next(args: { prefix: string; ordinal: number }): string;
}
export interface CustomEventNames {
  readonly usage: string;
  readonly status: string;
  readonly extensionPrefix: string;
}

export type AgUiEvent = Extract<
  AGUIEvent,
  {
    type:
      | EventType.RUN_STARTED
      | EventType.RUN_FINISHED
      | EventType.RUN_ERROR
      | EventType.TEXT_MESSAGE_START
      | EventType.TEXT_MESSAGE_CONTENT
      | EventType.TEXT_MESSAGE_END
      | EventType.REASONING_START
      | EventType.REASONING_MESSAGE_START
      | EventType.REASONING_MESSAGE_CONTENT
      | EventType.REASONING_MESSAGE_END
      | EventType.REASONING_END
      | EventType.TOOL_CALL_START
      | EventType.TOOL_CALL_ARGS
      | EventType.TOOL_CALL_END
      | EventType.TOOL_CALL_RESULT
      | EventType.RAW
      | EventType.CUSTOM;
  }
>;

export interface AgUiTranslationState {
  openTextMessageId: string | null;
  openReasoningMessageId: string | null;

  nextId: number;
  readonly ids: EventIdGenerator;
  readonly customEventNames: CustomEventNames;
}

/** Create isolated per-run translation state with explicit IDs and custom-event wire names. */
export function createAgUiTranslationState({ ids, customEventNames }: { ids: EventIdGenerator; customEventNames: CustomEventNames }): AgUiTranslationState {
  return { openTextMessageId: null, openReasoningMessageId: null, nextId: 0, ids, customEventNames: { ...customEventNames } };
}

function mintId({ state, prefix }: { state: AgUiTranslationState; prefix: string }): string {
  state.nextId += 1;
  return state.ids.next({ prefix, ordinal: state.nextId });
}

function closeOpenMessages(state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openTextMessageId) {
    events.push({ type: EventType.TEXT_MESSAGE_END, messageId: state.openTextMessageId });
    state.openTextMessageId = null;
  }
  if (state.openReasoningMessageId) {
    const messageId = state.openReasoningMessageId;
    events.push({ type: EventType.REASONING_MESSAGE_END, messageId });
    events.push({ type: EventType.REASONING_END, messageId });
    state.openReasoningMessageId = null;
  }
  return events;
}

function handleTextAgentEvent(event: Extract<AgentEvent, { kind: "text" }>, state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openReasoningMessageId) events.push(...closeOpenMessages(state));
  if (!state.openTextMessageId) {
    state.openTextMessageId = mintId({ state, prefix: "msg" });
    events.push({ type: EventType.TEXT_MESSAGE_START, messageId: state.openTextMessageId, role: "assistant" });
  }
  events.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: state.openTextMessageId, delta: event.text });
  return events;
}

function handleThinkingAgentEvent(event: Extract<AgentEvent, { kind: "thinking" }>, state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openTextMessageId) events.push(...closeOpenMessages(state));
  if (!state.openReasoningMessageId) {
    state.openReasoningMessageId = mintId({ state, prefix: "reasoning" });
    events.push({ type: EventType.REASONING_START, messageId: state.openReasoningMessageId });
    events.push({ type: EventType.REASONING_MESSAGE_START, messageId: state.openReasoningMessageId, role: "reasoning" });
  }
  events.push({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: state.openReasoningMessageId, delta: event.text });
  return events;
}

function handleToolUseAgentEvent(event: Extract<AgentEvent, { kind: "tool_use" }>, state: AgUiTranslationState): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  if (state.openTextMessageId || state.openReasoningMessageId) events.push(...closeOpenMessages(state));
  events.push({
    type: EventType.TOOL_CALL_START, toolCallId: event.id, toolCallName: event.name,
    // Which bridge call this row stands for: the transcript matches a repeated call by it, so
    // without these two a client on this wire cannot tell a duplicate from a second call.
    ...(event.toolOrigin !== undefined ? { toolOrigin: event.toolOrigin } : {}),
    ...(event.bridgeCall !== undefined ? { bridgeCall: event.bridgeCall } : {}),
  });
  events.push({ type: EventType.TOOL_CALL_ARGS, toolCallId: event.id, delta: JSON.stringify(event.input ?? {}) });
  events.push({ type: EventType.TOOL_CALL_END, toolCallId: event.id });
  return events;
}

/** A result's optional fields are written only when set, so a plain successful result is the
 *  standard event and nothing more. `isError` is absent for `false`: a reader takes absence as success. */
function handleToolResultAgentEvent(
  { event, state }: { event: Extract<AgentEvent, { kind: "tool_result" }>; state: AgUiTranslationState },
  _optional: Record<string, never> = {},
): AgUiEvent[] {
  return [
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId: mintId({ state, prefix: "tool_result_msg" }),
      toolCallId: event.toolUseId,
      content: event.content,
      role: "tool",
      ...(event.isError ? { isError: true } : {}),
      ...(event.media !== undefined ? { media: event.media } : {}),
      ...(event.outcome !== undefined ? { outcome: event.outcome } : {}),
    },
  ];
}

/** Emit ordered message/tool lifecycles; a tool call closes the preceding message first. */
export function translateAgentEventToAgUi({ event, state }: { event: AgentEvent; state: AgUiTranslationState }): AgUiEvent[] {
  switch (event.kind) {
    case "text":
      return handleTextAgentEvent(event, state);

    case "thinking":
      return handleThinkingAgentEvent(event, state);

    case "tool_use":
      return handleToolUseAgentEvent(event, state);

    case "tool_result":
      return handleToolResultAgentEvent({ event, state });

    case "usage":
      return [{ type: EventType.CUSTOM, name: state.customEventNames.usage, value: event }];

    case "status":
      return [{ type: EventType.CUSTOM, name: state.customEventNames.status, value: event }];

    case "raw":
      return [{ type: EventType.RAW, event: event.line }];

    case "ext":
      return [{ type: EventType.CUSTOM, name: `${state.customEventNames.extensionPrefix}${event.name}`, value: event.data }];

    default: {
      const neverEvent: never = event;
      throw new Error(`translateAgentEventToAgUi: unhandled AgentEvent.kind ${JSON.stringify(neverEvent)}`);
    }
  }
}

/** Close open text/reasoning before the host emits RUN_FINISHED or RUN_ERROR. */
export function closeAgUiRun({ state }: { state: AgUiTranslationState }): AgUiEvent[] {
  return closeOpenMessages(state);
}

/**
 * Hands Jini's `readSseFrames` the daemon response as a stream while this route keeps the reader.
 *
 * `readSseFrames` takes a stream and holds its only reader until the frames end. The route needs
 * its own handle on the daemon response too: the `res.on("close", ...)` hook cancels that reader so
 * a client that leaves stops the upstream read at once, not at the daemon's next frame. A
 * `ReadableStream` can only have one active reader at a time — a second `body.getReader()` throws
 * `TypeError: ReadableStream is locked` — so the route keeps the one reader and Jini pulls through
 * it. Cancelling the reader resolves the pending pull as done, which ends the frames the same way
 * a daemon close does.
 *
 * `id:` lines are ignored by the frame reader: this path has no reattach story to resume a cursor
 * for.
 */
function streamFromReader({ reader }: { reader: ReadableStreamDefaultReader<Uint8Array> }, _optional = {}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

interface AgUiFrameContext {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  threadId: string;
  runId: string;
  state: AgUiTranslationState;
  notices: RunNotices;
  write: (event: AgUiEvent) => void;
}

/** Writes every event in `events` to `res`, in order — the repeated `for (const e of events)
 *  writeAgUiEvent(res, e)` pattern below, named once so each caller is a flat sequence of
 *  statements rather than its own loop. */
function writeAllAgUiEvents({ write, events }: { write: (event: AgUiEvent) => void; events: AgUiEvent[] }, _optional = {}): void {
  for (const event of events) write(event);
}

/**
 * Writes one translated daemon frame as AG-UI events. Every daemon SSE frame's `data:` line is the
 * FULL `RunProtocolEventWire` envelope, not the inner payload; Jini's `translateRunFrame` unwraps
 * it, and a frame it cannot read yields no events instead of failing the run.
 *
 * A terminal frame (`error`, or `end`) first writes its own notices, then closes any open
 * message/reasoning segment, then the one terminal event: `RUN_ERROR` for an `error` frame and for
 * an `end` the daemon classified as failed, else `RUN_FINISHED` — with reason `cancelled` for an
 * `end` the daemon classified as canceled, else the frame's own reason (`stop` when it names none).
 *
 * The `RUN_ERROR` message is the host's `failureMessage` sentence, never the daemon's own text: that
 * text (an exit code, a transport error, a path) is not something a site owner can act on, and it
 * is likewise replaced by that sentence in the `status` event an `error` frame produces (its code is kept).
 *
 * @returns the run's final status once a terminal frame has closed it — the caller stops reading
 *   further frames and ends the response — else `null`.
 */
function writeFrameOutcome(
  { frame, outcome, ctx, failureMessage }: { frame: { data: string }; outcome: RunFrameOutcome; ctx: AgUiFrameContext; failureMessage: string },
  _optional = {},
): "succeeded" | "failed" | "canceled" | null {
  writeFrameEvents({ outcome, ctx, failureMessage });
  return writeFrameTerminal({ frame, outcome, ctx, failureMessage });
}

/** Writes the frame's own translated events (its notices included), before any terminal mapping. */
function writeFrameEvents(
  { outcome, ctx, failureMessage }: { outcome: RunFrameOutcome; ctx: AgUiFrameContext; failureMessage: string },
  _optional = {},
): void {
  // An `error` frame (error, no terminal) yields one status event labeled with the daemon's own
  // message; the shared decoder keeps that for its other consumers, but the AG-UI wire carries the
  // host sentence there too (the error code survives).
  const daemonError = Boolean(outcome.error) && !outcome.terminal;
  for (const event of outcome.events) {
    const wireEvent = daemonError && event.kind === "status" ? { kind: "status" as const, label: failureMessage, ...(event.code ? { code: event.code } : {}) } : event;
    writeAllAgUiEvents({ write: ctx.write, events: translateAgentEventToAgUi({ event: wireEvent, state: ctx.state }) });
  }
}

/** Maps a terminal frame to its closing events and the run's final status; `null` (and nothing
 *  written) for a frame that neither errors nor ends the run. */
function writeFrameTerminal(
  { frame, outcome, ctx, failureMessage }: { frame: { data: string }; outcome: RunFrameOutcome; ctx: AgUiFrameContext; failureMessage: string },
  _optional = {},
): "succeeded" | "failed" | "canceled" | null {
  if (!outcome.error && !outcome.terminal) return null;
  writeAllAgUiEvents({ write: ctx.write, events: closeAgUiRun({ state: ctx.state }) });
  if (outcome.error) {
    ctx.write({ type: EventType.RUN_ERROR, message: failureMessage });
    return "failed";
  }
  const canceled = outcome.terminal === "canceled";
  const reason = canceled ? "cancelled" : readTerminalReason({ raw: frame.data, wrapped: true }) || "stop";
  ctx.write({ type: EventType.RUN_FINISHED, threadId: ctx.threadId, runId: ctx.runId, result: { reason } });
  return canceled ? "canceled" : "succeeded";
}

/** Drains one AG-UI run's daemon frames to completion, writing translated events directly to
 *  `ctx.res` and ending the response either on an explicit terminal frame, or as an
 *  interrupted failure when the stream closes without one or a read fails. Split out of `handleAgUiRun` so the try/catch and its loop don't add to that
 *  function's own branch count.
 *  @returns How the run ended, for its agent-run span: a terminal frame's own status (an `end` the
 *  daemon classified as failed or canceled is that, not `succeeded`); a close with no terminal
 *  frame is `failed` (no verdict arrived), like the `RUN_ERROR` it writes; a read error is `failed` with that error. */
export async function drainRunFramesToAgUi(
  ctx: AgUiFrameContext,
  { interruptionMessage = "The response was interrupted. Try again.", failureMessage = "The run failed. Try again." }:
    { interruptionMessage?: string; failureMessage?: string } = {},
): Promise<{ status: "succeeded" | "failed" | "canceled"; error?: unknown }> {
  // One carry per daemon connection, so the later chunks of a split echo line are dropped too.
  const carry: RunFrameCarry = {};
  try {
    for await (const frame of readSseFrames({ body: streamFromReader({ reader: ctx.reader }) })) {
      const outcome = translateRunFrame({ kind: frame.event, raw: frame.data, notices: ctx.notices }, { carry });
      if (frame.event === 'agent' && outcome.events.length > 0) {
        const marker = InterruptSchema.safeParse(JSON.parse(frame.data).payload.pendingApproval);
        if (marker.success) {
          writeAllAgUiEvents({ write: ctx.write, events: closeAgUiRun({ state: ctx.state }) });
          ctx.write(confirmationInterrupt({ threadId: ctx.threadId, runId: ctx.runId, interrupt: marker.data }));
          return { status: 'succeeded' };
        }
      }
      const status = writeFrameOutcome({ frame, outcome, ctx, failureMessage });
      if (status) {
        return { status };
      }
    }
    // The daemon always ends a run with an `end` or `error` frame, so a stream that simply closes
    // lost the verdict. Calling that "finished" would show a run that may have failed as a success.
    writeAllAgUiEvents({ write: ctx.write, events: closeAgUiRun({ state: ctx.state }) });
    ctx.write({ type: EventType.RUN_ERROR, message: interruptionMessage });
    return { status: "failed" };
  } catch (error) {
    writeAllAgUiEvents({ write: ctx.write, events: closeAgUiRun({ state: ctx.state }) });
    ctx.write({ type: EventType.RUN_ERROR, message: interruptionMessage });
    return { status: "failed", error };
  }
}

export function confirmationInterrupt({ threadId, runId, interrupt }: {
  threadId: string; runId: string; interrupt: Interrupt;
}, _optional: Record<string, never> = {}): Extract<AgUiEvent, { type: EventType.RUN_FINISHED }> {
  return { type: EventType.RUN_FINISHED, threadId, runId,
    outcome: { type: 'interrupt', interrupts: [{ ...interrupt, reason: 'confirmation' }] } };
}

export function readConfirmationResume({ input, threadId, runId, interruptId }: {
  input: unknown; threadId: string; runId: string; interruptId: string;
}, _optional: Record<string, never> = {}): { decision: 'allow' | 'deny' } | undefined {
  const entry = readOwnedResumeEntry({ input, threadId, runId, interruptId });
  return entry ? decodeResumeDecision({ entry }) : undefined;
}

type ResumeEntry = NonNullable<ReturnType<typeof RunAgentInputSchema.parse>['resume']>[number];

/** The one resume entry, only when the input continues the paused thread from the paused run and
 *  answers that run's interrupt; anything else (a foreign thread or parent, several answers) is not this pause's. */
function readOwnedResumeEntry({ input, threadId, runId, interruptId }: {
  input: unknown; threadId: string; runId: string; interruptId: string;
}, _optional: Record<string, never> = {}): ResumeEntry | undefined {
  const parsed = RunAgentInputSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const value = parsed.data;
  if (value.threadId !== threadId || value.parentRunId !== runId) return undefined;
  if (value.resume?.length !== 1) return undefined;
  const entry = value.resume[0]!;
  return entry.interruptId === interruptId ? entry : undefined;
}

/** A cancelled or dismissed answer is a denial; an unrecognized payload decides nothing. */
function decodeResumeDecision({ entry }: { entry: ResumeEntry }, _optional: Record<string, never> = {}): { decision: 'allow' | 'deny' } | undefined {
  if (entry.status === 'cancelled') return { decision: 'deny' };
  if (entry.payload === 'allow') return { decision: 'allow' };
  if (['deny', 'dismissed'].includes(entry.payload)) return { decision: 'deny' };
  return undefined;
}

export function createAgUiPauseStore({ caps, nowMs }: {
  caps: { global: number; perScope: number }; nowMs: () => number;
}, _optional: Record<string, never> = {}) {
  const records = new Map<string, {
    owner: string; threadId: string; runId: string; interruptId: string;
    state: unknown; scopeKey: string; abandonAtMs: number;
  }>();
  return {
    park(entry: Parameters<typeof records.set>[1], _optional: Record<string, never> = {}): boolean {
      const now = nowMs();
      let scoped = 0;
      for (const [id, record] of records) {
        if (record.abandonAtMs <= now) records.delete(id);
        else if (record.scopeKey === entry.scopeKey) scoped++;
      }
      if (entry.abandonAtMs <= now || records.has(entry.interruptId)) return false;
      if (records.size >= caps.global || scoped >= caps.perScope) return false;
      records.set(entry.interruptId, { ...entry });
      return true;
    },
    claim({ owner, threadId, runId, interruptId }: { owner: string; threadId: string; runId: string; interruptId: string }, _optional: Record<string, never> = {}) {
      const record = records.get(interruptId);
      if (!record) return undefined;
      if (record.abandonAtMs <= nowMs()) { records.delete(interruptId); return undefined; }
      if (record.owner !== owner || record.threadId !== threadId || record.runId !== runId) return undefined;
      records.delete(interruptId);
      return record;
    },
    remove({ interruptId }: { interruptId: string }, _optional: Record<string, never> = {}): boolean {
      return records.delete(interruptId);
    },
  };
}
