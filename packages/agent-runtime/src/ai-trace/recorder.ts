/**
 * @module ai-trace/recorder
 *
 * Turns the normalized agent-event stream into {@link AiTraceEvent}s. Every provider path in the
 * runtime already converges on one vocabulary before the daemon sees it — `status` (model),
 * `text_delta`, `thinking_delta`, `tool_use`, `tool_result`, `usage`, `turn_end`, `error`, `end`
 * — emitted by `claude-stream`, `copilot-stream`, `qoder-stream`, `json-event-stream` (Codex,
 * OpenCode, Cursor, Kimi), the ACP session (Gemini/Codex/Hermes over ACP) and
 * `runProviderToolTurn` (OpenAI/Anthropic/Azure/Google HTTP). Tapping that one vocabulary is
 * what makes tracing provider-agnostic: no per-vendor code lives here.
 *
 * A model turn is one usage-report window. Providers that report usage per model call (HTTP
 * tool-turn) produce one turn per call; CLIs that report once per run (Claude Code `result`,
 * Copilot) produce one turn per run with all its tool calls — the granularity the provider gave,
 * not a guess.
 */
import { captureText, stringifyForCapture, type CaptureTextOptions } from './capture.js';
import { classifyToolError } from './classify.js';
import { addNullable, normalizeAiUsage } from './usage.js';
import type { AiContentCapture, AiCostSource, AiRunOutcome, AiTokenUsage, AiTraceEvent, AiTraceSink } from './types.js';

type AgentEvent = Record<string, unknown>;

interface OpenTurn {
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
}

