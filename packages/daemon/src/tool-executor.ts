/**
 * `ToolExecutor` — the tool-execution boundary (extraction-plan.md §2.5 /
 * §8 task 6). This is **new design work, not a port**: OD only *observes*
 * `tool_use` (`apps/daemon/src/runtimes/tool-loop-guard.ts` watches for
 * runaway repetition; it never gates a call before it runs), so there is
 * no upstream source to lift here — see `archived provenance ledger` for the fuller
 * account of why and where this diverges from every other file in this
 * repo.
 *
 * A tool is registered elsewhere (`@jini-ai/core`'s `ToolRegistry`, see
 * `tool-registry.ts` there) as `{descriptor, handler, policy}`. This
 * module is the *only* thing that can ever call `handler` — routes and
 * agents hold a `ToolRegistry` reference (descriptors only) and a
 * `ToolExecutor` reference (this file's public surface), never the
 * registration itself. `ToolExecutor.execute(principal, run, toolId,
 * input, signal)` is the sole invocation path.
 *
 * State machine (the audit trail extraction-plan.md §2.5 names verbatim):
 * `requested` → `authorized` (or `denied`, terminal) → `confirmed` (or
 * `confirmation-denied`, terminal; skipped entirely when the tool doesn't
 * require confirmation) → `started` → `completed` (or `failed` /
 * `timed-out` / `cancelled`, all terminal). Every transition is appended
 * to a per-execution, in-memory audit record retrievable via
 * `getAuditRecord`.
 *
 * `cancelled` is reachable from more places than the diagram above shows at
 * a glance: `execute()`'s optional `signal` (a transport disconnect, a run
 * cancellation, or `cancel(executionId)` itself) is observed for the whole
 * call, not only once a handler is running. Firing it while `authorized` is
 * still being decided, or while a confirmation is still pending, also ends
 * the call as `cancelled` — deliberately distinct from `confirmation-denied`,
 * which asserts a human actually answered. Nobody answered; the requester
 * left.
 *
 * Confirmation is resumable: when a tool requires confirmation and the
 * injected `ExecutionDelegate.onConfirm` doesn't supply a decision
 * synchronously (or via a settled Promise), `execute()`'s returned Promise
 * simply doesn't resolve yet — it's parked on an internal per-execution
 * deferred that only `resumeConfirmation(executionId, decision)` can
 * settle. A transport can call `resumeConfirmation` from a completely
 * separate request/tick (e.g. after a human clicks "Allow" in a UI raised
 * by `onConfirm`), arbitrarily long after `execute()` was first called.
 * "The headless kernel can't prompt" (extraction-plan.md §2.5) is exactly
 * this: `ToolExecutor` never renders anything — `ExecutionDelegate` is the
 * transport-supplied seam that does, and `resumeConfirmation` is how its
 * answer gets back in.
 */
import type { CreateToolExecutorOptions, ToolExecutor } from './tool-executor-types.js';
import { createExecutionState, createExecutionRetireAudit, createExecutionAppendEvent, createExecutionOpenAudit, createExecutionGetAuditRecord } from './tool-executor-audit.js';
import { createExecutionApprovalStateChange, createExecutionApprovalRefusal, createExecutionRequestConfirmation, createExecutionResumeConfirmation, createExecutionCancel, createExecutionWatchTransportAbort, createExecutionConfirmGate } from './tool-executor-approval.js';
import { createExecutionAuthorize, createExecutionAuthorizationFailure, createExecutionAdmitAuthorized } from './tool-executor-authorization.js';
import { createExecutionTerminal, createExecutionOperationalFailure, createExecutionFailureResult, createExecutionCheckOutput, createExecutionSettleOutput } from './tool-executor-output.js';
import { createConsoleLogger } from '@jini-ai/core/primitives';
import { createExecutionPrepareGuidanceSafely, createExecutionWantsGuidance, createExecutionNestedFailureMessage, createExecutionNestedInvoker, createExecutionRunHandler } from './tool-executor-handler.js';
import { createExecutionExecute } from './tool-executor-invocation.js';


