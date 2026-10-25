/**
 * @module ai-trace/types
 *
 * Vendor-neutral AI-run trace contract: run → model turns → tool calls → outcome.
 *
 * Why a sibling port and not more `RunLifecycleEvent` variants: `TelemetrySink` is the
 * product-analytics port and its `data` is deliberately opaque so the engine never installs a
 * product's event schema. A trace is the opposite — a typed, hierarchical span tree that every
 * backend (Langfuse, Phoenix, Helicone, OTel GenAI) maps field-for-field. Widening the analytics
 * union would force every existing analytics sink to understand spans; a sibling port keeps both
 * contracts small and lets a host install either, both, or neither.
 *
 * Honesty rule: a field a provider stream cannot supply is `null`, never estimated in place.
 * Cost a host prices itself is marked `costSource: 'estimated'`.
 */

/** How much prompt/response/tool text leaves the process. `off`: none; `metadata`: char counts only; `full`: redacted text. */
export type AiContentCapture = 'off' | 'metadata' | 'full';

/** Why a tool call failed — the split that tells "the model called it wrong" apart from "the tool broke". */
export type AiToolErrorClass = 'input_validation' | 'execution' | 'denied' | 'timeout';

export type AiRunOutcome = 'succeeded' | 'failed' | 'cancelled';

/** Captured text after the capture mode and redaction ran. `text` is present only in `full` mode. */
export interface AiCapturedText {
  readonly chars: number;
  readonly text?: string;
  readonly truncated?: boolean;
  /** Per-category redaction counts (`{ email: 1 }`), so a reviewer sees what was stripped. */
  readonly redactions?: Readonly<Record<string, number>>;
}

/** Token counters; `null` means the provider did not report that counter, not zero. */
export interface AiTokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
}

export type AiCostSource = 'provider' | 'estimated';

export interface AiTraceRunStarted {
  readonly kind: 'run_started';
  readonly traceId: string;
  readonly runId: string;
  readonly at: number;
  readonly agentId: string;
  readonly provider: string | null;
  readonly model: string | null;
  /** Host conversation/chat id, so a backend can group runs into sessions. */
  readonly sessionId: string | null;
  readonly input: AiCapturedText | null;
  readonly tags: readonly string[];
}

/** One explicit provider request, or a run-level window when the stream supplies no request boundaries. */
export interface AiTraceModelTurn {
  readonly kind: 'model_turn';
  readonly traceId: string;
  readonly turnId: string;
  readonly index: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly model: string | null;
  readonly input: AiCapturedText | null;
  readonly output: AiCapturedText | null;
  readonly reasoning: AiCapturedText | null;
  readonly usage: AiTokenUsage | null;
  readonly costUsd: number | null;
  readonly costSource: AiCostSource | null;
  readonly ttftMs: number | null;
  readonly stopReason: string | null;
  readonly error: string | null;
  /** Error text follows the same capture policy as prompts; `error` is a safe label outside full mode. */
  readonly errorContent?: AiCapturedText | null;
  readonly errorCode?: string | null;
}

export interface AiTraceToolCall {
  readonly kind: 'tool_call';
  readonly traceId: string;
  /** Request-scoped trace identity; provider ids may repeat on the next request. */
  readonly toolCallId: string;
  /** The model turn that requested the call. */
  readonly turnId: string;
  readonly name: string;
  readonly input: AiCapturedText | null;
  readonly output: AiCapturedText | null;
  readonly isError: boolean;
  readonly errorClass: AiToolErrorClass | null;
  readonly startedAt: number;
  /** `null` when the run ended before the tool reported a result. */
  readonly endedAt: number | null;
}

export interface AiTraceTotals {
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
}

export interface AiTraceRunFinished {
  readonly kind: 'run_finished';
  readonly traceId: string;
  readonly at: number;
  readonly outcome: AiRunOutcome;
  readonly error: { readonly message: string; readonly code: string | null; readonly content?: AiCapturedText | null } | null;
  readonly totals: AiTraceTotals;
}

export type AiTraceEvent = AiTraceRunStarted | AiTraceModelTurn | AiTraceToolCall | AiTraceRunFinished;

/**
 * Backend port. `record` must not throw into the run (the recorder guards it anyway) and must not
 * block: adapters buffer and send in `flush`. Hosts call `shutdown` once on process exit.
 */
export interface AiTraceSink {
  record(event: AiTraceEvent): void;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}
