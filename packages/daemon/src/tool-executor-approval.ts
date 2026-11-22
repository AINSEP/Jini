import { type RunRef, type ToolDescriptor, isReadOnlyTool } from '@jini-ai/core';
import type { createExecutionAppendEvent } from './tool-executor-audit.js';
import type { ToolExecutionResult, ExecutionDelegate, ConfirmationDecision, ToolConfirmationRequest } from './tool-executor-types.js';
import type { createExecutionOperationalFailure, createExecutionTerminal } from './tool-executor-output.js';


export function createExecutionApprovalStateChange({ approvalWaits }: { approvalWaits: Map<string, Map<string, string>> }) {
  /** Records only actual human waits; terminal decisions and aborts release the run's write block.
   * @complexity O(1) time/space per pending execution; empty run entries are removed. */
  function approvalStateChange(
    { run, executionId, toolId, pending }: { run: RunRef; executionId: string; toolId: string; pending: boolean },
    _optional = {},
  ): void {
    if (pending) {
      const waits = approvalWaits.get(run.id) ?? new Map<string, string>();
      waits.set(executionId, toolId);
      approvalWaits.set(run.id, waits);
      return;
    }
    const waits = approvalWaits.get(run.id);
    waits?.delete(executionId);
    if (waits?.size === 0) approvalWaits.delete(run.id);
  }
  return approvalStateChange;
}

export function createExecutionApprovalRefusal({ approvalWaits, appendEvent }: { approvalWaits: Map<string, Map<string, string>>; appendEvent: ReturnType<typeof createExecutionAppendEvent> }) {
  /** Refuses writes using the registered read-only contract, never a model's claim.
   * The validation result reaches every delegated transport as an actionable error, without
   * resolving or approving the original call. @complexity O(1) time/space. */
  function approvalRefusal(
    { executionId, run, descriptor }: { executionId: string; run: RunRef; descriptor: ToolDescriptor },
    _optional = {},
  ): ToolExecutionResult | undefined {
    const pendingToolId = approvalWaits.get(run.id)?.values().next().value;
    if (pendingToolId === undefined || isReadOnlyTool({ descriptor })) return undefined;
    const error = JSON.stringify({
      status: 'awaiting_approval', started: false, toolId: descriptor.id, pendingToolId,
      message: 'Another action is waiting for human confirmation and has not started. This write was refused. Reads may continue. Never say an action has started until its tool result explicitly says it started.',
    });
    appendEvent(executionId, 'failed', error);
    return { executionId, status: 'failed', errorKind: 'validation', error };
  }
  return approvalRefusal;
}

export function createExecutionRequestConfirmation({ delegate, pendingConfirmations }: { delegate: ExecutionDelegate; pendingConfirmations: Map<string, (decision: ConfirmationDecision) => void> }) {
  function requestConfirmation(request: ToolConfirmationRequest): Promise<ConfirmationDecision> {
    if (delegate.onConfirm) {
      const result = delegate.onConfirm(request);
      if (result !== undefined) {
        return Promise.resolve(result);
      }
    }
    return new Promise<ConfirmationDecision>((resolve) => {
      pendingConfirmations.set(request.executionId, resolve);
    });
  }
  return requestConfirmation;
}

export function createExecutionResumeConfirmation({ pendingConfirmations }: { pendingConfirmations: Map<string, (decision: ConfirmationDecision) => void> }) {
  function resumeConfirmation({ executionId, decision }: { readonly executionId: string; readonly decision: ConfirmationDecision }): void {
    const resolve = pendingConfirmations.get(executionId);
    if (!resolve) {
      throw new Error(`ToolExecutor: no pending confirmation for execution "${executionId}"`);
    }
    pendingConfirmations.delete(executionId);
    resolve(decision);
  }
  return resumeConfirmation;
}

export function createExecutionCancel({ activeControllers, pendingConfirmations, cancelledConfirmations }: { activeControllers: Map<string, AbortController>; pendingConfirmations: Map<string, (decision: ConfirmationDecision) => void>; cancelledConfirmations: Set<string> }) {
  function cancel({ executionId }: { readonly executionId: string }): void {
    const controller = activeControllers.get(executionId);
    if (controller) {
      controller.abort();
    }
    // The controller also exists while confirmation is pending; aborting must still unblock it.
    const resolve = pendingConfirmations.get(executionId);
    if (resolve) {
      pendingConfirmations.delete(executionId);
      cancelledConfirmations.add(executionId);
      resolve('deny');
    }
  }
  return cancel;
}

export function createExecutionWatchTransportAbort({ cancel }: { cancel: ReturnType<typeof createExecutionCancel> }) {
  /**
   * Routes a transport `signal` firing into `cancel(executionId)` and returns the function that
   * detaches it again. A no-op pair when the transport supplied no signal.
   */
  function watchTransportAbort({ executionId, signal }: { executionId: string; signal: AbortSignal | undefined }): () => void {
    if (!signal) return () => undefined;
    const onTransportAbort = () => cancel({ executionId: executionId });
    signal.addEventListener('abort', onTransportAbort, { once: true });
    return () => signal.removeEventListener('abort', onTransportAbort);
  }
  return watchTransportAbort;
}

export function createExecutionConfirmGate({ approvalStateChange, requestConfirmation, operationalFailure, appendEvent, cancelledConfirmations, terminal }: { approvalStateChange: ReturnType<typeof createExecutionApprovalStateChange>; requestConfirmation: ReturnType<typeof createExecutionRequestConfirmation>; operationalFailure: ReturnType<typeof createExecutionOperationalFailure>; appendEvent: ReturnType<typeof createExecutionAppendEvent>; cancelledConfirmations: Set<string>; terminal: ReturnType<typeof createExecutionTerminal> }) {
  /**
   * Runs the confirmation gate: `undefined` once confirmed (recorded), otherwise the terminal result.
   *
   * Only ever awaited on the confirmation path. It was once kept inline in `execute()` because
   * hoisting it into an `async` function that every call awaited added microtask ticks to the
   * *un*-confirmed path too, and callers observe that timing — a test cancels an in-flight
   * execution after a fixed number of ticks and needs the handler to have already started by then.
   * `execute()` awaits this only inside its `requiresConfirmation` branch, so the un-confirmed path
   * keeps its tick count, and `requestConfirmation()` still runs synchronously on entry.
   */
  async function confirmGate(request: ToolConfirmationRequest): Promise<ToolExecutionResult | undefined> {
    const { executionId } = request;
    let confirmation: ConfirmationDecision;
    const state = { run: request.run, executionId, toolId: request.tool.id };
    try {
      approvalStateChange({ ...state, pending: true });
      confirmation = await requestConfirmation(request);
    } catch {
      // Same reasoning as the authorization gate: terminal, recorded, and generic.
      return operationalFailure({ executionId, error: 'confirmation failed' });
    } finally {
      approvalStateChange({ ...state, pending: false });
    }
    if (confirmation === 'confirm') {
      appendEvent(executionId, 'confirmed');
      return undefined;
    }
    // `cancel(executionId)` (called directly, or via the transport-abort listener) resolves a
    // pending confirmation the same way a human `deny` does, but the two are not the same OUTCOME:
    // `confirmation-denied` asserts a decision was made, which is false when the requester vanished
    // before answering. `cancelledConfirmations` distinguishes them so the audit trail never
    // reports a decision nobody made.
    if (cancelledConfirmations.delete(executionId)) return terminal({ executionId, status: 'cancelled' });
    return terminal({ executionId, status: 'confirmation-denied' });
  }
  return confirmGate;
}
