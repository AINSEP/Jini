/**
 * @module ai-trace/recorder
 *
 * Turns the normalized agent-event stream into {@link AiTraceEvent}s. Every provider path in the
 * runtime already converges on one vocabulary before the daemon sees it — `status` (model),
 * `text_delta`, `thinking_delta`, `tool_use`, `tool_result`, `usage`, `turn_end`, `error`, `end`
 * — emitted by `claude-stream`, `qoder-stream`, `json-event-stream` (Codex,
 * OpenCode, Cursor, Kimi), the ACP session (Gemini/Codex/Hermes over ACP) and
 * `runProviderToolTurn` (OpenAI/Anthropic/Azure/Google HTTP). Tapping that one vocabulary is
 * what makes tracing provider-agnostic: no per-vendor code lives here.
 *
 * A model turn follows explicit request boundaries (`status: requesting`, `end`) when the stream has them;
 * otherwise each usage report closes one turn (CLI per-step or per-run usage).
 * Within a request, usage reports are snapshots, not boundaries: a final frame can contain usage AND more text.
 * HTTP tool-turn produces one turn per call; CLIs that report once per run (Claude Code `result`) produce one turn per run with all its tool calls — the granularity the provider gave,
 * not a guess.
 */
import { captureText, stringifyForCapture, type CaptureTextOptions } from './capture.js';
import { classifyToolError } from './classify.js';
import { addNullable, normalizeAiUsage } from './usage.js';
import { reportError } from './sinks.js';
import type { AiContentCapture, AiCostSource, AiRunOutcome, AiTokenUsage, AiTraceEvent, AiTraceSink } from './types.js';

type AgentEvent = Record<string, unknown>;

interface OpenTurn {
  toolCallCount: number;
  readonly id: string;
  readonly index: number;
  readonly startedAt: number;
  // Text is only kept in `full` capture; other modes keep counts so a long run holds no transcript.
  output: string;
  outputChars: number;
  reasoning: string;
  reasoningChars: number;
  firstTokenAt: number | null;
  ttftMs: number | null;
  stopReason: string | null;
  error: string | null;
  errorCode: string | null;
  usage: AiTokenUsage | null;
  reportedCost: number | null;
}

interface PendingTool {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly startedAt: number;
  readonly turnId: string;
}

