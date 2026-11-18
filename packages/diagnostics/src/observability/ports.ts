import type { RequestTrackingOutcome, TraceIds } from '@jini-ai/core/contracts/observability';
// The signal vocabulary (trackers, ObservabilityPort, ErrorReport, ...) lives in @jini-ai/core/contracts/observability;
// what stays here is diagnostics' own request-logging and span SPI.
export interface RequestObservation extends RequestTrackingOutcome {
 requestId: string; method: string; durationMs: number;
}
export interface RequestLogPort { log(event: RequestObservation): void; }
export interface RequestMetricsPort { recordRequest(event: RequestObservation): void; }
export interface RequestIdGenerator { generate(required: Record<string, never>): string; }

/** Structural SDK adapters are host-owned; no provider registration or ambient config is used. */
export interface TraceSpanPort {
 /** IDs assigned by the tracing implementation, absent on legacy adapters. */
 ids?(required?: Record<string, never>, optional?: Record<string, never>): TraceIds | undefined;
 updateName(required: { name: string }): void;
 setAttribute(required: { name: string; value: string | number }): void;
 setStatus(required: { code: 'error'; description?: string }): void;
 addEvent(required: { name: string; attributes: Record<string, string | number> }): void;
 end(required: Record<string, never>): void;
}
/** Host-owned active-span storage (Node: AsyncLocalStorage). Without one, every span is a root. */
export interface SpanScopePort {
 active(): TraceSpanPort | undefined;
 run<T>(required: { span: TraceSpanPort; fn: () => T }): T;
}
