/** Framework-free daemon frame reduction, shared by live and saved chat turns.
 * Preserve named frame vocabulary, terminal classifications, error-before-success precedence,
 * compaction and paragraph boundaries so live and persisted turns agree. Notice strings, custom
 * event names and excluded run-ID prefixes are explicit host inputs, never product wire defaults.
 * Authenticated routing, ownership, boot repair and storage transactions remain host responsibilities. */

import { decodeSseFrames, parseSseRecord, type DecodedSseFrame } from "@jini-ai/agent-runtime/providers/sse-decode";
import { assistantContentFromEvents } from "../assistant-content.js";
import { mergeAdjacentTextEvents } from "../compact-events.js";
import type { AgentEvent, ToolResultMediaBlock } from "../events.js";
/**
 * @file The ONE translation from an agent-daemon run stream to chat events, shared by the browser
 * and the server.
 *
 * Purpose:
 * A daemon run streams `@jini-ai/protocol` frames (`agent`/`stdout`/`stderr`/`error`/`end`). A saved
 * chat row stores chat-core `AgentEvent`s plus a text `content` and a `run_status`. Until 2026-09-27
 * the frame-to-event translation lived only in the admin SPA (`apps/admin/src/lib/assistant-transport.ts`),
 * so only a connected browser could turn a run into a saved answer: close the tab, or lose it to a
 * restart, and the row stayed `running` with no content forever (FINDING A,
 * `ADS-memory/reports/2026-09-27-stuck-chat-root-cause.md`).
 *
 * The server-side finalizer (`server/runtime/composition/modules/assistant-run-finalizer.ts`) now
 * saves the finished turn itself, and it must write exactly what the browser would have written. Two
 * copies of this switch would drift, so both import this file through the shared
 * `@jini-ai/chat/core/run-events` entry, with the host's bundler, test runner and TypeScript
 * resolving the same package contract.
 *
 * Architectural role:
 * PURE. No I/O, no DOM, no Node built-ins. The one value import is `@jini-ai/chat/core`'s content
 * rule, itself pure and React-free, so the saved `content` and the browser's can never differ.
 * `ReadableStream`/`TextDecoder` in {@link readSseFrames} are globals in both runtimes. Keep it that
 * way — the admin bundle imports it.
 */

import type { ChatRunStatus } from "../messages.js";

export interface RunAgentPayload {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface RunProtocolEventWire {
  readonly runId: string;
  readonly kind: "start" | "agent" | "stdout" | "stderr" | "error" | "end";
  readonly payload: unknown;
}

function wireString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
}

/** Display a wire scalar or JSON value using the existing empty-null convention. */
export function asString({ value }: { value: unknown }, _options: Record<string, never> = {}): string {
  return wireString(value);
}
/**
 * Parses a `"usage"` wire payload into its renderable `AgentEvent`.
 *
 * The one case in {@link translateRunAgentPayload}'s switch with real branching: four independent
 * optional fields, each `typeof`-checked before use (a malformed/missing field must not throw or
 * silently coerce to `0`/`NaN`). Pulled out (2026-08-06, complexity pass, sixth pass) so those four
 * ternaries are scored in their own scope instead of the switch's — this is the fix for the earlier
 * `@complexityExemption`'s cognitive attribution on `translateRunAgentPayload`, which credited the
 * `mcp-ui`/`a2ui` cases (each a one-line unwrap, zero branching — see their own comments below) for
 * a cost that actually came from here.
 */


