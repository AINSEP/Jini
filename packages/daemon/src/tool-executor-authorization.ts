import { type ToolRegistry, ToolInputError, type Principal, type RunRef, ToolInputNormalizationError } from '@jini-ai/core';
import { toolCandidates } from './core/tool-candidates.js';
import type { ExecutionDelegate, ToolExecutionResult, AllowedInvocation } from './tool-executor-types.js';
import { authorizeToolInvocation, type ToolInvocationAuthorization } from '@jini-ai/core/composition';
import type { createExecutionFailureResult, createExecutionOperationalFailure, createExecutionTerminal } from './tool-executor-output.js';
import type { createExecutionAppendEvent } from './tool-executor-audit.js';
import type { createExecutionApprovalRefusal } from './tool-executor-approval.js';


/** Throws the typed unknown-tool input error, naming up to eight similarity-ranked registrations.
 * This never dispatches an alternate tool. */
export function assertKnownTool({ registry: invocationRegistry, toolId }: { registry: ToolRegistry; toolId: string }): void {
  if (invocationRegistry.has({ toolId })) return;
  const candidates = toolCandidates({ toolId, tools: invocationRegistry.list({}) });
  const hint = candidates.length > 0 ? `; did you mean ${candidates.join(', ')}?` : '';
  throw new ToolInputError({ message: `ToolExecutor: unknown tool "${toolId}"${hint}` });
}

export function createExecutionAuthorize({ delegate }: { delegate: ExecutionDelegate }) {
  function authorize({ principal, run, toolId, input, registry }: { principal: Principal; run: RunRef; toolId: string; input: unknown; registry: ToolRegistry }) {
    // `.bind(delegate)` rather than passing the bare method reference: `ExecutionDelegate` is
    // declared with method syntax, so a host may legitimately implement it as a class instance
    // whose `onAuthorize` reads `this`. Handing the detached function to `@jini-ai/core` would
    // call it with `this` bound to the wrapper object, and a `this`-using veto would throw a
    // TypeError out of `execute()` instead of returning a decision. Re-read per call (not hoisted
    // to `createToolExecutor`) so a delegate that gains `onAuthorize` after construction still
    // gets consulted, matching the pre-`authorizeToolInvocation` behaviour.
    const onAuthorize = delegate.onAuthorize?.bind(delegate);
    return authorizeToolInvocation({ registry: registry, toolId: toolId, principal: principal, run: run, input: input }, onAuthorize === undefined ? {} : { delegate: { onAuthorize } }
    );
  }
  return authorize;
}

export function createExecutionAuthorizationFailure({ failureResult, operationalFailure }: { failureResult: ReturnType<typeof createExecutionFailureResult>; operationalFailure: ReturnType<typeof createExecutionOperationalFailure> }) {
  /** Terminal result for an authorization gate that threw, keeping a typed normalization error's message. */
  function authorizationFailure({ executionId, error }: { executionId: string; error: unknown }): ToolExecutionResult {
    if (error instanceof ToolInputNormalizationError) return failureResult({ executionId, err: error, timedOut: false, aborted: false });
    return operationalFailure({ executionId, error: 'authorization failed' });
  }
  return authorizationFailure;
}

export function createExecutionAdmitAuthorized({ terminal, appendEvent, approvalRefusal }: { terminal: ReturnType<typeof createExecutionTerminal>; appendEvent: ReturnType<typeof createExecutionAppendEvent>; approvalRefusal: ReturnType<typeof createExecutionApprovalRefusal> }) {
  /**
   * Acts on the authorization outcome synchronously: `{ refusal }` if the call ends here
   * (cancelled meanwhile, or denied), otherwise records `authorized` and returns `{ allowed }`.
   */
  function admitAuthorized(
    { executionId, resolved, signal, run }: { executionId: string; resolved: ToolInvocationAuthorization; signal: AbortSignal | undefined; run: RunRef },
  ): { readonly refusal: ToolExecutionResult } | { readonly allowed: AllowedInvocation } {
    // `authorize()` isn't itself signal-aware — it's typically a fast policy check, not a
    // human-in-the-loop wait — so this is a post-await check rather than a mid-flight abort, the
    // same idiom the post-handler check below already uses: a signal that fired while `authorize()`
    // was in flight is caught here, before its (now-moot) decision is acted on.
    if (signal?.aborted) return { refusal: terminal({ executionId, status: 'cancelled' }) };
    if (resolved.decision !== 'allow') return { refusal: terminal({ executionId, status: 'denied' }) };
    const { normalizationNotes } = resolved;
    appendEvent(executionId, 'authorized', normalizationNotes.length ? `normalized: ${normalizationNotes.join('; ')}` : undefined);
    // Check after authorization awaits: an approval may have opened while this policy was pending.
    const refusal = approvalRefusal({ executionId, run, descriptor: resolved.descriptor });
    if (refusal) return { refusal };
    return { allowed: resolved };
  }
  return admitAuthorized;
}