interface PendingTool {
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

export function createAiTraceRecorder(
  { sink, runId, agentId }: { sink: AiTraceSink; runId: string; agentId: string },
  options: AiTraceRecorderOptions = {},
): AiTraceRecorder {
  const now = options.now ?? Date.now;
  const traceId = options.traceId ?? runId;
  const captureOptions = { mode: options.capture ?? 'metadata', maxChars: options.maxCapturedChars, exactSecrets: options.exactSecrets };
  const capture = (text: string | null | undefined) => captureText({ text }, captureOptions);
  const keepText = captureOptions.mode === 'full';
  /** Streamed text: `full` redacts the kept text; other modes report the count without having kept it. */
  const captureStreamed = (text: string, chars: number) => {
    if (chars === 0 || captureOptions.mode === 'off') return null;
    return keepText ? capture(text) : { chars };
  };
  const pending = new Map<string, PendingTool>();
  const seenTools = new Set<string>();
  const totals: Totals = { turns: 0, toolCalls: 0, toolErrors: 0, inputTokens: null, outputTokens: null, costUsd: null };
  let model = options.model ?? null;
  let turn: OpenTurn | null = null;
  let lastClosedTurnId: string | null = null;
  let lastBoundary = now();
  let runInput: string | null = null;
  let lastError: string | null = null;
  let started = false;
  let finished = false;

  function record(event: AiTraceEvent): void {
    try {
      sink.record(event);
    } catch (error) {
      options.onSinkError?.(error);
    }
  }

  function start({ input = null }: { input?: string | null }): void {
    if (started) return;
    started = true;
    runInput = input;
    lastBoundary = now();
    record({ kind: 'run_started', traceId, runId, at: lastBoundary, agentId, provider: options.provider ?? null, model, sessionId: options.sessionId ?? null, input: capture(input), tags: options.tags ?? [] });
  }

  function noteInput({ input }: { input: string }): void {
    if (totals.turns === 0) runInput = input;
  }

  function ensureTurn(): OpenTurn {
    if (!started) start({});
    turn ??= { id: `${traceId}:turn:${totals.turns}`, index: totals.turns, startedAt: lastBoundary, output: '', outputChars: 0, reasoning: '', reasoningChars: 0, firstTokenAt: null, ttftMs: null, stopReason: null, error: null };
    return turn;
  }

  function resolveCost(usage: AiTokenUsage | null, reported: unknown): { costUsd: number | null; costSource: AiCostSource | null } {
    const provided = num(reported);
    if (provided !== null) return { costUsd: provided, costSource: 'provider' };
    const estimated = usage && options.priceUsage ? options.priceUsage({ model, usage }) : null;
    return estimated === null || estimated === undefined ? { costUsd: null, costSource: null } : { costUsd: estimated, costSource: 'estimated' };
  }

  function addToTotals(usage: AiTokenUsage | null, costUsd: number | null): void {
    totals.turns += 1;
    totals.inputTokens = addNullable(totals.inputTokens, usage?.inputTokens ?? null);
    totals.outputTokens = addNullable(totals.outputTokens, usage?.outputTokens ?? null);
    totals.costUsd = addNullable(totals.costUsd, costUsd);
  }

  function ttftOf(open: OpenTurn): number | null {
    if (open.ttftMs !== null) return open.ttftMs;
    return open.firstTokenAt === null ? null : open.firstTokenAt - open.startedAt;
  }

  function closeTurn({ rawUsage = null, reportedCost = null }: { rawUsage?: unknown; reportedCost?: unknown } = {}): void {
    const open = ensureTurn();
    const endedAt = now();
    const usage = normalizeAiUsage({ usage: rawUsage });
    const { costUsd, costSource } = resolveCost(usage, reportedCost);
    record({ kind: 'model_turn', traceId, turnId: open.id, index: open.index, startedAt: open.startedAt, endedAt, model, input: open.index === 0 ? capture(runInput) : null, output: captureStreamed(open.output, open.outputChars), reasoning: captureStreamed(open.reasoning, open.reasoningChars), usage, costUsd, costSource, ttftMs: ttftOf(open), stopReason: open.stopReason, error: open.error });
    addToTotals(usage, costUsd);
    turn = null;
    lastClosedTurnId = open.id;
    lastBoundary = endedAt;
  }

  function emitTool(id: string, tool: PendingTool, result: { content: string | null; isError: boolean; endedAt: number | null }): void {
    const errorClass = result.isError ? classifyToolError({ content: result.content ?? '' }) : null;
    totals.toolCalls += 1;
    if (result.isError) totals.toolErrors += 1;
    record({ kind: 'tool_call', traceId, toolCallId: id, turnId: tool.turnId, name: tool.name, input: capture(stringifyForCapture({ value: tool.input })), output: capture(result.content), isError: result.isError, errorClass, startedAt: tool.startedAt, endedAt: result.endedAt });
  }

  const handlers: Readonly<Record<string, (event: AgentEvent) => void>> = {
    status(event) {
      model = str(event.model) ?? model;
      const ttft = num(event.ttftMs);
      if (ttft !== null) ensureTurn().ttftMs = ttft;
    },
    text_delta(event) {
      const open = ensureTurn();
      const delta = typeof event.delta === 'string' ? event.delta : '';
      open.outputChars += delta.length;
      if (keepText) open.output += delta;
      open.firstTokenAt ??= now();
    },
    thinking_delta(event) {
      const open = ensureTurn();
      const delta = typeof event.delta === 'string' ? event.delta : '';
      open.reasoningChars += delta.length;
      if (keepText) open.reasoning += delta;
    },
    tool_use(event) {
      const id = str(event.id);
      if (!id || seenTools.has(id)) return;
      seenTools.add(id);
      // HTTP adapters report usage while streaming and emit tool_use only after the stream ends,
      // so a call arriving between turns was requested by the turn that just closed.
      const turnId = turn?.id ?? lastClosedTurnId ?? ensureTurn().id;
      pending.set(id, { name: str(event.name) ?? 'unknown', input: event.input, startedAt: now(), turnId });
    },
    tool_result(event) {
      const id = str(event.toolUseId) ?? 'unknown';
      const tool = pending.get(id) ?? { name: 'unknown', input: null, startedAt: now(), turnId: ensureTurn().id };
      pending.delete(id);
      emitTool(id, tool, { content: typeof event.content === 'string' ? event.content : null, isError: event.isError === true, endedAt: now() });
    },
    usage(event) {
      if (typeof event.stopReason === 'string') ensureTurn().stopReason = event.stopReason;
      closeTurn({ rawUsage: event.usage, reportedCost: event.costUsd });
    },
    // Stop reasons annotate an open turn only: HTTP adapters send `end` after the final usage
    // report, and opening a turn for it would record an empty phantom model call.
    turn_end(event) {
      if (turn) turn.stopReason = str(event.stopReason);
    },
    end(event) {
      if (turn) turn.stopReason = str(event.reason);
    },
    error(event) {
      lastError = str(event.message) ?? 'error';
      ensureTurn().error = lastError;
    },
  };

  function observe(event: AgentEvent): void {
    if (finished) return;
    handlers[String(event.type)]?.(event);
  }

  /** Tools still pending when the run ends are reported with `endedAt: null`, never dropped. */
  function flushOpenWork(): void {
    if (turn) closeTurn();
    for (const [id, tool] of pending) emitTool(id, tool, { content: null, isError: false, endedAt: null });
    pending.clear();
  }

  function runError(outcome: AiRunOutcome, error: { message: string; code?: string | null } | null): { message: string; code: string | null } | null {
    const message = error?.message ?? (outcome === 'failed' ? lastError : null);
    return message ? { message, code: error?.code ?? null } : null;
  }

  function finish({ outcome }: { outcome: AiRunOutcome }, { error = null }: { error?: { message: string; code?: string | null } | null } = {}): void {
    if (finished) return;
    if (!started) start({});
    flushOpenWork();
    finished = true;
    record({ kind: 'run_finished', traceId, at: now(), outcome, error: runError(outcome, error), totals: { ...totals } });
  }

  return { traceId, start, noteInput, observe, finish };
}