/** Keep only numeric usage fields; omit absent fields without changing JSON output. */
export function parseUsageEvent({ payload }: { payload: RunAgentPayload }, _options: Record<string, never> = {}): AgentEvent {
  const usage = (payload.usage ?? {}) as Record<string, unknown>;
  return {
    kind: "usage",
    ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
    ...(typeof payload.costUsd === "number" ? { costUsd: payload.costUsd } : {}),
    ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
  };
}
/**
 * Reduces one wire-level `RunAgentPayload` into zero or one renderable `AgentEvent`s.
 *
 * Exported (a pure function, so directly testable with no `EventSource`/`fetch` stub needed — see
 * `assistant-transport.transcript.test.ts`'s own module doc for the same reasoning applied to
 * `runPrompt`) so `assistant-transport.a2ui.test.ts` can assert the `"a2ui"` branch below in
 * isolation.
 *
 * @complexityExemption (2026-08-06, complexity pass, sixth pass; bar is ≤9/≤9) **Score: 12
 * cyclomatic / 3 cognitive. Bar: ≤9 cyclomatic AND ≤9 cognitive. Cyclomatic-only exemption —
 * cognitive already clears the bar since {@link parseUsageEvent} above took the switch's only real
 * branching out of this function's own scope.** (An earlier version of this comment attributed the
 * cognitive cost to the `mcp-ui`/`a2ui` cases below; that was wrong — an independent audit measured
 * that extracting `parseUsageEvent` alone drops cognitive from 11 to 3, which only makes sense if
 * `usage` was the real source. `mcp-ui`/`a2ui` are one-line unwraps with zero branching, exactly as
 * their own comments already said.) Cyclomatic stays over by construction, not by accident: this is
 * a flat `switch` over `RunProtocolEventWire`'s closed `payload.type` vocabulary, one `case` per
 * wire type, and cyclomatic counts every `case` as a branch regardless of shape. Tried and rejected:
 * a `Record<string, (payload) => AgentEvent | null>` lookup table scores lower but loses two things
 * a switch over a TS discriminated union keeps — exhaustiveness checking (a lookup table compiles
 * with a missing key; this switch does not, once `payload.type` is narrowed to the real union rather
 * than the wire's untyped `string`), and the ability to attach a multi-paragraph comment to one case
 * explaining a specific interop bug (the `mcp-ui`/`a2ui` cases' comments each document why THAT case
 * cannot fall through to `default` — see below). A lookup table would have to carry those as a
 * parallel structure, one step removed from the code they explain. Left as a `switch`, documented
 * here rather than only in this session's report.
 */
// Typed media (currently just images) the daemon attached alongside the flattened `content`
// string — see `@jini-ai/protocol`'s `events.ts` doc on why the wire field is `unknown`
// rather than a checked type here: the real shape is validated where `ToolCard` renders it.
// Forwarded verbatim rather than re-validated a second time in this reducer — an
// `Array.isArray` guard rather than a deep shape check, since a malformed entry inside it
// is a rendering concern (`ToolCard`'s own `ToolResultMedia` already ignores anything that
// isn't a recognized block), not a transport one.
// An MCP content block the daemon withheld from the tool result because it is for the HUMAN,
// not the model (`@jini-ai/daemon`'s `delegated-tool-bridge.ts` → `tool-result-surfaces.ts`).
// Explicit rather than left to `default` below because the shapes do not line up: the default
// passes the WHOLE wire payload as `data`, but `@jini-ai/chat`'s `McpUiSurfaceCard` runs
// `parseUIResource` over each event's `data` and that requires the bare `EmbeddedResource`
// (`{type:'resource', resource:{uri,mimeType,text}}`). Handing it the envelope instead fails
// the `type !== 'resource'` check and renders an empty frame — a silent no-op, which is the
// worst possible failure for a confirmation dialog. Unwrapping here is what makes the two ends
// meet. `name` must stay `"mcp-ui"` to match `MCP_UI_EXT_EVENT_NAME`.
// A2UI's own agent->renderer envelope (`@jini-ai/core`'s `SurfaceEmission` with
// `channel: "a2ui"`, injected by `@jini-ai/daemon`'s `delegated-tool-bridge.ts` as
// `{type: "a2ui", message: <AgentToRendererMessage>}`). Unwrapped to the bare `.message` here,
// not left to the `default` branch below, for the same reason `mcp-ui` above is explicit:
// `@jini-ai/chat/react`'s `A2uiSurfaceCard` (registered against `'a2ui'` in
// `AssistantDock.tsx`) runs `extractSurfaceId`/`interpreter.applyAgentMessage` over each event's
// `data` directly, and both require a bare, spec-shaped envelope — not the `{type, message}`
// wire wrapper. Mirrors Jini's own reference host's identical `case "a2ui"` in
// `examples/reference-web/src/daemon-transport.ts`.
// thinking_start/stage_start/stage_end/surface_request/surface_response: no dedicated
// chat-core variant. Routed through the `ext` escape hatch rather than dropped, so a future
// renderer can opt in without a transport change.
// Streamed tool input (with `--include-partial-messages`): the finished `tool_use` carries the
// same input whole, and nothing renders the fragments. Kept, they became one no-op `ext` event
// per chunk in the saved row.


