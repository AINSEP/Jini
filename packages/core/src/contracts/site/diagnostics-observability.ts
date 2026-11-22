import type {
  AgentRunTrackingInput,
  AgentRunTrackingOptions,
  AgentRunTrackingOutcome,
  OperationAttributes,
  OperationTrackingOutcome,
  RequestTrackingInput,
  RequestTrackingOptions,
  RequestTrackingOutcome,
  MetricInput,
  MetricOptions,
  TraceIds,
} from "../observability.js";

/** Capture-only consumer port; higher-layer analytics adapters satisfy it structurally. */
export interface CaptureEvent { name: string; userId: string; properties?: Readonly<Record<string, string | number | boolean>>; }
/** Signals share one dependency; each method retains its own typed payload. */
export interface TrackerErrorContext {
  level?: 'warning' | 'error';
  operation?: string;
  attributes?: OperationAttributes;
  /** Convenience label for callers that only know the route. */
  route?: string;
  exactSecrets?: readonly string[];
}

/** Record a semantic outcome; the facade owns ending the underlying lifecycle. First outcome wins unless work throws; explicit cancellation is preserved. */
export interface TrackerSpan<Outcome = OperationTrackingOutcome> {
  setOutcome(outcome: Outcome): void;
}
/** Fixed labels and ids only; never pass user text or credential values as span attributes. */
export interface OperationSpanOptions { attributes?: OperationAttributes; }
export interface RequestSpanOptions { request: RequestTrackingInput & RequestTrackingOptions; }
export interface AgentSpanOptions { agent: AgentRunTrackingInput & AgentRunTrackingOptions; }

/** Provider failures never escape. Application callback errors retain their original identity.
 * Required fields precede optional settings; no provider-specific types cross this boundary. */
export interface Tracker {
  /** Current tracing IDs, absent without an active span; optional for older host facades. */
  activeTraceIds?(required?: Record<string, never>, optional?: Record<string, never>): TraceIds | undefined;
  /** Awaitable local admission; does not wait for remote delivery. */
  capture(input: Pick<CaptureEvent, "name" | "userId">, options?: Pick<CaptureEvent, "properties">): void | Promise<void>;
  error(input: { error: Error }, options?: { context?: TrackerErrorContext }): void;
  trace<T>(input: { name: string; run: (span: TrackerSpan<RequestTrackingOutcome>) => T | Promise<T> }, options: RequestSpanOptions): Promise<T>;
  trace<T>(input: { name: string; run: (span: TrackerSpan<AgentRunTrackingOutcome>) => T | Promise<T> }, options: AgentSpanOptions): Promise<T>;
  trace<T>(input: { name: string; run: (span: TrackerSpan) => T | Promise<T> }, options?: OperationSpanOptions): Promise<T>;
  /** Numeric measurement; defaults to a gauge. Fixed names and low-cardinality attributes only. */
  metric(input: MetricInput, options?: MetricOptions): void;
}

