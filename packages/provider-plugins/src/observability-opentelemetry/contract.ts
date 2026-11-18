/** The OTel-shaped factory and span ports this provider is built over, plus the helpers the domain hands
 * every observability provider as the factory's `optional.context`. The observability port types it reads
 * and returns (`ObservabilityPort`, `RequestTracker`, `TraceIds`, `AgentRunStatus`) come from
 * `@jini-ai/core/contracts/observability`; only the OTel-specific shapes stay provider-local. */
import type { OperationAttributes, TraceIds } from '@jini-ai/core/contracts/observability';

export interface ObservabilityConfigEnabled { enabled: true; serviceName: string; tracerName: string; endpoint: string }

export interface TraceSpanPort {
 ids?(required?: Record<string, never>, optional?: Record<string, never>): TraceIds | undefined;
 updateName(required: { name: string }): void;
 setAttribute(required: { name: string; value: string | number }): void;
 setStatus(required: { code: 'error'; description?: string }): void;
 addEvent(required: { name: string; attributes: Record<string, string | number> }): void;
 end(required: Record<string, never>): void;
}
export type TraceSpanKind = 'server' | 'client' | 'internal';
export interface TracerPort {
 /** `parent` is a span this tracer returned earlier; absent means a root span. */
 startSpan(required: { name: string; kind: TraceSpanKind; attributes: Record<string, string | number> }, optional?: { parent?: TraceSpanPort }): TraceSpanPort;
}
export interface SpanScopePort {
 active(): TraceSpanPort | undefined;
 run<T>(required: { span: TraceSpanPort; fn: () => T }): T;
}
export interface TracerProviderPort { getTracer(required: { name: string }): TracerPort }
export interface ExporterFactory { create(required: { endpoint: string }): unknown }
export interface TracerProviderFactory { create(required: { serviceName: string; exporter: unknown }): TracerProviderPort }

/** Domain helpers for redaction and low-cardinality error labels, handed over as the factory context. */
export interface ObservabilityHelpers {
 errorType(required: { error: unknown }, optional?: Record<string, never>): string;
 redactOperationAttributes(required: { attributes: OperationAttributes }): Record<string, string | number>;
 redactLabel(required: { text: string }, optional?: Record<string, never>): string;
}