/** Reduce one daemon payload; preserve UI envelopes and drop duplicate input fragments. */
export function translateRunAgentPayload({ payload }: { payload: RunAgentPayload }, _options: Record<string, never> = {}): AgentEvent | null {
  switch (payload.type) {
    case "status":
      return { kind: "status", label: wireString(payload.label), ...(payload.detail ? { detail: wireString(payload.detail) } : {}) };
    case "text_delta":
      return { kind: "text", text: wireString(payload.delta) };
    case "thinking_delta":
      return { kind: "thinking", text: wireString(payload.delta) };
    case "tool_use":
      return { kind: "tool_use", id: wireString(payload.id), name: wireString(payload.name), input: payload.input };
    case "tool_result":
      return {
        kind: "tool_result",
        toolUseId: wireString(payload.toolUseId),
        content: wireString(payload.content),
        isError: Boolean(payload.isError),
        ...(Array.isArray(payload.media) ? { media: payload.media as readonly ToolResultMediaBlock[] } : {}),
      };
    case "usage":
      return parseUsageEvent({ payload });
    case "raw":
      return { kind: "raw", line: wireString(payload.line) };
    case "mcp-ui":
      return { kind: "ext", name: "mcp-ui", data: payload.resource };
    case "a2ui":
      return { kind: "ext", name: "a2ui", data: payload.message };
    case "thinking_start":
      return null;
    case "tool_input_delta":
      return null;
    default:
      return { kind: "ext", name: payload.type, data: payload };
  }
}

/** Host-supplied status messages; no host branding or log path defaults. */
export interface RunNotices {
  readonly toolStepLimit: Extract<AgentEvent, { kind: "status" }>;
  readonly interrupted: Extract<AgentEvent, { kind: "status" }>;
  readonly neverStarted: Extract<AgentEvent, { kind: "status" }>;
  readonly canceledLabel: string;
  readonly failedLabel: string;
  readonly terminalDetail: (args: { outcome: TerminalOutcome }) => string;
}
/**
 * Turns a terminal stream `reason` into the one renderable event a human needs to see, or `null`
 * when the reason speaks for itself.
 *
 * Only `max_tool_turns` qualifies today, and it qualifies for a specific reason: it is the one
 * terminal reason that is INDISTINGUISHABLE from success in the pane. `stop`/`end_turn` mean the
 * assistant finished; an `error` reason already renders as an error. A turn that hit the tool-step
 * ceiling just stops — mid-task, with whatever partial text it had, and nothing on screen saying
 * the work was cut short rather than completed. That is the failure this exists to close: the
 * server now reports the loop's real reason (`byok-provider-turn.ts`'s `normalizeTurnResult`
 * captures it instead of echoing the provider's last raw stop code), and until this, the browser
 * received that reason and dropped it.
 *
 * Rendered as a `status` event rather than an `error`, deliberately: nothing failed. The turn did
 * real work and stopped at a budget, and the useful next action is "ask it to continue", which is
 * what the detail says.
 */


/** A host notice for a run that used its tool-step budget. */
export function terminalReasonNotice({ reason, notice }: { reason: string; notice: Extract<AgentEvent, { kind: "status" }> }, _options: Record<string, never> = {}): AgentEvent | null {
  return reason === "max_tool_turns" ? { ...notice } : null;
}
/** A daemon `end` frame's non-successful terminal classification, as the daemon itself recorded it
 *  in `@jini-ai/protocol`'s `RunEndPayload`. */


