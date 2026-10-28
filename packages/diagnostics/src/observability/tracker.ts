import type { AgentRunTrackingOutcome, OperationTrackingOutcome, RequestTrackingOutcome, TrackerScope } from "./ports.js";
import type { AgentSpanOptions, OperationSpanOptions, RequestSpanOptions, Tracker, TrackerErrorContext, TrackerOptions, TrackerProviders, TrackerSpan } from "./tracker-types.js";
import { createNoopTracker } from "./tracker-noop.js";
import { isNoopObservabilityPort } from "./noop.js";
import { combineObservabilityPorts } from "./fanout.js";
import { reportErrorOnce, runWithErrorReportScope } from "./report-error.js";

type SpanOutcome = OperationTrackingOutcome | RequestTrackingOutcome | AgentRunTrackingOutcome;
type SpanOptions = OperationSpanOptions | RequestSpanOptions | AgentSpanOptions;
type Lifecycle = Partial<TrackerScope> & { end(outcome: SpanOutcome): void };

/** Fixed diagnostic, once per facade; provider errors can contain credentials and are never logged.
 * @complexity O(1) time/space. */
export function createTrackerWarning(_required: Record<string, never>, { warn = (message) => console.warn(message) }: TrackerOptions = {}): () => void {
  let reported = false;
  return () => {
    if (reported) return;
    reported = true;
    try { warn("[tracker] a telemetry provider failed; application work continues"); } catch { /* Logging must not fail application work either. */ }
  };
}

/** Select the existing lifecycle owner; overloads keep request/agent outcomes typed at callers.
 * @complexity O(1) around the injected port. */
function startSpan({ observability, name, options }: { observability: NonNullable<TrackerProviders["observability"]>; name: string; options: SpanOptions }): Lifecycle {
  if ("request" in options) return observability.trackRequest({ method: options.request.method, path: options.request.path }, options.request.requestId === undefined ? {} : { requestId: options.request.requestId }) as Lifecycle;
  if ("agent" in options) return observability.trackAgentRun({ runId: options.agent.runId }, {
    ...(options.agent.conversationId === undefined ? {} : { conversationId: options.agent.conversationId }),
    ...(options.agent.agentName === undefined ? {} : { agentName: options.agent.agentName }),
  }) as Lifecycle;
  return observability.trackOperation({ name, ...(options.attributes ? { attributes: options.attributes } : {}) }) as Lifecycle;
}

/** Choose the lifecycle's typed default or failure outcome. @complexity O(1). */
function spanOutcome({ options, failure }: { options: SpanOptions; failure?: { error: unknown } }): SpanOutcome {
  if ("request" in options) return { statusCode: 500, routePattern: "unmatched" };
  if ("agent" in options) return failure ? { status: "failed", error: failure.error } : { status: "succeeded" };
  return { outcome: failure ? "error" : "completed", failed: failure !== undefined };
}

/** A throw replaces only an earlier success: cancellation, interruption and an explicit failure
 * keep their more specific labels (a 503, `quota_exceeded`, `interrupted`).
 * @returns The final lifecycle outcome, preserving a known request route. @complexity O(1).
 */
function thrownOutcome({ options, outcome, error }: { options: SpanOptions; outcome: SpanOutcome | undefined; error: unknown }, _options = {}): SpanOutcome {
  if (!outcome) return spanOutcome({ options, failure: { error } });
  if ("statusCode" in outcome) return outcome.statusCode >= 500 ? outcome : { ...outcome, statusCode: 500 };
  if ("status" in outcome) return outcome.status === "succeeded" ? { status: "failed", error } : outcome;
  return outcome.failed || ["canceled", "cancelled"].includes(outcome.outcome) ? outcome : spanOutcome({ options, failure: { error } });
}

/** One facade over existing ports: consent/identity remain on the composed providers, error
 * deduplication/redaction stays with reportErrorOnce, scope containment stays with fanout.
 * Missing providers do nothing; trace still runs work exactly once and preserves its result/error.
 * @param required Optional, already-composed providers; an empty object disables telemetry.
 * @param optional A warning sink, called once with a fixed message on any provider failure.
 * @complexity O(1) facade state; delivery/redaction costs remain with the existing ports.
 */
export function createTracker(required: TrackerProviders, optional: TrackerOptions = {}): Tracker {
  // Supplied analytics ports own their no-op behavior; their optional package must never load here.
  if (!required.productAnalytics && (!required.observability || isNoopObservabilityPort(required.observability))) return createNoopTracker({});
  const failed = createTrackerWarning({}, optional);
  const observability = combineObservabilityPorts({ ports: required.observability ? [required.observability] : [] }, { onFailure: failed });
  // Takes unknown so trace hands a thrown non-Error over as-is: reportErrorOnce redacts it, and the
  // same object then dedups as it propagates through nested traces (a fresh wrapper never would).
  const report = ({ failure }: { failure: unknown }, { context = {} }: { context?: TrackerErrorContext } = {}): void => {
    try {
      const attributes = context.route ? { ...context.attributes, route: context.route } : context.attributes;
      reportErrorOnce({ observability, error: failure, operation: context.operation ?? "application.error" }, {
        ...(attributes ? { attributes } : {}),
        ...(context.exactSecrets === undefined ? {} : { exactSecrets: context.exactSecrets }),
        ...(context.level === undefined ? {} : { level: context.level }),
      });
    } catch { failed(); }
  };
  const error: Tracker["error"] = ({ error: failure }, options = {}) => report({ failure }, options);
  async function trace<T>({ name, run: work }: { name: string; run: (span: TrackerSpan<SpanOutcome>) => T | Promise<T> }, options: SpanOptions = {}): Promise<T> {
    return runWithErrorReportScope({ scope: { reported: false }, work: async () => {
      const lifecycle = startSpan({ observability, name, options });
      let outcome: SpanOutcome | undefined;
      const handle: TrackerSpan<SpanOutcome> = { setOutcome: (value) => { outcome ??= value; } };
      const run = <R>(fn: () => R): R => lifecycle.run ? lifecycle.run(fn) : fn();
      try {
        return await run(() => work(handle));
      } catch (failure) {
        run(() => report({ failure }, { context: { operation: name } }));
        outcome = thrownOutcome({ options, outcome, error: failure });
        throw failure;
      } finally {
        // Request callbacks normally settle with their response outcome, including disconnects.
        lifecycle.end(outcome ?? spanOutcome({ options }));
      }
    } }, { reuseCurrent: true });
  }
  return {
    activeTraceIds: (_required = {}, _optional = {}) => observability.activeTraceIds?.(),
    capture(input, options = {}) { try { return Promise.resolve(required.productAnalytics?.capture({ ...input, ...options })).catch(failed); } catch { failed(); } },
    metric(input, options = {}) { observability.metric(input, options); },
    error,
    trace: trace as Tracker["trace"],
  };
}
