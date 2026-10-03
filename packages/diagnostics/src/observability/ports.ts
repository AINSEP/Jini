/** Vendor-neutral inbound request lifecycle. Route patterns, rather than raw paths, label metrics. */
/**
 * Consumers speak in request lifecycle terms rather than Span/Tracer SDK types. That permits
 * replacing the instrumentation system itself, not merely its exporter backend. Add signals
 * only against real instrumentation call sites; guessed DB/outbound/agent shapes would couple
 * consumers to contracts whose lifecycle has not yet been established.
 */
export interface RequestTrackingInput { method: string; path: string; }
export interface RequestTrackingOptions { requestId?: string; }
/** The mount-aware pattern is available only after routing; raw paths are known at request start.
 * Use a fixed 'unmatched' label for misses: attacker-controlled paths would make grouping unbounded. */
export interface RequestTrackingOutcome { statusCode: number; routePattern: string; }
export interface RequestTracker {
 readonly requestId?: string;
 // The response lifecycle owns completion; callers should end once when the response finishes.
 end(outcome: RequestTrackingOutcome): void;
}
export interface ObservabilityPort {
 trackRequest(input: RequestTrackingInput, options?: RequestTrackingOptions): RequestTracker;
}
export interface RequestObservation extends RequestTrackingOutcome {
 requestId: string; method: string; durationMs: number;
}
export interface RequestLogPort { log(event: RequestObservation): void; }
export interface RequestMetricsPort { recordRequest(event: RequestObservation): void; }
export interface RequestIdGenerator { generate(required: Record<string, never>): string; }

/** Structural SDK adapters are host-owned; no provider registration or ambient config is used. */
export interface TraceSpanPort {
 updateName(required: { name: string }): void;
 setAttribute(required: { name: string; value: string | number }): void;
 setStatus(required: { code: 'error' }): void;
 end(required: Record<string, never>): void;
}
export interface TracerPort {
 startSpan(required: { name: string; kind: 'server'; attributes: Record<string, string | number> }): TraceSpanPort;
}
export interface TracerProviderPort { getTracer(required: { name: string }): TracerPort; }
export interface ExporterFactory {
 create(required: { endpoint: string }): unknown;
}
export interface TracerProviderFactory {
 create(required: { serviceName: string; exporter: unknown }): TracerProviderPort;
}