export interface TerminalOutcome {
  readonly status: "failed" | "canceled";
  readonly code: string;
  readonly signal: string;
  readonly resumable: string;
}
/**
 * Reads that classification off a raw `end` frame, or `null` when the run succeeded, sent nothing,
 * or sent something unparseable.
 *
 * `code`/`signal`/`resumable` come back pre-rendered as display strings rather than as their wire
 * types, because both callers ({@link terminalOutcomeNotice} and {@link terminalFailureError}) want
 * the same human-facing rendering of an absent value (`"none"`/`"no"`) and neither does arithmetic
 * on them. Rendering once, here, is what stops the operator-facing notice and the persisted error
 * from describing the same dead run in two different ways.
 *
 * Every field is `typeof`-checked before use, and a malformed body returns `null` rather than
 * throwing: this runs inside an `EventSource` listener whose other job is to END the run, and a
 * throw there would strand the pane mid-turn over a cosmetic detail.
 */
/**
 * Whether a failed run never started a process: no exit code, no signal, not resumable. That is the
 * exact end the daemon's `failBeforeSpawn` and the host's own start refusals write, and a process
 * that did run always exits with a code or a signal.
 */


function neverStarted(outcome: TerminalOutcome): boolean {
  return outcome.status === "failed" && outcome.code === "none" && outcome.signal === "none" && outcome.resumable === "no";
}

/** Read non-successful daemon classification without throwing on malformed frames. */
export function readTerminalOutcome({ raw }: { raw: string | undefined }, _options: Record<string, never> = {}): TerminalOutcome | null {
  if (!raw) return null;
  let payload: Record<string, unknown>;
  try {
    const frame: unknown = JSON.parse(raw);
    if (!isRecord(frame) || !isRecord(frame.payload)) return null;
    payload = frame.payload;
  } catch {
    return null;
  }
  const status = payload.status;
  if (status !== "failed" && status !== "canceled") return null;
  return {
    status,
    code: typeof payload.code === "number" ? String(payload.code) : "none",
    signal: typeof payload.signal === "string" ? payload.signal : "none",
    resumable: payload.resumable === true ? "yes" : "no",
  };
}
/**
 * Turns a daemon `end` frame's terminal outcome into a visible `status` event when — and only when —
 * the run did NOT succeed.
 *
 * WHY THIS EXISTS (2026-09-06 chat-death investigation, `ADS-memory/reports/2026-09-06-chat-death-investigation.md`):
 * `@jini-ai/protocol`'s `RunEndPayload` carries `status`/`code`/`signal`/`resumable`, and
 * `@jini-ai/daemon`'s `finish()` is the ONLY event a terminal run emits — there is no separate
 * `error` frame for a failed run. {@link subscribeToRun}'s `end` listener read only `reason` (a
 * field `RunEndPayload` does not even have — it is BYOK-only), so a run the daemon had already
 * classified `failed` arrived here indistinguishable from a completed one, was reported through
 * `onDone`, and was persisted to `chat.db` as `run_status='succeeded'` with empty content. Two such
 * rows existed in the investigated host's `chat.db` — one `codex`, one `claude`, 578 ms and 552 ms — and they
 * are what "the chat just craps out with no error" actually looks like on disk.
 *
 * This is the SEEN half of that fix; {@link terminalFailureError} below is the WRITTEN-DOWN half
 * (2026-09-07, owner-approved). An earlier version of this comment said the persistence change was
 * deliberately NOT made and was out of scope until the owner signed off — that is no longer true,
 * and the two halves stayed separate functions only because they disagree on exactly one input:
 * `canceled` earns a notice but is not a failure.
 *
 * Returns `null` for a successful or absent status so a normal turn gains no extra event.
 */
// "exited without answering" would be false here: no process ever ran.