interface Totals {
  turns: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface AiTraceRecorderOptions {
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly sessionId?: string | null;
  readonly traceId?: string;
  readonly tags?: readonly string[];
  readonly capture?: AiContentCapture;
  readonly exactSecrets?: CaptureTextOptions['exactSecrets'];
  readonly maxCapturedChars?: number;
  readonly now?: () => number;
  /** Optional host price table; only consulted when the provider reported no cost. */
  readonly priceUsage?: (args: { model: string | null; usage: AiTokenUsage }) => number | null;
  /** A failing backend must never fail the run; the host decides whether to log it. */
  readonly onSinkError?: (error: unknown) => void;
}

export interface AiTraceRecorder {
  readonly traceId: string;
  start(args: { input?: string | null }): void;
  /** Supplies the prompt after `start` (hosts that learn it late); it rides the first model turn. */
  noteInput(args: { input: string }): void;
  observe(event: AgentEvent): void;
  finish(required: { outcome: AiRunOutcome }, optional?: { error?: { message: string; code?: string | null } | null }): void;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Mutable state of one recorded run, shared by the helpers below. */
interface RecorderCtx {
  sink: AiTraceSink;
  runId: string;
  agentId: string;
  options: AiTraceRecorderOptions;
  now: () => number;
  traceId: string;
  captureOptions: { mode: NonNullable<AiTraceRecorderOptions['capture']>; maxChars: AiTraceRecorderOptions['maxCapturedChars']; exactSecrets: AiTraceRecorderOptions['exactSecrets'] };
  keepText: boolean;
  pending: Map<string, PendingTool[]>;
  seenTools: Set<string>;
  totals: Totals;
  model: string | null;
  turn: OpenTurn | null;
  lastBoundary: number;
  runInput: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  // Set by the first `status: requesting`; streams without request boundaries keep usage-closes-turn.
  requestBounded: boolean;
  started: boolean;
  finished: boolean;
}

type RunError = { message: string; code?: string | null } | null;

function capture({ c, text }: { c: RecorderCtx; text: string | null | undefined }) {
  return captureText({ text }, c.captureOptions);
}

/** Streamed text: `full` redacts the kept text; other modes report the count without having kept it. */
function captureStreamed({ c, text, chars }: { c: RecorderCtx; text: string; chars: number }) {
  if (chars === 0 || c.captureOptions.mode === 'off') return null;
  return c.keepText ? capture({ c, text }) : { chars };
}

function record(c: RecorderCtx, event: AiTraceEvent): void {
  try {
    c.sink.record(event);
  } catch (error) {
    reportError({ error, onError: c.options.onSinkError });
  }
}

function startRun(c: RecorderCtx, { input = null }: { input?: string | null }): void {
  if (c.started) return;
  c.started = true;
  c.runInput = input;
  c.lastBoundary = c.now();
  const { options } = c;
  record(c, { kind: 'run_started', traceId: c.traceId, runId: c.runId, at: c.lastBoundary, agentId: c.agentId, provider: options.provider ?? null, model: c.model, sessionId: options.sessionId ?? null, input: capture({ c, text: input }), tags: options.tags ?? [] });
}

function noteRunInput(c: RecorderCtx, { input }: { input: string }): void {
  if (c.totals.turns === 0) c.runInput = input;
}

function ensureTurn(c: RecorderCtx): OpenTurn {
  if (!c.started) startRun(c, {});
  c.turn ??= { toolCallCount: 0, id: `${c.traceId}:turn:${c.totals.turns}`, index: c.totals.turns, startedAt: c.lastBoundary, output: '', outputChars: 0, reasoning: '', reasoningChars: 0, firstTokenAt: null, ttftMs: null, stopReason: null, error: null, errorCode: null, usage: null, reportedCost: null };
  return c.turn;
}

function resolveCost(c: RecorderCtx, { usage, reported }: { usage: AiTokenUsage | null; reported: unknown }): { costUsd: number | null; costSource: AiCostSource | null } {
  const provided = num(reported);
  if (provided !== null) return { costUsd: provided, costSource: 'provider' };
  let estimated: number | null = null;
  try {
    estimated = usage && c.options.priceUsage ? num(c.options.priceUsage({ model: c.model, usage })) : null;
  } catch (error) {
    reportError({ error, onError: c.options.onSinkError });
  }
  return estimated === null ? { costUsd: null, costSource: null } : { costUsd: estimated, costSource: 'estimated' };
}

function addToTotals({ c, usage, costUsd }: {
  c: RecorderCtx;
  usage: AiTokenUsage | null;
  costUsd: number | null;
}): void {
  const { totals } = c;
  totals.turns += 1;
  totals.inputTokens = addNullable({ a: totals.inputTokens, b: usage?.inputTokens ?? null });
  totals.outputTokens = addNullable({ a: totals.outputTokens, b: usage?.outputTokens ?? null });
  totals.costUsd = addNullable({ a: totals.costUsd, b: costUsd });
}

function ttftOf(open: OpenTurn): number | null {
  if (open.ttftMs !== null) return open.ttftMs;
  return open.firstTokenAt === null ? null : open.firstTokenAt - open.startedAt;
}

/** Snapshots replace reported fields and retain omitted counters; they are never summed within a request. */
function updateUsage(c: RecorderCtx, { event }: { event: AgentEvent }): void {
  const open = ensureTurn(c);
  const usage = normalizeAiUsage({ usage: event.usage });
  if (usage) {
    const merged = { ...usage };
    for (const key of Object.keys(merged) as Array<keyof AiTokenUsage>) merged[key] ??= open.usage?.[key] ?? null;
    open.usage = merged;
  }
  open.reportedCost = num(event.costUsd) ?? open.reportedCost;
  open.stopReason = str(event.stopReason) ?? open.stopReason;
}

/** Codes are bounded labels, never arbitrary error prose or a redacted credential. */
function safeCode(c: RecorderCtx, { code }: { code: string | null }): string | null {
  if (!code) return null;
  const captured = captureText({ text: code }, { ...c.captureOptions, mode: 'full', maxChars: 64 });
  if (captured?.redactions || captured?.truncated) return null;
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(code) ? code : null;
}

function closeTurn(c: RecorderCtx): void {
  if (!c.turn) return;
  const open = c.turn;
  const endedAt = c.now();
  const usage = open.usage;
  const { costUsd, costSource } = resolveCost(c, { usage, reported: open.reportedCost });
  const errorContent = capture({ c, text: open.error });
  record(c, { kind: 'model_turn', traceId: c.traceId, turnId: open.id, toolCallCount: open.toolCallCount, index: open.index, startedAt: open.startedAt, endedAt, model: c.model, input: open.index === 0 ? capture({ c, text: c.runInput }) : null, output: captureStreamed({ c, text: open.output, chars: open.outputChars }), reasoning: captureStreamed({ c, text: open.reasoning, chars: open.reasoningChars }), usage, costUsd, costSource, ttftMs: ttftOf(open), stopReason: open.stopReason, error: open.error === null ? null : errorContent?.text ?? 'model_error', errorContent, errorCode: safeCode(c, { code: open.errorCode }) });
  addToTotals({ c, usage, costUsd });
  c.turn = null;
  c.lastBoundary = endedAt;
}

function emitTool(c: RecorderCtx, { tool, result }: { tool: PendingTool; result: { content: string | null; isError: boolean; endedAt: number | null } }): void {
  const errorClass = result.isError ? classifyToolError({ content: result.content ?? '' }) : null;
  c.totals.toolCalls += 1;
  if (result.isError) c.totals.toolErrors += 1;
  record(c, { kind: 'tool_call', traceId: c.traceId, toolCallId: tool.id, turnId: tool.turnId, name: tool.name, input: capture({ c, text: stringifyForCapture({ value: tool.input }) }), output: capture({ c, text: result.content }), isError: result.isError, errorClass, startedAt: tool.startedAt, endedAt: result.endedAt });
}

function onStatus(c: RecorderCtx, event: AgentEvent): void {
  if (event.label === 'requesting') {
    c.requestBounded = true;
    closeTurn(c);
    // Every HTTP request already emits this status, including tool-only follow-up requests.
    // Its turn (opened lazily by the first event) stays open through usage and delayed
    // tool_use emission until the next boundary.
    c.lastBoundary = c.now();
  }
  c.model = str(event.model) ?? c.model;
  const ttft = num(event.ttftMs);
  if (ttft !== null) ensureTurn(c).ttftMs = ttft;
}

function onTextDelta(c: RecorderCtx, event: AgentEvent): void {
  const open = ensureTurn(c);
  const delta = typeof event.delta === 'string' ? event.delta : '';
  open.outputChars += delta.length;
  if (c.keepText) open.output += delta;
  open.firstTokenAt ??= c.now();
}

function onThinkingDelta(c: RecorderCtx, event: AgentEvent): void {
  const open = ensureTurn(c);
  const delta = typeof event.delta === 'string' ? event.delta : '';
  open.reasoningChars += delta.length;
  if (c.keepText) open.reasoning += delta;
}

function onToolUse(c: RecorderCtx, event: AgentEvent): void {
  const id = str(event.id);
  if (!id) return;
  const turnId = ensureTurn(c).id;
  const scopedId = `${turnId}:tool:${id}`;
  if (c.seenTools.has(scopedId)) return;
  c.seenTools.add(scopedId);
  ensureTurn(c).toolCallCount += 1;
  // HTTP adapters report usage while streaming and emit tool_use only after the stream ends,
  // so usage leaves this request open until its delayed calls have been attributed.
  const tools = c.pending.get(id) ?? [];
  tools.push({ id: scopedId, name: str(event.name) ?? 'unknown', input: event.input, startedAt: c.now(), turnId });
  c.pending.set(id, tools);
}

function onToolResult(c: RecorderCtx, event: AgentEvent): void {
  const id = str(event.toolUseId) ?? 'unknown';
  const tools = c.pending.get(id);
  const tool = tools?.shift() ?? { id: `${ensureTurn(c).id}:tool:${id}`, name: 'unknown', input: null, startedAt: c.now(), turnId: ensureTurn(c).id };
  if (!tools?.length) c.pending.delete(id);
  emitTool(c, { tool, result: { content: typeof event.content === 'string' ? event.content : null, isError: event.isError === true, endedAt: c.now() } });
}

// CLI streams (OpenCode step_finish, pi-rpc turn_end, ...) report per-step usage with no request
// boundary: each report still closes its own turn so totals sum steps instead of keeping the last.
function onUsage(c: RecorderCtx, event: AgentEvent): void {
  updateUsage(c, { event });
  if (!c.requestBounded) closeTurn(c);
}

// Boundaries close only existing work: opening a turn for a final stop signal would record
// an empty phantom model call. CLI turn_end is a control signal; usage may follow it.
function onTurnEnd(c: RecorderCtx, event: AgentEvent): void {
  if (c.turn) c.turn.stopReason = str(event.stopReason);
}

function onEnd(c: RecorderCtx, event: AgentEvent): void {
  if (c.turn) c.turn.stopReason ??= str(event.reason);
  closeTurn(c);
}

function onError(c: RecorderCtx, event: AgentEvent): void {
  c.lastError = str(event.message) ?? 'error';
  c.lastErrorCode = str(event.code);
  const open = ensureTurn(c);
  open.error = c.lastError;
  open.errorCode = c.lastErrorCode;
}

const eventHandlers: Readonly<Record<string, (c: RecorderCtx, event: AgentEvent) => void>> = {
  status: onStatus,
  text_delta: onTextDelta,
  thinking_delta: onThinkingDelta,
  tool_use: onToolUse,
  tool_result: onToolResult,
  usage: onUsage,
  turn_end: onTurnEnd,
  end: onEnd,
  error: onError,
};

function observeEvent(c: RecorderCtx, event: AgentEvent): void {
  if (c.finished) return;
  eventHandlers[String(event.type)]?.(c, event);
}

/** Tools still pending when the run ends are reported with `endedAt: null`, never dropped. */
function flushOpenWork(c: RecorderCtx): void {
  if (c.turn) closeTurn(c);
  for (const tools of c.pending.values()) {
    for (const tool of tools) emitTool(c, { tool, result: { content: null, isError: false, endedAt: null } });
  }
  c.pending.clear();
}

function runError(c: RecorderCtx, { outcome, error }: { outcome: AiRunOutcome; error: RunError }): Extract<AiTraceEvent, { kind: 'run_finished' }>['error'] {
  const message = error?.message ?? (outcome === 'failed' ? c.lastError : null);
  if (!message) return null;
  const content = capture({ c, text: message });
  return { message: content?.text ?? 'run_error', code: safeCode(c, { code: error?.code ?? c.lastErrorCode }), content };
}

function finishRun({ c, outcome }: { c: RecorderCtx; outcome: AiRunOutcome }, { error = null }: { error?: RunError } = {}): void {
  if (c.finished) return;
  if (!c.started) startRun(c, {});
  flushOpenWork(c);
  c.finished = true;
  record(c, { kind: 'run_finished', traceId: c.traceId, at: c.now(), outcome, error: runError(c, { outcome, error }), totals: { ...c.totals } });
}

function createRecorderCtx(
  { sink, runId, agentId }: { sink: AiTraceSink; runId: string; agentId: string },
  options: AiTraceRecorderOptions,
): RecorderCtx {
  const now = options.now ?? Date.now;
  const mode = options.capture ?? sink.capture ?? 'metadata';
  return {
    sink, runId, agentId, options, now,
    traceId: options.traceId ?? runId,
    captureOptions: { mode, maxChars: options.maxCapturedChars, exactSecrets: options.exactSecrets },
    keepText: mode === 'full',
    pending: new Map<string, PendingTool[]>(),
    seenTools: new Set<string>(),
    totals: { turns: 0, toolCalls: 0, toolErrors: 0, inputTokens: null, outputTokens: null, costUsd: null },
    model: options.model ?? null,
    turn: null,
    lastBoundary: now(),
    runInput: null,
    lastError: null,
    lastErrorCode: null,
    requestBounded: false,
    started: false,
    finished: false,
  };
}

export function createAiTraceRecorder(
  { sink, runId, agentId }: { sink: AiTraceSink; runId: string; agentId: string },
  options: AiTraceRecorderOptions = {},
): AiTraceRecorder {
  const c = createRecorderCtx({ sink, runId, agentId }, options);
  return {
    traceId: c.traceId,
    start: (args) => startRun(c, args),
    noteInput: (args) => noteRunInput(c, args),
    observe: (event) => observeEvent(c, event),
    finish: (outcome, extra) => finishRun({ c, ...outcome }, extra),
  };
}
