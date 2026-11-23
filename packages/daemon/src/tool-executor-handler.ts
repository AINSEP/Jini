import { APPROVAL_WAIT_TIMEOUT_MS, type SurfaceEmitter, type Principal, type RunRef, type ToolDescriptor, type ToolRegistry, type ToolExecutionOptions, ToolInputError } from '@jini-ai/core';
import type { CreateToolExecutorOptions, ToolExecutionResult, ExecutorExecute, AdmittedCall } from './tool-executor-types.js';
import type { createExecutionTerminal, createExecutionSettleOutput, createExecutionFailureResult } from './tool-executor-output.js';
import type { createExecutionApprovalRefusal, createExecutionApprovalStateChange } from './tool-executor-approval.js';
import type { createExecutionAppendEvent } from './tool-executor-audit.js';


/**
 * Arms the descriptor's execution timeout, if it declares one. The returned `timedOut()` reports
 * whether the timer (rather than an external cancel) was what aborted the controller, which is
 * what distinguishes a `timed-out` result from a `cancelled` one.
 */
function startTimeout(
  controller: AbortController,
  timeoutMs: number | undefined,
) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let waiting = false;
  let approvalWindowUsed = false;
  let remaining = timeoutMs;
  let started = Date.now();
  const stop = () => {
    if (handle === undefined) return;
    clearTimeout(handle);
    handle = undefined;
  };
  const arm = (duration: number | undefined) => {
    stop();
    started = Date.now();
    if (duration === undefined) return;
    handle = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
    handle.unref?.();
  };
  arm(remaining);
  return {
    stop,
    timedOut: () => timedOut,
    /** Human waiting is bounded independently and cannot replenish the execution budget.
     * Duplicate progress frames cannot extend either deadline. */
    approval: ({ pending }: { pending: boolean }) => {
      if (pending === waiting || controller.signal.aborted) return;
      if (pending && approvalWindowUsed) return;
      if (pending) approvalWindowUsed = true;
      if (pending && remaining !== undefined) remaining = Math.max(0, remaining - (Date.now() - started));
      waiting = pending;
      arm(pending ? APPROVAL_WAIT_TIMEOUT_MS : remaining);
    },
  };
}

/** `{ emitSurface }` when the transport supplied one, else `{}` — see `runHandler` for why it is never defaulted. */
function surfaceOption(emitSurface: SurfaceEmitter | undefined): { emitSurface?: SurfaceEmitter } {
  return emitSurface !== undefined ? { emitSurface } : {};
}

export function createExecutionPrepareGuidanceSafely({ options }: { options: CreateToolExecutorOptions }) {
  /** Advisory guidance for an authorized call. A failure is fail-open: it yields no guidance. */
  async function prepareGuidanceSafely(
    { principal, run, tool, signal }: { principal: Principal; run: RunRef; tool: ToolDescriptor; signal: AbortSignal },
    { emitSurface }: { emitSurface?: SurfaceEmitter | undefined },
  ): Promise<string> {
    try {
      return await options.prepareGuidance!({ principal, run, tool, signal,
        ...(emitSurface ? { emitSurface } : {}) }, {});
    } catch {
      // Guidance availability must never convert an authorized write into a tool failure.
      return '';
    }
  }
  return prepareGuidanceSafely;
}

export function createExecutionWantsGuidance({ options }: { options: CreateToolExecutorOptions }) {
  /** Whether `prepareGuidance` applies to this tool — checked synchronously so the no-guidance path adds no tick. */
  function wantsGuidance(descriptor: ToolDescriptor): boolean {
    return Boolean(options.prepareGuidance && descriptor.metadata?.guidanceCapabilities?.length);
  }
  return wantsGuidance;
}

export function createExecutionNestedFailureMessage({ options }: { options: CreateToolExecutorOptions }) {
  /** The message a nested call's caller sees for a result that did not complete. */
  function nestedFailureMessage(
    { result, toolId, run, principal }: { result: ToolExecutionResult; toolId: string; run: RunRef; principal: Principal },
    _optional = {},
  ): string {
    // `failed` results always carry `error` (and only they carry `errorKind`); the bare terminal
    // statuses carry none, so they are named by tool id and status instead.
    // Use the host's secret-only redaction and error id when supplied. Otherwise withhold
    // internal paths or SQL before a batch copies this message into its results.
    return result.errorKind === 'internal'
      ? options.redactNestedFailure?.({ result, toolId, runId: run.id, principalId: principal.id })
        ?? `${toolId} failed on the server. The cause is withheld because it can contain internal paths; it is in the audit log under execution ${result.executionId}.`
      : result.error ?? `${toolId}: ${result.status}`;
  }
  return nestedFailureMessage;
}