/** A visible terminal classification rendered with host-supplied copy. */
export function terminalOutcomeNotice({ raw, notices }: { raw: string | undefined; notices: RunNotices }, _options: Record<string, never> = {}): AgentEvent | null {
  const outcome = readTerminalOutcome({ raw });
  if (!outcome) return null;
  if (neverStarted(outcome)) return { ...notices.neverStarted };
  return { kind: "status", label: outcome.status === "canceled" ? notices.canceledLabel : notices.failedLabel,
    detail: notices.terminalDetail({ outcome }) };
}
/**
 * The reportable `Error` for a daemon `end` frame the daemon itself classified as `failed`, or
 * `null` for every other terminal outcome.
 *
 * WHY THIS EXISTS (2026-09-07, owner-approved): it is what makes a dead run RECOVERABLE FROM THE
 * DATABASE ALONE. Until now a failed run was reported only through `onDone`, so the durable record
 * said `run_status='succeeded'` with empty content: the live transcript was the ONLY place the
 * failure was visible, and once it was gone the row was indistinguishable from a successful turn
 * that happened to answer with nothing. That lie is why diagnosing chat deaths burned multiple
 * sessions and carried a wrong premise through two handoffs. `f682eff2` deliberately left it in
 * place ("a behavior change to what the product writes down... out of scope until the owner signs
 * off"); the owner has now signed off, and this is that change.
 *
 * NOTHING IN THIS FILE COMPUTES `runStatus`. Three pieces of `@jini-ai/chat` do, and the whole
 * effect of this function rests on all three:
 *   1. `useRunStream`'s `onError` sets the run's status to `'error'` — and its `onDone` is written
 *      as `prev.status === 'error' ? prev.status : 'done'`, so an `onDone` arriving AFTER this
 *      preserves the failure instead of overwriting it. That is what lets {@link subscribeToRun}
 *      report the failure and STILL settle the run through `finish()` with its collected events
 *      intact, rather than having to choose between the two. The call order in that listener is
 *      load-bearing, not incidental.
 *   2. `useConversation` maps run status `'error'` to `ChatMessage.runStatus: 'failed'`.
 *   3. `isTerminalRunStatus` already counts `'failed'` as terminal, so `assistant-chats.ts`'s
 *      `persistableMessages` KEEPS the message (it discards only still-streaming turns) and
 *      `AssistantDock/hooks/AssistantDock.hooks.tsx`'s `shouldPublishOnMessagesChange` still
 *      settles the dock. A failed run therefore cannot hang the pane waiting for a terminal state
 *      that never arrives — which is the failure this change would otherwise have traded the wrong
 *      record for.
 *
 * `canceled` is excluded on purpose: a run the operator stopped is not a failure, and
 * `useRunStream.cancel()` already stamps its own `'canceled'` status. Marking it `failed` would
 * swap one wrong record for another.
 *
 * Historical rows are NOT retrofitted. The investigated host's `chat.db` held 2 such rows on 2026-09-07 and
 * the pre-split `content.db` copy held 6; nothing distinguishes a genuinely empty
 * successful answer from a death after the fact, so a migration could only guess. Going-forward
 * correctness is the goal.
 */


/** Report a failed run; operator cancellation is not a failure. */
export function terminalFailureError({ raw }: { raw: string | undefined }, _options: Record<string, never> = {}): Error | null {
  const outcome = readTerminalOutcome({ raw });
  if (!outcome || outcome.status !== "failed") return null;
  if (neverStarted(outcome)) return new Error("The run failed before the agent started.");
  return new Error(
    `The agent process exited without answering (exit code ${outcome.code}, signal ${outcome.signal}, resumable ${outcome.resumable}).`,
  );
}
/** Reads a terminal frame's `reason` from either stream shape without letting a malformed or absent
 *  body prevent the turn from ending: the daemon path wraps it in a `RunProtocolEventWire.payload`,
 *  the BYOK path sends a bare `{reason}`, and `subscribeToRun`'s `end` event may carry no data at
 *  all. A notice is a nicety; finishing the run is not. */


