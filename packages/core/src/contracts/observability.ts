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
export interface AgentRunTrackingOptions { conversationId?: string; agentName?: string; traceparent?: string; }
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
export interface OperationTrackingInput { name: string; attributes?: OperationAttributes; traceparent?: string; }
/** `outcome` is the feature's own fixed label (`completed`, `denied`, `timed-out`); `failed` says
 * whether that outcome is a failure, which only the feature can judge (a denial is not one). */
export interface OperationTrackingOutcome { outcome: string; failed: boolean; attributes?: OperationAttributes; }
export interface OperationTracker extends TrackerScope { end(outcome: OperationTrackingOutcome): void; traceIds?(): TraceIds | undefined; }
/** Correlation assigned by an active tracing implementation; readers never generate IDs. */
export interface TraceIds { readonly traceId: string; readonly spanId: string; }
/**
 * An error worth an incident report (an error tracker's issue; a trace's exception event), as
 * opposed to an expected failure a tracker's outcome already records. `error` is handed over raw:
 * adapters own redaction (see `describeReportedError`), exactly as they do for request targets.
 */
export interface ErrorReport { error: unknown; context: {
 operation: string; attributes?: OperationAttributes; level?: 'warning' | 'error'; trace?: TraceIds; incidentId?: string; label?: string;
 /** Private, in-process redaction input: exact values (a token the request carried) the adapter
  * blanks from the error before export. An adapter consumes it before projecting provider-bound
  * context and never serializes, logs or forwards the array itself. */
 exactSecrets?: readonly string[];
}; }
/** Native crash upload configuration. Provider-specific field names stay opaque to hosts. */
export interface CrashUpload { submitURL: string; globalExtra: Readonly<Record<string, string>>; }
/** Vendor-neutral numeric measurement; names and units are fixed labels, never user text. */
export interface MetricInput { name: string; value: number; }
export interface MetricOptions {
 kind?: 'counter' | 'gauge' | 'histogram';
 unit?: string;
 attributes?: OperationAttributes;
}
export interface ObservabilityPort {
 /** Current structural tracing scope, absent outside a trace. Never generates an ID. */
 activeTraceIds?(required?: Record<string, never>, optional?: Record<string, never>): TraceIds | undefined;
 activeTraceparent?(): string | undefined;
 /** Explicit capability: a callable noop metric does not imply local metric admission. */
 readonly supportsMetric?: boolean;
 /** Records one measurement; adapters without a metrics backend use a no-op. */
 metric(input: MetricInput, options?: MetricOptions): void | Promise<void>;
 trackRequest(input: RequestTrackingInput, options?: RequestTrackingOptions): RequestTracker;
 trackDbQuery(input: DbQueryTrackingInput): DbQueryTracker;
 trackOutboundCall(input: OutboundCallTrackingInput): OutboundCallTracker;
 trackAgentRun(input: AgentRunTrackingInput, options?: AgentRunTrackingOptions): AgentRunTracker;
 trackOperation(input: OperationTrackingInput): OperationTracker;
 /** Called inside a tracker's run() it is attributed to that tracker's work. False refuses local admission; void accepts it. */
 reportError(report: ErrorReport): boolean | void | Promise<boolean | void>;
 /** Configuration only; the host owns crash collection, consent and upload lifecycle. */
 crashUpload?(required: { release: string; environment: string }, optional?: Record<string, never>): CrashUpload;
}
/** What a vendor provider subpath returns: the port plus the host-owned lifecycle hook. The host
 * registers `dispose` with its teardown (a closed site, a stopped process) so SDK clients, timers
 * and exit listeners are released (review 2026-10-25 #6). `dispose` never throws. */
export interface ObservabilityAdapter { port: ObservabilityPort; dispose(): Promise<void>; }

/* ---------- product analytics port ---------- */
export type ProductEventProperties = Readonly<Record<string, string | number | boolean>>;

/** One thing a user did. `name` is a fixed snake_case label (`assistant_tool_call`), never user text. */
export interface ProductEvent { name: string; userId: string; properties?: ProductEventProperties; }
/** Who the user is, in pseudonymous traits only (a plan, a role, a locale — never a name or e-mail). */
export interface ProductIdentity { userId: string; traits?: ProductEventProperties; }

