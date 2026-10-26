import type { ProductAnalyticsPort, ProductEvent } from "@jini-ai/analytics/product";
import type { AgentRunTrackingInput, AgentRunTrackingOptions, AgentRunTrackingOutcome, ObservabilityPort, OperationAttributes, OperationTrackingOutcome, RequestTrackingInput, RequestTrackingOptions, RequestTrackingOutcome, MetricInput, MetricOptions } from "./ports.js";

/** Signals share one dependency; each method retains its own typed payload. */
export interface TrackerErrorContext {
  operation?: string;
  attributes?: OperationAttributes;
  /** Convenience label for callers that only know the route. */
  route?: string;
  exactSecrets?: readonly string[];
}

/** Record a semantic outcome; the facade owns ending the underlying lifecycle. First outcome wins. */
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
  /** Awaitable local admission; does not wait for remote delivery. */
  capture(input: Pick<ProductEvent, "name" | "userId">, options?: Pick<ProductEvent, "properties">): void | Promise<void>;
  error(input: { error: Error }, options?: { context?: TrackerErrorContext }): void;
  trace<T>(input: { name: string; run: (span: TrackerSpan<RequestTrackingOutcome>) => T | Promise<T> }, options: RequestSpanOptions): Promise<T>;
  trace<T>(input: { name: string; run: (span: TrackerSpan<AgentRunTrackingOutcome>) => T | Promise<T> }, options: AgentSpanOptions): Promise<T>;
  trace<T>(input: { name: string; run: (span: TrackerSpan) => T | Promise<T> }, options?: OperationSpanOptions): Promise<T>;
  /** Numeric measurement; defaults to a gauge. Fixed names and low-cardinality attributes only. */
  metric(input: MetricInput, options?: MetricOptions): void;
}

export interface TrackerProviders {
  /** Already guarded by the host's existing consent policy; never guard a second time. */
  productAnalytics?: ProductAnalyticsPort | undefined;
  observability?: ObservabilityPort | undefined;
}
export interface TrackerOptions { warn?: ((message: string) => void) | undefined; }
