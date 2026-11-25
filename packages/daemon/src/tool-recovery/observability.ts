/**
 * @file Every tool call as one observed operation. The executor is the one chokepoint every
 * delegated, BYOK and visitor tool call already passes through, so instrumenting it here covers
 * them all without touching a single tool handler or route.
 *
 * The port type comes from `@jini-ai/core/contracts/observability`, which keeps this package free of
 * `@jini-ai/diagnostics`. That keeps the daemon free of any observability vendor AND of the diagnostics
 * package; the host composes them.
 * A host whose telemetry is off should still wrap (diagnostics' `isNoopObservabilityPort` no longer
 * decides it), so a disabled install keeps the wrapper frame: the observation predicate decides spans
 * and metrics, never recording. A failed tool always writes its one host record through the
 * injected reporter (owner 2026-11, P4-J4), because an incident that only exists when tracing is on
 * is an incident a disabled install silently drops.
 */
import { redactSecrets, ToolInputError, type Principal } from "@jini-ai/core";
// The `ObservabilityPort` methods this decorator calls; the port itself satisfies it.
import type { ObservabilityPort, OperationAttributes, OperationTracker } from "@jini-ai/core/contracts/observability";
import { endOnce, NOOP_OPERATION_TRACKER, startOperation, type ErrorReporter } from "@jini-ai/core/errors/reporter";
import type { ToolExecutionResult, ToolExecutionStatus, ToolExecutor } from "../tool-executor-types.js";
import { decorateToolExecutor } from "./decorate-executor.js";
import { readToolErrorId, type RedactedToolExecutionResult } from "../core/tool-error-id.js";

export const TOOL_CALL_OPERATION = "tool.call";

/** The fixed step names a tool incident is recorded under. */
const TOOL_STEP = "Run tool";
const NESTED_TOOL_STEP = "Run nested tool";

/** The one recording method a tool boundary needs; the host's single reporter satisfies it. */
export type ToolFailureReporter = Pick<ErrorReporter, "record">;

/** Span and metric ports; all optional, because recording never depends on them. */
export type ToolCallObservability = Pick<ObservabilityPort, "trackOperation"> & Partial<Pick<ObservabilityPort, "metric" | "supportsMetric">>;

// A denial, a declined confirmation and a cancellation are the system working as designed, not
// failures; a timeout and a failed handler are. Refusals still count under kind: "refused" on
// tool.failures, but are not failed spans or incidents.
const FAILED_STATUSES: ReadonlySet<ToolExecutionStatus> = new Set(["failed", "timed-out"]);

/** The settled result's text as an Error, so an error tracker gets a type to group on. The text is
 * whatever the inner stack left (the host's `withRedactedToolFailures` has already blanked secrets);
 * adapters redact again regardless. */
export class ToolExecutionFailure extends Error {
  override readonly name = "ToolExecutionFailure";
}

/** The `tool.id` label for an id nobody registered. Observation starts before the registry has looked
 * the id up, and a delegated request can carry any string there, a pasted key included (review
 * 2026-10-25 #1): an unregistered id is never exported, only this fixed label. */
export const UNREGISTERED_TOOL_LABEL = "unregistered";

/** Registered tool ids are short dotted/underscored names. Used only when the host gives no registry check. */
const TOOL_ID_SHAPE = /^[A-Za-z][\w.:-]{0,127}$/;

/** Host check, when it has one: is this id a tool the registry knows? */
export type IsRegisteredTool = (input: { toolId: string }) => boolean;

export function toolCallLabel({ toolId }: { toolId: string }, { isRegisteredTool }: { isRegisteredTool?: IsRegisteredTool | undefined }): string {
  const shapeOk = TOOL_ID_SHAPE.test(toolId) && redactSecrets({ input: toolId }) === toolId;
  return shapeOk && (isRegisteredTool?.({ toolId }) ?? true) ? toolId : UNREGISTERED_TOOL_LABEL;
}

/** WHO did it, as the principal's opaque id (owner 2026-10-25). Pseudonymous only: an id that looks
 * like an e-mail address or carries a secret shape is replaced, never exported. */
export const UNIDENTIFIED_USER_LABEL = "unidentified";

export function pseudonymousUserId({ principal }: { principal: Principal }): string {
  const id = principal.id;
  if (!id || id.includes("@") || id.length > 128 || redactSecrets({ input: id }) !== id) return UNIDENTIFIED_USER_LABEL;
  return id;
}

function errorKindOf(result: ToolExecutionResult): string | undefined {
  return result.status === "failed" ? result.errorKind ?? "internal" : undefined;
}

type ToolCallMetrics = Partial<Pick<ObservabilityPort, "metric" | "supportsMetric">>;

type ToolFailureKind = "internal" | "input" | "refused";

/** The fixed `kind` label for one settled call's `tool.failures` increment, or undefined when the
 * call did not fail (completed, cancelled). A refusal is counted but is not a failed span. */