/** Read a wrapped daemon or bare provider terminal reason, failing soft. */
export function readTerminalReason({ raw, wrapped }: { raw: string | undefined; wrapped: boolean }, _options: Record<string, never> = {}): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const source = wrapped ? ((parsed.payload ?? {}) as Record<string, unknown>) : parsed;
    return wireString(source.reason);
  } catch {
    return "";
  }
}

/** Preserve chat's per-line trimming and default event name; omit data-less keepalives. */
function chatFrame(frame: DecodedSseFrame): { event: string; data: string } | null {
  return frame.dataLines.length > 0
    ? { event: frame.event?.trim() ?? "message", data: frame.dataLines.map(line => line.trim()).join("\n") }
    : null;
}
/**
 * Parses one blank-line-delimited SSE frame's raw text into `{event, data}`, split out as its own
 * pure function so it is directly testable with a plain string, no `ReadableStream`/reader involved.
 *
 * Returns `null` for a frame with no `data:` lines — {@link readSseFrames} skips yielding those
 * (a bare `event: ping` keepalive, for example, or a frame carrying only an `id:` field).
 */


/** Parse the existing named SSE framing; bare keepalive frames return null. */
export function parseFrame({ rawFrame }: { rawFrame: string }, _options: Record<string, never> = {}): { event: string; data: string } | null {
  return chatFrame(parseSseRecord({ rawFrame }));
}
/**
 * Splits a `text/event-stream` response body into `{event, data}` frames. Frames are
 * blank-line-delimited per the SSE spec; per-frame field parsing lives in {@link parseFrame} above.
 *
 * @complexity O(n) in response body bytes; O(1) additional buffering per chunk beyond the
 * not-yet-terminated tail of the current frame.
 * @overallScore 100
 */