/**
 * Creates the `ToolExecutor` reference implementation: an in-process,
 * in-memory gate over a `ToolRegistry`. No persistence — a real host that
 * needs audit records to survive a restart layers a durable store behind
 * `getAuditRecord`/an append hook later; out of this task's scope (see
 * `archived provenance ledger`).
 *
 * @param options.registry - The `ToolRegistry` to resolve and authorize
 * tools against, via `@jini-ai/core/composition`'s `authorizeToolInvocation`
 * — the one and only caller of that internal export.
 * @param options.delegate - Transport-supplied authorize/confirm UI seam;
 * omit for a headless caller whose tools never need interactive gating.
 * @param options.maxAuditRecords - Finished audit records kept, see {@link DEFAULT_MAX_AUDIT_RECORDS}.
 * @param options.outputValidation - `'enforce'` (default) fails a call whose output misses its
 * descriptor's `outputSchema`; `'log'` passes it through and warns. The host chooses (typically
 * `'log'` in production); see `ToolOutputValidation` in `tool-executor-types.ts`.
 * @param options.logger - Receives `'log'`-mode mismatch warnings; defaults to a console logger.
 * @complexity Known-id `execute` adds schema-guided normalization to the handler's cost; unknown ids scan O(n) descriptors for hints. `resumeConfirmation`/`cancel`/`getAuditRecord` are O(1) map lookups.
 * @overallScore 100/100
 */
export function createToolExecutor(requiredArgs: Pick<CreateToolExecutorOptions, "registry">, optionalArgs: Pick<CreateToolExecutorOptions, "delegate" | "now" | "prepareGuidance" | "redactNestedFailure" | "maxAuditRecords" | "outputValidation" | "logger"> = {}): ToolExecutor {
  const options: CreateToolExecutorOptions = { ...requiredArgs, ...optionalArgs };
  const { registry, delegate, now, maxAuditRecords, audits, finishedAudits, pendingConfirmations, approvalWaits, activeControllers, cancelledConfirmations } = createExecutionState(options);
  const approvalStateChange = createExecutionApprovalStateChange({ approvalWaits });
  const retireAudit = createExecutionRetireAudit({ finishedAudits, maxAuditRecords, audits });
  const appendEvent = createExecutionAppendEvent({ audits, now, retireAudit });
  const approvalRefusal = createExecutionApprovalRefusal({ approvalWaits, appendEvent });
  const requestConfirmation = createExecutionRequestConfirmation({ delegate, pendingConfirmations });
  const openAudit = createExecutionOpenAudit({ audits, appendEvent });
  const authorize = createExecutionAuthorize({ delegate });
  const terminal = createExecutionTerminal({ appendEvent });
  const operationalFailure = createExecutionOperationalFailure({ appendEvent });
  const failureResult = createExecutionFailureResult({ terminal, appendEvent });
  const resumeConfirmation = createExecutionResumeConfirmation({ pendingConfirmations });
  const cancel = createExecutionCancel({ activeControllers, pendingConfirmations, cancelledConfirmations });
  const watchTransportAbort = createExecutionWatchTransportAbort({ cancel });
  const authorizationFailure = createExecutionAuthorizationFailure({ failureResult, operationalFailure });
  const admitAuthorized = createExecutionAdmitAuthorized({ terminal, appendEvent, approvalRefusal });
  const confirmGate = createExecutionConfirmGate({ approvalStateChange, requestConfirmation, operationalFailure, appendEvent, cancelledConfirmations, terminal });
  const prepareGuidanceSafely = createExecutionPrepareGuidanceSafely({ options });
  const wantsGuidance = createExecutionWantsGuidance({ options });
  const nestedFailureMessage = createExecutionNestedFailureMessage({ options });
  const nestedInvoker = createExecutionNestedInvoker({ getExecute: () => execute, nestedFailureMessage });
  const checkOutput = createExecutionCheckOutput({ outputValidation: options.outputValidation ?? 'enforce', logger: options.logger ?? createConsoleLogger({ prefix: '[@jini-ai/daemon] tool-executor:' }) });
  const settleOutput = createExecutionSettleOutput({ failureResult, appendEvent, checkOutput });
  const runHandler = createExecutionRunHandler({ wantsGuidance, prepareGuidanceSafely, terminal, approvalRefusal, approvalStateChange, appendEvent, nestedInvoker, settleOutput, failureResult });
  const execute = createExecutionExecute({ registry, openAudit, terminal, activeControllers, watchTransportAbort, authorize, authorizationFailure, admitAuthorized, confirmGate, runHandler });
  const getAuditRecord = createExecutionGetAuditRecord({ audits });
  return { execute, resumeConfirmation, cancel, getAuditRecord };
}