function failureKindOf(result: ToolExecutionResult): ToolFailureKind | undefined {
  if (result.status === "denied" || result.status === "confirmation-denied") return "refused";
  if (result.status === "timed-out") return "internal";
  if (result.status !== "failed") return undefined;
  return result.errorKind === "validation" ? "input" : "internal";
}

function recordToolCallMetrics({ observability, toolId, failureKind }: { observability: ToolCallMetrics; toolId: string; failureKind?: ToolFailureKind | undefined }, _optional = {}): void {
  if (!observability.supportsMetric || !observability.metric) return;
  observability.metric({ name: "tool.calls", value: 1 }, { kind: "counter", attributes: { "tool.id": toolId } });
  if (failureKind) observability.metric({ name: "tool.failures", value: 1 }, { kind: "counter", attributes: { "tool.id": toolId, kind: failureKind } });
}

/** One call's settlement inputs: `metrics` is present only when the call is observed. */
interface ToolCallSettlement {
  readonly reporter: ToolFailureReporter;
  readonly tracker: OperationTracker;
  readonly attributes: OperationAttributes & { readonly "tool.id": string };
  readonly metrics?: ToolCallMetrics | undefined;
}

/** Records one incident; a throwing reporter is contained, because observation must never replace
 * the tool's own result or throw (the same rule `tool-audit.ts`'s `appendSafely` holds). */
function recordSafely({ reporter, required, options }: { reporter: ToolFailureReporter; required: Parameters<ToolFailureReporter["record"]>[0]; options: NonNullable<Parameters<ToolFailureReporter["record"]>[1]> }): string | undefined {
  try {
    return reporter.record(required, options).errorId;
  } catch {
    // A failing observer must neither gate the result nor leak its own exception text.
    return undefined;
  }
}

/** Metrics only for an observed call; the fixed `tool.calls`/`tool.failures` counters. */
function settleToolCallMetrics({ settlement, failureKind }: { settlement: ToolCallSettlement; failureKind: ToolFailureKind | undefined }): void {
  if (settlement.metrics) recordToolCallMetrics({ observability: settlement.metrics, toolId: settlement.attributes["tool.id"], failureKind });
}

/** A throw from below: an internal one is recorded with the ORIGINAL object, so a later boundary
 * recording the same object (the delegated route's describer) gets this id back and writes nothing.
 * The tracker is passed explicitly: the record runs after `tracker.run` has returned, so an
 * ambient span would be gone and the report would lose the operation's trace ids. */
function settleThrownToolCall({ error, settlement }: { error: unknown; settlement: ToolCallSettlement }): void {
  const { reporter, tracker, attributes } = settlement;
  // An unknown tool id throws ToolInputError: the same caller mistake as a validation failure.
  const errorKind = error instanceof ToolInputError ? "validation" : "internal";
  if (errorKind === "internal") {
    recordSafely({ reporter, required: { error, step: TOOL_STEP, operation: TOOL_CALL_OPERATION, tracker }, options: { attributes: { ...attributes, "tool.error_kind": errorKind } } });
  }
  endOnce({ tracker, verdict: { outcome: "threw", failed: true, attributes: { "tool.error_kind": errorKind } } });
  settleToolCallMetrics({ settlement, failureKind: errorKind === "validation" ? "input" : "internal" });
}

/** Records a failed or timed-out result and returns the result the caller sees. A failed result
 * already carries the id the redaction layer minted and put in the model's words, so the record is
 * written UNDER that id (trusted: it was stamped in-process by the layer below, never read from a
 * client). A timeout has no id yet, so the record mints one and the result is stamped with it for
 * the audit row and the delegated route to reuse. */
function reportResultFailure({ result, errorKind, settlement }: { result: ToolExecutionResult; errorKind: string | undefined; settlement: ToolCallSettlement }): ToolExecutionResult {
  if (errorKind !== "internal" && result.status !== "timed-out") return result;
  const { reporter, tracker, attributes } = settlement;
  const stamped = readToolErrorId({ result });
  // The text is what the layer below left: already redacted, so only redacted words are wrapped.
  const error = new ToolExecutionFailure(result.error ?? result.status);
  const recordAttributes = { ...attributes, "tool.execution_id": result.executionId, ...(errorKind ? { "tool.error_kind": errorKind } : {}) };
  const errorId = recordSafely({ reporter, required: { error, step: TOOL_STEP, operation: TOOL_CALL_OPERATION, tracker }, options: { ...(stamped ? { errorId: stamped } : {}), attributes: recordAttributes } });
  return stamped === undefined ? stampTimeout({ result, errorId }) : result;
}

/** A timed-out result gains the id its record was written under; a breached reporter leaves it as is. */
function stampTimeout({ result, errorId }: { result: ToolExecutionResult; errorId: string | undefined }): ToolExecutionResult {
  if (result.status !== "timed-out" || errorId === undefined) return result;
  const stamped: RedactedToolExecutionResult = { ...result, errorId };
  return stamped;
}

