/** Structural copies of the observability port types this provider reads and returns (only the fields it
 * uses), plus the helpers the domain hands every observability provider as the factory's `optional.context`.
 * The provider never imports the domain; the host checks the shapes with `satisfies` and conformance. */

export interface ObservabilityConfigEnabled { enabled: true; serviceName: string; tracerName: string; endpoint: string }
export interface TraceIds { readonly traceId: string; readonly spanId: string }
export type AgentRunStatus = 'succeeded' | 'failed' | 'canceled' | 'interrupted' | 'abandoned';
type OperationAttributes = Readonly<Record<string, string | number>>;

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

interface TrackerScope { run<T>(fn: () => T): T }
export interface RequestTracker {
 readonly requestId?: string;
 end(outcome: { statusCode: number; routePattern: string }): void;
 run?<T>(fn: () => T): T;
}
export interface ObservabilityPort {
 activeTraceIds?(required?: Record<string, never>, optional?: Record<string, never>): TraceIds | undefined;
 readonly supportsMetric?: boolean;
 metric(input: { name: string; value: number }, options?: { kind?: 'counter' | 'gauge' | 'histogram'; unit?: string; attributes?: OperationAttributes }): void | Promise<void>;
 trackRequest(input: { method: string; path: string }, options?: { requestId?: string }): RequestTracker;
 trackDbQuery(input: { system: string }): TrackerScope & { end(outcome: { operation: string; table?: string; error?: unknown }): void };
 trackOutboundCall(input: { method: string; url: string }): TrackerScope & { end(outcome: { statusCode?: number; error?: unknown }): void };
 trackAgentRun(input: { runId: string }, options?: { conversationId?: string; agentName?: string }): TrackerScope & { end(outcome: { status: AgentRunStatus; error?: unknown }): void };
 trackOperation(input: { name: string; attributes?: OperationAttributes }): TrackerScope & { end(outcome: { outcome: string; failed: boolean; attributes?: OperationAttributes }): void };
 reportError(report: { error: unknown; context: { operation: string; attributes?: OperationAttributes; level?: 'warning' | 'error'; trace?: TraceIds } }): boolean | void | Promise<boolean | void>;
}

/** Domain helpers for redaction and low-cardinality error labels, handed over as the factory context. */
export interface ObservabilityHelpers {
 errorType(required: { error: unknown }, optional?: Record<string, never>): string;
 redactOperationAttributes(required: { attributes: OperationAttributes }): Record<string, string | number>;
 redactLabel(required: { text: string }, optional?: Record<string, never>): string;
}
