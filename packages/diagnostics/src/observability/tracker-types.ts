import type { ProductAnalyticsPort, ProductEvent } from "@jini-ai/analytics/product";
import type { AgentRunTrackingInput, AgentRunTrackingOptions, AgentRunTrackingOutcome, ObservabilityPort, OperationAttributes, OperationTrackingOutcome, RequestTrackingInput, RequestTrackingOptions, RequestTrackingOutcome } from "./ports.js";

/** Signals share one dependency; each method retains its own typed payload. */
export interface TrackerErrorContext {
  level?: 'warning' | 'error';
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
 * The name/callback and Error/context signatures are the owner-approved facade API. */
export interface Tracker {
  /** Awaitable local admission; does not wait for remote delivery. */
  capture(event: ProductEvent, options?: Record<string, never>): void | Promise<void>;
  error(error: Error, context?: TrackerErrorContext): void;
  span<T>(name: string, work: (span: TrackerSpan<RequestTrackingOutcome>) => T | Promise<T>, options: RequestSpanOptions): Promise<T>;
  span<T>(name: string, work: (span: TrackerSpan<AgentRunTrackingOutcome>) => T | Promise<T>, options: AgentSpanOptions): Promise<T>;
  span<T>(name: string, work: (span: TrackerSpan) => T | Promise<T>, options?: OperationSpanOptions): Promise<T>;
}

export interface TrackerProviders {
  /** Already guarded by the host's existing consent policy; never guard a second time. */
  productAnalytics?: ProductAnalyticsPort | undefined;
  observability?: ObservabilityPort | undefined;
}
export interface TrackerOptions { warn?: ((message: string) => void) | undefined; }