/** A settled result: record (denied, cancelled and validation results never record), end once, count. */
function settleToolResult({ result, settlement }: { result: ToolExecutionResult; settlement: ToolCallSettlement }): ToolExecutionResult {
  const errorKind = errorKindOf(result);
  const settled = reportResultFailure({ result, errorKind, settlement });
  const failed = FAILED_STATUSES.has(result.status);
  endOnce({ tracker: settlement.tracker, verdict: { outcome: result.status, failed, ...(errorKind ? { attributes: { "tool.error_kind": errorKind } } : {}) } });
  settleToolCallMetrics({ settlement, failureKind: failureKindOf(result) });
  return settled;
}

/**
 * Records one nested call's internal failure. A nested call goes straight to the bare executor
 * (`tool-executor-handler.ts`'s nested invoker), so it never passes {@link withToolCallObservability};
 * without this hook its failure would have an id in the parent's words and no record behind it.
 * No tracker is available here, so the report carries no explicit trace ids (documented limit).
 * @param required The already-redacted nested result and its fixed attributes.
 * @complexity O(1) plus the reporter's own cost.
 */
export function reportNestedFailure({ reporter, result, attributes }: { reporter: ToolFailureReporter; result: ToolExecutionResult; attributes: OperationAttributes }, _optional = {}): void {
  if (errorKindOf(result) !== "internal") return;
  const errorId = readToolErrorId({ result });
  recordSafely({ reporter, required: { error: new ToolExecutionFailure(result.error ?? result.status), step: NESTED_TOOL_STEP, operation: TOOL_CALL_OPERATION },
    options: { ...(errorId ? { errorId } : {}), attributes: { ...attributes, "tool.execution_id": result.executionId, "tool.error_kind": "internal" } } });
}

interface ToolCallObservation {
  readonly inner: ToolExecutor;
  readonly reporter: ToolFailureReporter;
  readonly observability?: ToolCallObservability | undefined;
  readonly isRegisteredTool?: IsRegisteredTool | undefined;
  readonly observabilityEnabled?: (() => boolean) | undefined;
}

/** One observed `execute`: the tracker is the noop one whenever the call is not observed, so the
 * record path below is identical with tracing on or off. */
async function observeToolCall({ observation, required, options }: { observation: ToolCallObservation; required: Parameters<ToolExecutor["execute"]>[0]; options: Parameters<ToolExecutor["execute"]>[1] }): Promise<ToolExecutionResult> {
  const { inner, reporter, observability, isRegisteredTool, observabilityEnabled } = observation;
  const attributes = { "tool.id": toolCallLabel({ toolId: required.toolId }, { isRegisteredTool }), "agent.run.id": required.run.id, "user.id": pseudonymousUserId({ principal: required.principal }) };
  const observed = observability !== undefined && (observabilityEnabled?.() ?? true);
  const tracker = observed ? startOperation({ observability, name: TOOL_CALL_OPERATION, attributes }) : NOOP_OPERATION_TRACKER;
  const settlement: ToolCallSettlement = { reporter, tracker, attributes, ...(observed ? { metrics: observability } : {}) };
  let result: ToolExecutionResult;
  try {
    result = await tracker.run(() => inner.execute(required, options));
  } catch (error) {
    settleThrownToolCall({ error, settlement });
    throw error;
  }
  return settleToolResult({ result, settlement });
}

/**
 * Wraps `inner` so each `execute` is one `tool.call` operation: `tool.id` (or the fixed
 * {@link UNREGISTERED_TOOL_LABEL}), `agent.run.id` and `user.id` (the principal, pseudonymous) at start,
 * the settled status as outcome, `tool.error_kind` (`validation` vs `internal`) for a failure, and
 * the duration the adapter measures between start and end. Execution errors (an internal failure, a
 * timeout, a non-input throw) also go through `reporter.record`, once, with the operation's tracker so
 * trace adapters attach them to its span. A validation failure is NOT reported: it is the caller (usually
 * the model) sending bad input — counted on the operation, but not an incident to page anyone for. A
 * denial and a cancellation are not recorded either: the system working as designed.
 * @param required The executor, the host reporter and the optional span/metric ports.
 * @param optional `isRegisteredTool`: the host's registry check; without it only the id's shape is checked.
 *   `observabilityEnabled`: the live tracing switch, which turns spans and metrics off but never recording.
 * @returns A drop-in `ToolExecutor`; results and throws pass through unchanged (except that a timed-out
 *   result gains its `errorId`); other methods delegate.
 * @complexity O(1) beyond `inner`'s own cost.
 */
export function withToolCallObservability({ inner, reporter, observability }: { inner: ToolExecutor; reporter: ToolFailureReporter; observability?: ToolCallObservability | undefined }, { isRegisteredTool, observabilityEnabled }: { isRegisteredTool?: IsRegisteredTool; observabilityEnabled?: () => boolean } = {}): ToolExecutor {
  const observation: ToolCallObservation = { inner, reporter, observability, isRegisteredTool, observabilityEnabled };
  return decorateToolExecutor({ inner, execute: (required, options = {}) => observeToolCall({ observation, required, options }) });
}