export function createExecutionNestedInvoker({ getExecute, nestedFailureMessage }: { getExecute: () => ExecutorExecute; nestedFailureMessage: ReturnType<typeof createExecutionNestedFailureMessage> }) {
  /** The handler's `invokeTool` port: a nested call through this same executor and its gates. */
  function nestedInvoker(
    { principal, run, toolId, invocationRegistry, signal }: { principal: Principal; run: RunRef; toolId: string; invocationRegistry: ToolRegistry; signal: AbortSignal },
    { emitSurface }: { emitSurface?: SurfaceEmitter | undefined },
  ): NonNullable<ToolExecutionOptions['invokeTool']> {
    return async ({ toolId: nestedToolId, input: nestedInput }, { registry: nestedRegistry = invocationRegistry } = {}) => {
      const selectedRegistry = nestedToolId === toolId || invocationRegistry.has({ toolId: nestedToolId }) ? invocationRegistry : nestedRegistry;
      const result = await getExecute()({ principal, run, toolId: nestedToolId, input: nestedInput }, { signal, ...surfaceOption(emitSurface), invocationRegistry: selectedRegistry });
      if (result.status === 'completed') return result.output;
      const message = nestedFailureMessage({ result, toolId: nestedToolId, run, principal });
      throw result.errorKind === 'validation' ? new ToolInputError({ message }) : new Error(message);
    };
  }
  return nestedInvoker;
}

export function createExecutionRunHandler({ wantsGuidance, prepareGuidanceSafely, terminal, approvalRefusal, approvalStateChange, appendEvent, nestedInvoker, settleOutput, failureResult }: { wantsGuidance: ReturnType<typeof createExecutionWantsGuidance>; prepareGuidanceSafely: ReturnType<typeof createExecutionPrepareGuidanceSafely>; terminal: ReturnType<typeof createExecutionTerminal>; approvalRefusal: ReturnType<typeof createExecutionApprovalRefusal>; approvalStateChange: ReturnType<typeof createExecutionApprovalStateChange>; appendEvent: ReturnType<typeof createExecutionAppendEvent>; nestedInvoker: ReturnType<typeof createExecutionNestedInvoker>; settleOutput: ReturnType<typeof createExecutionSettleOutput>; failureResult: ReturnType<typeof createExecutionFailureResult> }) {
  /**
   * Prepares guidance, arms the timeout and runs the handler. Runs synchronously up to the handler
   * call when no guidance applies, so the handler has started by the time `execute()`'s caller
   * observes the same tick count as before this was extracted.
   */
  async function runHandler(call: AdmittedCall, { emitSurface }: { emitSurface?: SurfaceEmitter | undefined }): Promise<ToolExecutionResult> {
    const { executionId, controller, principal, run, input, descriptor, handler, normalizationNotes } = call;
    const guidance = wantsGuidance(descriptor)
      ? await prepareGuidanceSafely({ principal, run, tool: descriptor, signal: controller.signal }, { emitSurface })
      : '';
    if (controller.signal.aborted) {
      return terminal({ executionId, status: 'cancelled' });
    }
    // Guidance may await I/O after admission; another call can open a confirmation in that gap.
    const refusal = approvalRefusal({ executionId, run, descriptor });
    if (refusal) return refusal;
    const timeout = startTimeout(controller, descriptor.timeoutMs);

    // Cleanup (clear the timeout) is repeated at
    // each return below rather than centralized in a `finally` — a
    // try/finally here produced a synthetic "abrupt completion" branch
    // istanbul/v8 instruments for the finally block itself, which is
    // unreachable in practice (every path through the try/catch below
    // returns normally; nothing here can throw a *second* exception past
    // the catch). Repeating one call avoids leaving an uncoverable branch
    // behind instead of writing a contrived test or suppressing it.
    const cleanup = () => {
      timeout.stop();
      approvalStateChange({ run, executionId, toolId: call.toolId, pending: false });
    };
    appendEvent(executionId, 'started');
    try {
      // `emitSurface` is spread in only when the transport supplied one, so a handler can test
      // `options.emitSurface` and get a truthful answer about whether a surface it emits would actually
      // reach anybody. An always-present no-op would read as "yes" and let a handler park forever.
      const rawOutput = await handler({
        executionId,
        principal,
        run,
        input,
        signal: controller.signal,
      }, {
        ...surfaceOption(emitSurface),
        onApprovalStateChange: ({ pending, decision }) => {
          // The tab owns human confirmation; retain its outcome without opening a chat surface.
          if (decision) appendEvent(executionId, 'approval-recorded', `frontend approval: ${decision}`);
          timeout.approval({ pending });
          approvalStateChange({ run, executionId, toolId: call.toolId, pending });
        },
        invokeTool: nestedInvoker({ principal, run, toolId: call.toolId, invocationRegistry: call.invocationRegistry, signal: controller.signal }, { emitSurface }),
      });
      cleanup();
      return settleOutput({ executionId, runId: run.id, rawOutput, descriptor, timedOut: timeout.timedOut(), aborted: controller.signal.aborted }, { guidance, normalizationNotes });
    } catch (err) {
      cleanup();
      return failureResult({ executionId, err, timedOut: timeout.timedOut(), aborted: controller.signal.aborted }, { normalizationNotes, guidance });
    }
  }
  return runHandler;
}