/** Decode complete named frames; cancellation always releases its reader. Inherits shared framing costs. */
export async function* readSseFrames({ body }: { body: ReadableStream<Uint8Array> }, _options: Record<string, never> = {}): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  let ended = false;
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { ended = true; return; }
      yield value;
    }
  }
  try {
    for await (const decoded of decodeSseFrames({ source: chunks() }, { flushFinalFrame: false })) {
      const frame = chatFrame(decoded);
      if (frame) yield frame;
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
/**
 * Whether the agent daemon holds this run, so its event stream can be read at
 * `/api/runs/:id/events`. A BYOK or AG-UI run id names a turn that lived on one browser request, and
 * there is nothing server-side to watch.
 */


/** Identify runs held by the daemon using the host's excluded ID prefixes. */
export function isDaemonRunId({ runId, excludedPrefixes }: { runId: string; excludedPrefixes: readonly string[] }, _options: Record<string, never> = {}): boolean {
  return runId.length > 0 && !excludedPrefixes.some(prefix => runId.startsWith(prefix));
}

/** Copy the host's interruption notice into a saved turn. */
export function runInterruptedNotice({ notice }: { notice: Extract<AgentEvent, { kind: "status" }> }, _options: Record<string, never> = {}): AgentEvent {
  return { ...notice };
}
/**
 * A chat message's `content` for a list of events: `@jini-ai/chat`'s own rule
 * (`assistantContentFromEvents`, also what `useConversation` uses for a live turn), so a row the
 * server finalizes reads the same as one the browser saved. That rule puts a paragraph break where a
 * tool call or card sat between two text runs, so a working note is never glued onto the answer.
 */


/** Use the same paragraph-boundary rule as a live chat turn. */
export function runContentFromEvents({ events }: { events: readonly AgentEvent[] }, _options: Record<string, never> = {}): string {
  return assistantContentFromEvents({ events });
}
/**
 * The events to SAVE for a turn: streamed `text`/`thinking` deltas joined into one event per run
 * (`@jini-ai/chat`'s `mergeAdjacentTextEvents`). Live, one event per few tokens is what streams words
 * onto the screen; saved, it only repeats the event wrapper per token. Used by every saver (the server
 * finalizer and the chat PUT route the browser saves through), so both write the same shape.
 */


/** Compact adjacent text/thinking deltas for durable storage. */
export function runEventsForSave({ events }: { events: readonly AgentEvent[] }, _options: Record<string, never> = {}): AgentEvent[] {
  return mergeAdjacentTextEvents({ events });
}
/** What one daemon stream frame means for the turn: events to append, a failure, and whether it ended. */
/** Set when the frame reports a failure. Once any frame has, the turn is `failed` (the browser's
   *  `useRunStream` keeps an `'error'` status through a later `onDone`). */
/** Set only on the `end` frame: the daemon's own terminal classification. */


export interface RunFrameOutcome {
  readonly events: AgentEvent[];

  readonly error?: Error;

  readonly terminal?: Extract<ChatRunStatus, "succeeded" | "failed" | "canceled">;
}

function parseWire(raw: string | undefined): RunProtocolEventWire | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed as unknown as RunProtocolEventWire : null;
  } catch {
    return null;
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
/** `{attempt, maxAttempts}` from an `api_retry` line, keeping only the fields it actually carries. */
// `api_retry` is Claude Code's own line shape, so the service it names is Claude.


function retryData(line: Record<string, unknown>): Record<string, string | number> {
  const attempt = numberOf(line.attempt);
  const maxAttempts = numberOf(line.max_retries);
  return { ...(attempt !== undefined ? { attempt } : {}), ...(maxAttempts !== undefined ? { maxAttempts } : {}), service: "Claude" };
}
/**
 * Claude Code's stdout heartbeats → typed `status` events for the live activity line
 * (`@jini-ai/chat`'s `run-activity.ts` reads `code`/`data`). `null` for any other line.
 */


function heartbeatStatus(line: Record<string, unknown>): AgentEvent | null {
  if (line.type === "tool_progress") {
    const elapsedSeconds = numberOf(line.elapsed_time_seconds);
    return { kind: "status", code: "tool_progress", label: "tool_progress", ...(elapsedSeconds !== undefined ? { data: { elapsedSeconds } } : {}) };
  }
  if (line.type !== "system") return null;
  if (line.subtype === "api_retry") {
    const detail = [numberOf(line.error_status), typeof line.error === "string" ? line.error : undefined].filter((p) => p !== undefined).join(" ");
    return { kind: "status", code: "api_retry", label: "api_retry", ...(detail ? { detail } : {}), data: retryData(line) };
  }
  if (line.subtype === "thinking_tokens") return { kind: "status", code: "thinking", label: "thinking" };
  return null;
}
/**
 * Lines the daemon has already parsed into typed events, so keeping them as `raw` only stores them
 * twice: `stream_event` (the token-by-token echo `--include-partial-messages` adds → `text`), and the
 * whole `assistant`/`user` messages (→ `text`/`thinking`/`tool_use`/`tool_result`). The `user` echo
 * repeats every tool result: one "summarize my posts" turn saved 129 KB of them. Matched on the
 * line's start, not a parse, because a long line arrives split over several stdout chunks and its
 * first piece is not valid JSON on its own. Claude Code writes `type` first on every line.
 */


const ECHO_LINE = /^\{"type":"(?:stream_event|assistant|user)"/;
/**
 * Per-connection memory for {@link translateRunFrame}: which channels are mid-way through an echo
 * line. Only a line's first chunk carries the {@link ECHO_LINE} prefix, so without it the rest of a
 * split `user` echo stays as `raw` — tool-result prose that durable recovery then reads as executor
 * diagnostics. Pass one fresh `{}` per daemon connection (each connection replays from event 0).
 */
export interface RunFrameCarry {
  openEchoChannels?: Set<string>;
}
/**
 * One CLI stdout/stderr chunk → events. Every JSON line that is a heartbeat also yields a typed
 * `status` event; echo lines ({@link ECHO_LINE}) are dropped — with a `carry`, including the later
 * chunks of a split one; everything else stays in ONE `raw` event, verbatim. A chunk with no JSON
 * lines at all (a plain-format CLI) is one `raw` event, as before.
 */


function chunkEvent(raw: string | undefined, channel: string, carry?: RunFrameCarry): AgentEvent[] {
  const frame = parseWire(raw);
  if (!frame) return [];
  const chunk = wireString((frame.payload as { chunk?: unknown } | null)?.chunk);
  const open = carry ? (carry.openEchoChannels ??= new Set()) : undefined;
  const statuses: AgentEvent[] = [];
  let kept = "";
  let droppedAny = false;
  let first = true;
  for (const piece of chunk.split(/(?<=\n)/)) {
    // Only a chunk's first piece can continue the previous chunk's line; splitting on "\n" starts
    // every later piece on a fresh line. Channels are tracked apart: stderr can interleave mid-line.
    const echo = (first && open?.has(channel) === true) || ECHO_LINE.test(piece.trimStart());
    first = false;
    if (echo && !piece.endsWith("\n")) open?.add(channel);
    else open?.delete(channel);
    if (echo) {
      droppedAny = true;
      continue;
    }
    const line = parseJsonLine(piece.trim());
    const status = line ? heartbeatStatus(line) : null;
    if (status) statuses.push(status);
    kept += piece;
  }
  if (!droppedAny) kept = chunk;
  return kept.length > 0 ? [{ kind: "raw", line: kept }, ...statuses] : statuses;
}
// Order matters and matches the browser's `end` listener: the `max_tool_turns` notice first, then
// the failed/canceled notice, then the failure itself.


function endOutcome(raw: string | undefined, notices: RunNotices): RunFrameOutcome {
  const events: AgentEvent[] = [];
  const reasonNotice = terminalReasonNotice({ reason: readTerminalReason({ raw, wrapped: true }), notice: notices.toolStepLimit });
  if (reasonNotice) events.push(reasonNotice);
  const outcomeNotice = terminalOutcomeNotice({ raw, notices });
  if (outcomeNotice) events.push(outcomeNotice);
  const error = terminalFailureError({ raw });
  const outcome = readTerminalOutcome({ raw });
  const terminal = outcome?.status ?? "succeeded";
  return error ? { events, error, terminal } : { events, terminal };
}
/**
 * Translates one named daemon SSE frame (`event:` name plus raw `data:` text) into its effect on the
 * turn. The browser's `subscribeToRun` dispatches the result to `RunHandlers`; the server finalizer
 * folds it into the row it saves. Never throws: a malformed frame yields no events rather than
 * stranding either reader mid-turn.
 *
 * An `error` frame with no data is a connection error, not a run error — the browser's
 * `EventSource` reports those on the same event name, so it must check for data before calling this.
 *
 * @complexity O(size of the frame).
 */
// The agent CLI's own output. `stderr` is where a dying CLI says WHY it is dying.
// Shown AND saved as a status line, not only reported: the error is live-only state, so without
// the event the saved turn (and a reload) showed a bare "failed" with the reason lost. This is
// where the daemon's plain pre-spawn reason ("The assistant could not start: ...") and the
// host's start refusals reach the user.


/** Fold one named daemon frame into events, a failure and an optional terminal status. */
export function translateRunFrame({ kind, raw, notices }: { kind: string; raw: string | undefined; notices: RunNotices }, { carry }: { carry?: RunFrameCarry } = {}): RunFrameOutcome {
  switch (kind) {
    case "agent": {
      const frame = parseWire(raw);
      const translated = frame && isRecord(frame.payload) && typeof frame.payload.type === "string" ? translateRunAgentPayload({ payload: frame.payload as RunAgentPayload }) : null;
      return { events: translated ? [translated] : [] };
    }
    case "stdout":
    case "stderr":
      return { events: chunkEvent(raw, kind, carry) };
    case "error": {
      const frame = parseWire(raw);
      const message = wireString((frame?.payload as { message?: unknown } | null)?.message) || "agent run failed";
      return { events: [{ kind: "status", label: message }], error: new Error(message) };
    }
    case "end":
      return endOutcome(raw, notices);
    default:
      return { events: [] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
