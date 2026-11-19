import type { ToolRegistry, Principal, RunRef, SurfaceEmitter } from '@jini-ai/core';
import type { createExecutionOpenAudit } from './tool-executor-audit.js';
import type { createExecutionTerminal } from './tool-executor-output.js';
import type { createExecutionWatchTransportAbort, createExecutionConfirmGate } from './tool-executor-approval.js';
import { type createExecutionAuthorize, type createExecutionAuthorizationFailure, type createExecutionAdmitAuthorized, assertKnownTool } from './tool-executor-authorization.js';
import type { createExecutionRunHandler } from './tool-executor-handler.js';
import type { ExecutorExecute, ToolExecutionResult } from './tool-executor-types.js';


export function createExecutionExecute({ registry, openAudit, terminal, activeControllers, watchTransportAbort, authorize, authorizationFailure, admitAuthorized, confirmGate, runHandler }: { registry: ToolRegistry; openAudit: ReturnType<typeof createExecutionOpenAudit>; terminal: ReturnType<typeof createExecutionTerminal>; activeControllers: Map<string, AbortController>; watchTransportAbort: ReturnType<typeof createExecutionWatchTransportAbort>; authorize: ReturnType<typeof createExecutionAuthorize>; authorizationFailure: ReturnType<typeof createExecutionAuthorizationFailure>; admitAuthorized: ReturnType<typeof createExecutionAdmitAuthorized>; confirmGate: ReturnType<typeof createExecutionConfirmGate>; runHandler: ReturnType<typeof createExecutionRunHandler> }): ExecutorExecute {
  async function execute({ principal, run, toolId, input }: { readonly principal: Principal; readonly run: RunRef; readonly toolId: string; readonly input: unknown }, { signal, emitSurface, invocationRegistry = registry, requireConfirmation }: { readonly signal?: AbortSignal; readonly emitSurface?: SurfaceEmitter; readonly invocationRegistry?: ToolRegistry; readonly requireConfirmation?: true } = {}
  ): Promise<ToolExecutionResult> {
    // Existence is checked separately from — and before — authorization so the audit record can
    // be opened before the (possibly slow, possibly throwing) authorization gate runs, matching
    // pre-authorizeToolInvocation timing: `requested` used to precede `policy.authorize`, and a
    // policy that hangs or throws used to still leave a record behind. `has()` only confirms
    // existence, never returns a handler, so this doesn't reopen the leak authorizeToolInvocation
    // closed — that gate still runs, still unconditionally, inside the call below.
    assertKnownTool({ registry: invocationRegistry, toolId });

    const executionId = openAudit(principal, run, toolId);

    // Observes `signal` for this execution's ENTIRE remaining lifetime, not just the handler-run
    // phase. `requestConfirmation()`'s wait below is unbounded — it settles only when a human
    // answers or `resumeConfirmation`/`cancel` is called — so a transport disconnect or run-cancel
    // that only reached a handler-phase `AbortController` (this file's previous design) had no way
    // to end a still-parked confirmation; `execute()` simply never settled. Routed through the
    // existing `cancel(executionId)` rather than a bespoke handler, so every trigger — an explicit
    // `cancel()` call, a run cancellation, and now a transport disconnect — resolves a pending
    // confirmation and an in-flight handler the exact same way.
    if (signal?.aborted) return terminal({ executionId, status: 'cancelled' });
    const controller = new AbortController();
    activeControllers.set(executionId, controller);
    // `signal` doesn't need linking in `runHandler` — the listener registered here reaches this
    // controller via `cancel()`'s `activeControllers` branch as soon as `activeControllers.set`
    // ran. A second direct link (this file used to have one, `linkAbortSignal`) was redundant for
    // that phase and, worse, gave the impression `signal` was fully handled when it was only wired
    // to the phase after the one that actually needed it. Register here so cancellation also
    // survives the microtask gap after confirmation settles and before `runHandler()` starts.
    const detachTransportAbort = watchTransportAbort({ executionId, signal });
    const cleanupCancellation = () => {
      detachTransportAbort();
      activeControllers.delete(executionId);
    };

    // Both gates below can throw on INFRASTRUCTURE failure — a policy that rejects, a confirmation
    // transport that drops. Those throws used to escape `execute` entirely, which cost two things:
    // the audit record stayed open forever at `requested`/`authorized` with no terminal transition
    // (the comment above only ever guarded against leaving NO record, not against leaving an
    // unfinished one), and the raw exception text travelled outward to become tool-result content
    // an agent reads — an authorization or transport internal surfaced to the model verbatim.
    //
    // Recorded terminal and returned as `failed` with a fixed message. `failed` is the right state:
    // this execution ended, and it ended for an operational reason rather than a decision. The real
    // exception stays server-side. Deliberately narrower than the `unknown tool` throw above, which
    // stays a typed input-error throw because no tool execution exists to settle.
    let resolved: Awaited<ReturnType<typeof authorize>>;
    try {
      resolved = await authorize({ principal, run, toolId, input, registry: invocationRegistry });
    } catch (error) {
      cleanupCancellation();
      return authorizationFailure({ executionId, error });
    }
    // `invocationRegistry.has({ toolId })` above already confirmed the tool exists, and `ToolRegistry` is
    // append-only (no unregister — see `createToolRegistry`'s doc), so `authorizeToolInvocation`
    // resolving the same `toolId` against the same `registry` cannot come back `undefined` here.
    const gate = admitAuthorized({ executionId, resolved: resolved!, signal: controller.signal, run });
    if ('refusal' in gate) {
      cleanupCancellation();
      return gate.refusal;
    }
    const admitted = gate.allowed;
    const { descriptor } = admitted;
    if (descriptor.requiresConfirmation || requireConfirmation) {
      const declined = await confirmGate({ executionId, principal, run, tool: descriptor, input: admitted.input });
      if (declined) {
        cleanupCancellation();
        return declined;
      }
    }
    const result = await runHandler({ executionId, controller, principal, run, toolId, input: admitted.input, descriptor, handler: admitted.handler, normalizationNotes: admitted.normalizationNotes, invocationRegistry }, { emitSurface });
    cleanupCancellation();
    return result;
  }
  return execute;
}
