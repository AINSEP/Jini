/** Framework-free daemon frame reduction, shared by live and saved chat turns.
 * Preserve named frame vocabulary, terminal classifications, error-before-success precedence,
 * compaction and paragraph boundaries so live and persisted turns agree. Notice strings, custom
 * event names and excluded run-ID prefixes are explicit host inputs, never product wire defaults.
 * Authenticated routing, ownership, boot repair and storage transactions remain host responsibilities. */

import { assistantContentFromEvents } from "../assistant-content.js";
import { mergeAdjacentTextEvents } from "../compact-events.js";
import type { AgentEvent, ToolResultMediaBlock } from "../events.js";
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
export function asString({ value }: { value: unknown }): string {
  return wireString(value);
}

/** Keep only numeric usage fields; omit absent fields without changing JSON output. */
export function parseUsageEvent({ payload }: { payload: RunAgentPayload }): AgentEvent {
  const usage = (payload.usage ?? {}) as Record<string, unknown>;
  return {
    kind: "usage",
    ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
    ...(typeof payload.costUsd === "number" ? { costUsd: payload.costUsd } : {}),
    ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
  };
}

/** Reduce one daemon payload; preserve UI envelopes and drop duplicate input fragments. */
export function translateRunAgentPayload({ payload }: { payload: RunAgentPayload }): AgentEvent | null {
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

/** A host notice for a run that used its tool-step budget. */
export function terminalReasonNotice({ reason, notice }: { reason: string; notice: Extract<AgentEvent, { kind: "status" }> }): AgentEvent | null {
  return reason === "max_tool_turns" ? { ...notice } : null;
}

export interface TerminalOutcome {
  readonly status: "failed" | "canceled";
  readonly code: string;
  readonly signal: string;
  readonly resumable: string;
}

function neverStarted(outcome: TerminalOutcome): boolean {
  return outcome.status === "failed" && outcome.code === "none" && outcome.signal === "none" && outcome.resumable === "no";
}

/** Read non-successful daemon classification without throwing on malformed frames. */
export function readTerminalOutcome({ raw }: { raw: string | undefined }): TerminalOutcome | null {
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

/** A visible terminal classification rendered with host-supplied copy. */
export function terminalOutcomeNotice({ raw, notices }: { raw: string | undefined; notices: RunNotices }): AgentEvent | null {
  const outcome = readTerminalOutcome({ raw });
  if (!outcome) return null;
  if (neverStarted(outcome)) return { ...notices.neverStarted };
  return { kind: "status", label: outcome.status === "canceled" ? notices.canceledLabel : notices.failedLabel,
    detail: notices.terminalDetail({ outcome }) };
}

/** Report a failed run; operator cancellation is not a failure. */
export function terminalFailureError({ raw }: { raw: string | undefined }): Error | null {
  const outcome = readTerminalOutcome({ raw });
  if (!outcome || outcome.status !== "failed") return null;
  if (neverStarted(outcome)) return new Error("The run failed before the agent started.");
  return new Error(
    `The agent process exited without answering (exit code ${outcome.code}, signal ${outcome.signal}, resumable ${outcome.resumable}).`,
  );
}

/** Read a wrapped daemon or bare provider terminal reason, failing soft. */
export function readTerminalReason({ raw, wrapped }: { raw: string | undefined; wrapped: boolean }): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const source = wrapped ? ((parsed.payload ?? {}) as Record<string, unknown>) : parsed;
    return wireString(source.reason);
  } catch {
    return "";
  }
}

/** Parse the existing named SSE framing; bare keepalive frames return null. */
export function parseFrame({ rawFrame }: { rawFrame: string }): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return dataLines.length > 0 ? { event, data: dataLines.join("\n") } : null;
}

/** Decode the existing named SSE framing; cancellation always releases its reader. */
export async function* readSseFrames({ body }: { body: ReadableStream<Uint8Array> }): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { ended = true; break; }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame({ rawFrame });
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Identify runs held by the daemon using the host's excluded ID prefixes. */
export function isDaemonRunId({ runId, excludedPrefixes }: { runId: string; excludedPrefixes: readonly string[] }): boolean {
  return runId.length > 0 && !excludedPrefixes.some(prefix => runId.startsWith(prefix));
}

/** Copy the host's interruption notice into a saved turn. */
export function runInterruptedNotice({ notice }: { notice: Extract<AgentEvent, { kind: "status" }> }): AgentEvent {
  return { ...notice };
}

/** Use the same paragraph-boundary rule as a live chat turn. */
export function runContentFromEvents({ events }: { events: readonly AgentEvent[] }): string {
  return assistantContentFromEvents({ events });
}

/** Compact adjacent text/thinking deltas for durable storage. */
export function runEventsForSave({ events }: { events: readonly AgentEvent[] }): AgentEvent[] {
  return mergeAdjacentTextEvents({ events });
}

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

function retryData(line: Record<string, unknown>): Record<string, string | number> {
  const attempt = numberOf(line.attempt);
  const maxAttempts = numberOf(line.max_retries);
  return { ...(attempt !== undefined ? { attempt } : {}), ...(maxAttempts !== undefined ? { maxAttempts } : {}), service: "Claude" };
}

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

const ECHO_LINE = /^\{"type":"(?:stream_event|assistant|user)"/;

function chunkEvent(raw: string | undefined): AgentEvent[] {
  const frame = parseWire(raw);
  if (!frame) return [];
  const chunk = wireString((frame.payload as { chunk?: unknown } | null)?.chunk);
  const statuses: AgentEvent[] = [];
  let kept = "";
  let droppedAny = false;
  for (const piece of chunk.split(/(?<=\n)/)) {
    if (ECHO_LINE.test(piece.trimStart())) {
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

/** Fold one named daemon frame into events, a failure and an optional terminal status. */
export function translateRunFrame({ kind, raw, notices }: { kind: string; raw: string | undefined; notices: RunNotices }): RunFrameOutcome {
  switch (kind) {
    case "agent": {
      const frame = parseWire(raw);
      const translated = frame && isRecord(frame.payload) && typeof frame.payload.type === "string" ? translateRunAgentPayload({ payload: frame.payload as RunAgentPayload }) : null;
      return { events: translated ? [translated] : [] };
    }
    case "stdout":
    case "stderr":
      return { events: chunkEvent(raw) };
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
