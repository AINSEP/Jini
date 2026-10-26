/** Vendor-neutral inbound request lifecycle. Route patterns, rather than raw paths, label metrics. */
/**
 * Consumers speak in request lifecycle terms rather than Span/Tracer SDK types. That permits
 * replacing the instrumentation system itself, not merely its exporter backend. Add signals
 * only against real instrumentation call sites; guessed DB/outbound/agent shapes would couple
 * consumers to contracts whose lifecycle has not yet been established.
 * The DB/outbound/agent signals below were each shaped after their first real call site: the
 * storage kernel's run/transaction body, the guarded HTTP client's send, and a host's agent-run
 * watcher. Inputs carry ids and fixed labels only; adapters own redaction of anything raw.
 */
export interface RequestTrackingInput { method: string; path: string; }
export interface RequestTrackingOptions { requestId?: string; }
/** The mount-aware pattern is available only after routing; raw paths are known at request start.
 * Use a fixed 'unmatched' label for misses: attacker-controlled paths would make grouping unbounded. */
export interface RequestTrackingOutcome { statusCode: number; routePattern: string; }
/** Runs work inside a tracker's scope, so signals that work starts are attributed to it. */
export interface TrackerScope { run<T>(fn: () => T): T; }
export interface RequestTracker {
 readonly requestId?: string;
 // The response lifecycle owns completion; callers should end once when the response finishes.
 end(outcome: RequestTrackingOutcome): void;
 /** Optional so adapters written before scoping still satisfy the port; callers fall back to fn(). */
 run?<T>(fn: () => T): T;
}
/** `system` is the engine family (`sqlite`, `postgresql`); statement text never crosses the port. */
export interface DbQueryTrackingInput { system: string; }
/** Like a route pattern, the operation and table are known only once the query has been built. */
export interface DbQueryTrackingOutcome { operation: string; table?: string; error?: unknown; }
export interface DbQueryTracker extends TrackerScope { end(outcome: DbQueryTrackingOutcome): void; }
/** The raw URL is handed over whole; adapters keep scheme/host/port and drop path, query and userinfo. */
export interface OutboundCallTrackingInput { method: string; url: string; }
/** `statusCode` when a response arrived, `error` when the call failed before one did. */
export interface OutboundCallTrackingOutcome { statusCode?: number; error?: unknown; }
export interface OutboundCallTracker extends TrackerScope { end(outcome: OutboundCallTrackingOutcome): void; }
export interface AgentRunTrackingInput { runId: string; }
export interface AgentRunTrackingOptions { conversationId?: string; agentName?: string; }
/** `interrupted`: the run vanished (its process restarted). `abandoned`: the watcher gave up unproven. */
export type AgentRunStatus = 'succeeded' | 'failed' | 'canceled' | 'interrupted' | 'abandoned';
export interface AgentRunTrackingOutcome { status: AgentRunStatus; error?: unknown; }
export interface AgentRunTracker extends TrackerScope { end(outcome: AgentRunTrackingOutcome): void; }
/** Fixed labels and ids only (a tool id, a run id): never user text, paths, or values a caller sent. */
export type OperationAttributes = Readonly<Record<string, string | number>>;
/**
 * A feature-level unit of work (one tool call, one publish, one backup) that no transport signal
 * names: the HTTP request, DB queries and outbound calls it makes nest under it. `name` is a fixed
 * dotted label (`tool.call`), never per-call text, so grouping stays bounded.
 */
export interface OperationTrackingInput { name: string; attributes?: OperationAttributes; }
/** `outcome` is the feature's own fixed label (`completed`, `denied`, `timed-out`); `failed` says
 * whether that outcome is a failure, which only the feature can judge (a denial is not one). */
export interface OperationTrackingOutcome { outcome: string; failed: boolean; attributes?: OperationAttributes; }
export interface OperationTracker extends TrackerScope { end(outcome: OperationTrackingOutcome): void; }
/**
 * An error worth an incident report (an error tracker's issue; a trace's exception event), as
 * opposed to an expected failure a tracker's outcome already records. `error` is handed over raw:
 * adapters own redaction (see `describeReportedError`), exactly as they do for request targets.
 */
export interface ErrorReport { error: unknown; context: { operation: string; attributes?: OperationAttributes }; }
/** Vendor-neutral numeric measurement; names and units are fixed labels, never user text. */
export interface MetricInput { name: string; value: number; }
export interface MetricOptions {
 kind?: 'counter' | 'gauge' | 'histogram';
 unit?: string;
 attributes?: OperationAttributes;
}
export interface ObservabilityPort {
 /** Records one measurement; adapters without a metrics backend use a no-op. */
 metric(input: MetricInput, options?: MetricOptions): void | Promise<void>;
 trackRequest(input: RequestTrackingInput, options?: RequestTrackingOptions): RequestTracker;
 trackDbQuery(input: DbQueryTrackingInput): DbQueryTracker;
 trackOutboundCall(input: OutboundCallTrackingInput): OutboundCallTracker;
 trackAgentRun(input: AgentRunTrackingInput, options?: AgentRunTrackingOptions): AgentRunTracker;
 trackOperation(input: OperationTrackingInput): OperationTracker;
 /** Called inside a tracker's run() it is attributed to that tracker's work. Never throws. */
 reportError(report: ErrorReport): void;
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
 setStatus(required: { code: 'error'; description?: string }): void;
 addEvent(required: { name: string; attributes: Record<string, string | number> }): void;
 end(required: Record<string, never>): void;
}
export type TraceSpanKind = 'server' | 'client' | 'internal';
export interface TracerPort {
 /** `parent` is a span this tracer returned earlier; absent means a root span. */
 startSpan(required: { name: string; kind: TraceSpanKind; attributes: Record<string, string | number> }, optional?: { parent?: TraceSpanPort }): TraceSpanPort;
}
/** Host-owned active-span storage (Node: AsyncLocalStorage). Without one, every span is a root. */
export interface SpanScopePort {
 active(): TraceSpanPort | undefined;
 run<T>(required: { span: TraceSpanPort; fn: () => T }): T;
}
export interface TracerProviderPort { getTracer(required: { name: string }): TracerPort; }
export interface ExporterFactory {
 create(required: { endpoint: string }): unknown;
}
export interface TracerProviderFactory {
 create(required: { serviceName: string; exporter: unknown }): TracerProviderPort;
}
/** What a vendor provider subpath returns: the port plus the host-owned lifecycle hook. The host
 * registers `dispose` with its teardown (a closed site, a stopped process) so SDK clients, timers
 * and exit listeners are released (review 2026-10-25 #6). `dispose` never throws. */
export interface ObservabilityAdapter { port: ObservabilityPort; dispose(): Promise<void>; }
