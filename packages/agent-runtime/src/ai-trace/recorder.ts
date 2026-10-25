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
 * A model turn follows explicit request boundaries (`status: requesting`, `end`) when the stream has them;
 * otherwise each usage report closes one turn (CLI per-step or per-run usage).
 * Within a request, usage reports are snapshots, not boundaries: a final frame can contain usage AND more text.
 * HTTP tool-turn produces one turn per call; CLIs that report once per run (Claude Code `result`,
 * Copilot) produce one turn per run with all its tool calls — the granularity the provider gave,
 * not a guess.
 */
import { captureText, stringifyForCapture, type CaptureTextOptions } from './capture.js';
import { classifyToolError } from './classify.js';
import { addNullable, normalizeAiUsage } from './usage.js';
import { reportError } from './sinks.js';
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
  const pending = new Map<string, PendingTool[]>();
  const seenTools = new Set<string>();
  const totals: Totals = { turns: 0, toolCalls: 0, toolErrors: 0, inputTokens: null, outputTokens: null, costUsd: null };
  let model = options.model ?? null;
  let turn: OpenTurn | null = null;
  let lastBoundary = now();
  let runInput: string | null = null;
  let lastError: string | null = null;
  let lastErrorCode: string | null = null;
  // Set by the first `status: requesting`; streams without request boundaries keep usage-closes-turn.
  let requestBounded = false;
  let started = false;
  let finished = false;

  function record(event: AiTraceEvent): void {
    try {
      sink.record(event);
    } catch (error) {
      reportError({ error, onError: options.onSinkError });
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
    turn ??= { id: `${traceId}:turn:${totals.turns}`, index: totals.turns, startedAt: lastBoundary, output: '', outputChars: 0, reasoning: '', reasoningChars: 0, firstTokenAt: null, ttftMs: null, stopReason: null, error: null, errorCode: null, usage: null, reportedCost: null };
    return turn;
  }

  function resolveCost({ usage, reported }: { usage: AiTokenUsage | null; reported: unknown }): { costUsd: number | null; costSource: AiCostSource | null } {
    const provided = num(reported);
    if (provided !== null) return { costUsd: provided, costSource: 'provider' };
    let estimated: number | null = null;
    try {
      estimated = usage && options.priceUsage ? num(options.priceUsage({ model, usage })) : null;
    } catch (error) {
      reportError({ error, onError: options.onSinkError });
    }
    return estimated === null ? { costUsd: null, costSource: null } : { costUsd: estimated, costSource: 'estimated' };
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

  /** Snapshots replace reported fields and retain omitted counters; they are never summed within a request. */
  function updateUsage({ event }: { event: AgentEvent }): void {
    const open = ensureTurn();
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
  function safeCode({ code }: { code: string | null }): string | null {
    if (!code) return null;
    const captured = captureText({ text: code }, { ...captureOptions, mode: 'full', maxChars: 64 });
    if (captured?.redactions || captured?.truncated) return null;
    return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(code) ? code : null;
  }

  function closeTurn(): void {
    if (!turn) return;
    const open = turn;
    const endedAt = now();
    const usage = open.usage;
    const { costUsd, costSource } = resolveCost({ usage, reported: open.reportedCost });
    const errorContent = capture(open.error);
    record({ kind: 'model_turn', traceId, turnId: open.id, index: open.index, startedAt: open.startedAt, endedAt, model, input: open.index === 0 ? capture(runInput) : null, output: captureStreamed(open.output, open.outputChars), reasoning: captureStreamed(open.reasoning, open.reasoningChars), usage, costUsd, costSource, ttftMs: ttftOf(open), stopReason: open.stopReason, error: open.error === null ? null : errorContent?.text ?? 'model_error', errorContent, errorCode: safeCode({ code: open.errorCode }) });
    addToTotals(usage, costUsd);
    turn = null;
    lastBoundary = endedAt;
  }

  function emitTool({ tool, result }: { tool: PendingTool; result: { content: string | null; isError: boolean; endedAt: number | null } }): void {
    const errorClass = result.isError ? classifyToolError({ content: result.content ?? '' }) : null;
    totals.toolCalls += 1;
    if (result.isError) totals.toolErrors += 1;
    record({ kind: 'tool_call', traceId, toolCallId: tool.id, turnId: tool.turnId, name: tool.name, input: capture(stringifyForCapture({ value: tool.input })), output: capture(result.content), isError: result.isError, errorClass, startedAt: tool.startedAt, endedAt: result.endedAt });
  }

  const handlers: Readonly<Record<string, (event: AgentEvent) => void>> = {
    status(event) {
      if (event.label === 'requesting') {
        requestBounded = true;
        closeTurn();
        // Every HTTP request already emits this status, including tool-only follow-up requests.
        // Its turn (opened lazily by the first event) stays open through usage and delayed
        // tool_use emission until the next boundary.
        lastBoundary = now();
      }
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
      if (!id) return;
      const turnId = ensureTurn().id;
      const scopedId = `${turnId}:tool:${id}`;
      if (seenTools.has(scopedId)) return;
      seenTools.add(scopedId);
      // HTTP adapters report usage while streaming and emit tool_use only after the stream ends,
      // so usage leaves this request open until its delayed calls have been attributed.
      const tools = pending.get(id) ?? [];
      tools.push({ id: scopedId, name: str(event.name) ?? 'unknown', input: event.input, startedAt: now(), turnId });
      pending.set(id, tools);
    },
    tool_result(event) {
      const id = str(event.toolUseId) ?? 'unknown';
      const tools = pending.get(id);
      const tool = tools?.shift() ?? { id: `${ensureTurn().id}:tool:${id}`, name: 'unknown', input: null, startedAt: now(), turnId: ensureTurn().id };
      if (!tools?.length) pending.delete(id);
      emitTool({ tool, result: { content: typeof event.content === 'string' ? event.content : null, isError: event.isError === true, endedAt: now() } });
    },
    // CLI streams (OpenCode step_finish, pi-rpc turn_end, ...) report per-step usage with no request
    // boundary: each report still closes its own turn so totals sum steps instead of keeping the last.
    usage(event) {
      updateUsage({ event });
      if (!requestBounded) closeTurn();
    },
    // Boundaries close only existing work: opening a turn for a final stop signal would record
    // an empty phantom model call. CLI turn_end is a control signal; usage may follow it.
    turn_end(event) {
      if (turn) turn.stopReason = str(event.stopReason);
    },
    end(event) {
      if (turn) turn.stopReason ??= str(event.reason);
      closeTurn();
    },
    error(event) {
      lastError = str(event.message) ?? 'error';
      lastErrorCode = str(event.code);
      const open = ensureTurn();
      open.error = lastError;
      open.errorCode = lastErrorCode;
    },
  };

  function observe(event: AgentEvent): void {
    if (finished) return;
    handlers[String(event.type)]?.(event);
  }

  /** Tools still pending when the run ends are reported with `endedAt: null`, never dropped. */
  function flushOpenWork(): void {
    if (turn) closeTurn();
    for (const tools of pending.values()) {
      for (const tool of tools) emitTool({ tool, result: { content: null, isError: false, endedAt: null } });
    }
    pending.clear();
  }

  function runError({ outcome, error }: { outcome: AiRunOutcome; error: { message: string; code?: string | null } | null }): Extract<AiTraceEvent, { kind: 'run_finished' }>['error'] {
    const message = error?.message ?? (outcome === 'failed' ? lastError : null);
    if (!message) return null;
    const content = capture(message);
    return { message: content?.text ?? 'run_error', code: safeCode({ code: error?.code ?? lastErrorCode }), content };
  }

  function finish({ outcome }: { outcome: AiRunOutcome }, { error = null }: { error?: { message: string; code?: string | null } | null } = {}): void {
    if (finished) return;
    if (!started) start({});
    flushOpenWork();
    finished = true;
    record({ kind: 'run_finished', traceId, at: now(), outcome, error: runError({ outcome, error }), totals: { ...totals } });
  }

  return { traceId, start, noteInput, observe, finish };
}