/** A model generation's neutral metadata. Text is separate so metadata-only providers cannot leak it. */
export interface ProductAiGeneration { userId: string; properties: ProductEventProperties; input?: string; output?: string; }

/** The port features call. Never throws, never blocks: delivery is the adapter's background job. */
export interface ProductAnalyticsPort {
  /** Optional trusted browser contribution; it contains only publishable browser configuration. */
  browserAnalytics?(required: { surface: 'site' | 'admin' }, optional?: Record<string, never>): BrowserAnalyticsContribution;
  /** Resolves after local consent/admission only; remote delivery remains in the background. */
  capture(event: ProductEvent): void | Promise<void>;
  identify(identity: ProductIdentity): void;
  /** Optional capability; providers without LLM analytics keep their existing contract. */
  captureAiGeneration?(required: ProductAiGeneration, optional?: Record<string, never>): void;
  /** Explicit provider opt-in only. The default records counts and metadata, never transcript text. */
  readonly includeAiContent?: boolean;
}

/** What a vendor provider subpath returns: the port plus the host-owned teardown (flush + close). */
export interface ProductAnalyticsAdapter { port: ProductAnalyticsPort; dispose(): Promise<void>; }

/** Browser contribution of a product-analytics provider; the port's `browserAnalytics` returns it, so it lives with the port. */
export interface BrowserAnalyticsContribution {
  /** Trusted plugin code: a function expression returning a `(mode) => void` controller. */
  readonly source: string;
  /** Exact origins required by this contribution, including anonymous delivery. */
  readonly origins: readonly string[];
  readonly supportsStatic: boolean;
  /** Server-only same-origin asset/collection adapter. Never serialized into page source.
   * The host admits collection with its existing consent owner before invoking this port. */
  readonly http?: {
    readonly path: string;
    handle(required: { method: string; path: string; body: Uint8Array; contentType: string }, optional?: Record<string, never>): Promise<{ status: number; body: string | Uint8Array; contentType?: string; cacheControl?: string }>;
  };
  /** Mode changes retire identities/replay synchronously before starting the next mode. */
  readonly supportsLiveConsent?: boolean;
  /** Host-owned live check; a changed revision retires this page's SDKs until reload. */
  readonly configuration?: { readonly url: string; readonly revision: string };
}

/* ---------- the disabled port ---------- */
const run = <T>(fn: () => T): T => fn();
const NOOP_TRACKER: RequestTracker = Object.freeze({ end(): void {}, run });
// One frozen tracker serves every non-request signal too: their end() outcomes differ only in type.
const NOOP_SIGNAL_TRACKER: DbQueryTracker & OutboundCallTracker & AgentRunTracker & OperationTracker = Object.freeze({ end(): void {}, run });
// One frozen port, built at module load: identity is the test for "telemetry is off", so no registry of built ports is kept.
const NOOP_PORT: ObservabilityPort = Object.freeze({
 supportsMetric: false,
 activeTraceIds: () => undefined,
 activeTraceparent: () => undefined,
 trackRequest: () => NOOP_TRACKER,
 trackDbQuery: () => NOOP_SIGNAL_TRACKER,
 trackOutboundCall: () => NOOP_SIGNAL_TRACKER,
 trackAgentRun: () => NOOP_SIGNAL_TRACKER,
 trackOperation: () => NOOP_SIGNAL_TRACKER,
 reportError: () => false,
 metric: () => {},
});
/** Creates disabled telemetry; every request shares one frozen tracker without allocation. */
export function createNoopObservabilityPort(_required: Record<string, never>): ObservabilityPort {
 return NOOP_PORT;
}
/** True for a port this module built. Decorators use it to skip wrapping entirely when telemetry is
 * off, so a disabled install pays no per-query or per-call indirection, not merely no export. */
export function isNoopObservabilityPort(port: ObservabilityPort): boolean {
 return port === NOOP_PORT;
}
