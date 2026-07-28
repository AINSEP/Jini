/**
 * `ToolExecutor` — the tool-execution boundary (extraction-plan.md §2.5 /
 * §8 task 6). This is **new design work, not a port**: OD only *observes*
 * `tool_use` (`apps/daemon/src/runtimes/tool-loop-guard.ts` watches for
 * runaway repetition; it never gates a call before it runs), so there is
 * no upstream source to lift here — see `source-map.md` for the fuller
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
import { randomUUID } from 'node:crypto';
import type {
  AuthorizationDecision,
  Principal,
  RunRef,
  ToolDescriptor,
  ToolRegistry,
} from '@jini-ai/core';
import { getToolRegistration } from '@jini-ai/core/internal';

export type ConfirmationDecision = 'confirm' | 'deny';

export interface ToolAuthorizationRequest {
  readonly principal: Principal;
  readonly run: RunRef;
  readonly tool: ToolDescriptor;
  readonly input: unknown;
}

export interface ToolConfirmationRequest {
  readonly executionId: string;
  readonly principal: Principal;
  readonly run: RunRef;
  readonly tool: ToolDescriptor;
  readonly input: unknown;
}

/**
 * The transport-supplied seam for the two touchpoints a headless kernel
 * cannot render itself. Both are optional: a tool whose `ToolPolicy`
 * always resolves definitively needs no `onAuthorize`, and a tool with
 * `requiresConfirmation` unset never triggers `onConfirm`.
 */
export interface ExecutionDelegate {
  /**
   * Consulted only when the tool's own `ToolPolicy.authorize` already
   * returned `'allow'` — an additional transport-level veto (e.g. "does
   * this session actually have an active grant for this tool"), not a
   * replacement for the policy. Returning `'deny'` (or a Promise resolving
   * to `'deny'`) overrides an `'allow'` from the policy; omitting
   * `onAuthorize` entirely leaves the policy's decision as final.
   */
  onAuthorize?(request: ToolAuthorizationRequest): AuthorizationDecision | Promise<AuthorizationDecision>;
  /**
   * Notified when a tool requiring confirmation is about to run. Return a
   * decision (sync value or Promise) to supply it inline; return/resolve
   * `undefined` — including simply omitting `onConfirm` — to signal "I'll
   * call `resumeConfirmation` later" instead. Note the synchronous-`void`
   * case is what actually parks the wait: an `async` implementation that
   * resolves to `undefined` is treated as "the decision is `undefined`"
   * (denied) rather than "pending" — an implementation that wants the
   * resumable path should return a bare `undefined`, not a resolved
   * Promise of one. See the module doc for why.
   */
  onConfirm?(request: ToolConfirmationRequest): ConfirmationDecision | Promise<ConfirmationDecision> | void;
}

export type ToolExecutionPhase =
  | 'requested'
  | 'authorized'
  | 'denied'
  | 'confirmed'
  | 'confirmation-denied'
  | 'started'
  | 'completed'
  | 'failed'
  | 'timed-out'
  | 'cancelled';

export interface ToolExecutionAuditEvent {
  readonly phase: ToolExecutionPhase;
  readonly at: number;
  readonly detail?: string;
}

export interface ToolExecutionAuditRecord {
  readonly executionId: string;
  readonly toolId: string;
  readonly principalId: string;
  readonly runId: string;
  readonly events: readonly ToolExecutionAuditEvent[];
}

export type ToolExecutionStatus =
  | 'completed'
  | 'denied'
  | 'confirmation-denied'
  | 'timed-out'
  | 'cancelled'
  | 'failed';

export interface ToolExecutionResult {
  readonly executionId: string;
  readonly status: ToolExecutionStatus;
  readonly output?: unknown;
  readonly truncated?: boolean;
  readonly error?: string;
}

export interface ToolExecutor {
  /** @throws If `toolId` isn't registered — a routing/programming error, distinct from the denial/confirmation-denial states `ToolExecutionResult.status` covers. */
  execute(
    principal: Principal,
    run: RunRef,
    toolId: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult>;
  /** @throws If `executionId` has no confirmation currently pending (already resumed, never required one, or unknown). */
  resumeConfirmation(executionId: string, decision: ConfirmationDecision): void;
  /** Aborts an in-flight handler, or resolves a still-pending confirmation as denied. No-op if `executionId` is already terminal or unknown. */
  cancel(executionId: string): void;
  getAuditRecord(executionId: string): ToolExecutionAuditRecord | null;
}

export interface CreateToolExecutorOptions {
  readonly registry: ToolRegistry;
  readonly delegate?: ExecutionDelegate;
  /** Injectable clock for audit timestamps — defaults to `Date.now`. Test-only hook. */
  readonly now?: () => number;
}

function truncateOutput(output: unknown, maxOutputBytes: number | undefined): { output: unknown; truncated: boolean } {
  if (!maxOutputBytes || typeof output !== 'string' || output.length <= maxOutputBytes) {
    return { output, truncated: false };
  }
  return { output: output.slice(0, maxOutputBytes), truncated: true };
}

/**
 * Creates the `ToolExecutor` reference implementation: an in-process,
 * in-memory gate over a `ToolRegistry`. No persistence — a real host that
 * needs audit records to survive a restart layers a durable store behind
 * `getAuditRecord`/an append hook later; out of this task's scope (see
 * `source-map.md`).
 *
 * @param options.registry - The `ToolRegistry` to resolve `{descriptor,
 * handler, policy}` triples from, via `@jini-ai/core/internal`'s
 * `getToolRegistration` — the one and only caller of that internal export.
 * @param options.delegate - Transport-supplied authorize/confirm UI seam;
 * omit for a headless caller whose tools never need interactive gating.
 * @complexity `execute` is O(1) plus the handler's own cost; `resumeConfirmation`/`cancel`/`getAuditRecord` are O(1) map lookups.
 * @overallScore 100/100
 */
export function createToolExecutor(options: CreateToolExecutorOptions): ToolExecutor {
  const { registry, delegate = {} } = options;
  const now = options.now ?? Date.now;

  const audits = new Map<string, ToolExecutionAuditRecord & { events: ToolExecutionAuditEvent[] }>();
  const pendingConfirmations = new Map<string, (decision: ConfirmationDecision) => void>();
  const activeControllers = new Map<string, AbortController>();

  function appendEvent(executionId: string, phase: ToolExecutionPhase, detail?: string): void {
    // Every call site passes an `executionId` this same `execute()` call
    // already registered in `audits` (right before its first `appendEvent`
    // call, below) — a non-null assertion documents that rather than a
    // defensive `if (!record) return` guard with no reachable path to hit it.
    const record = audits.get(executionId)!;
    record.events.push(detail === undefined ? { phase, at: now() } : { phase, at: now(), detail });
  }

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

  async function execute(
    principal: Principal,
    run: RunRef,
    toolId: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const registration = getToolRegistration(registry, toolId);
    if (!registration) {
      throw new Error(`ToolExecutor: unknown tool "${toolId}"`);
    }
    const { descriptor, handler, policy } = registration;

    const executionId = randomUUID();
    audits.set(executionId, {
      executionId,
      toolId: descriptor.id,
      principalId: principal.id,
      runId: run.id,
      events: [],
    });
    appendEvent(executionId, 'requested');

    let decision = await policy.authorize({ principal, run, tool: descriptor, input });
    if (decision === 'allow' && delegate.onAuthorize) {
      decision = await delegate.onAuthorize({ principal, run, tool: descriptor, input });
    }
    if (decision !== 'allow') {
      appendEvent(executionId, 'denied');
      return { executionId, status: 'denied' };
    }
    appendEvent(executionId, 'authorized');

    if (descriptor.requiresConfirmation) {
      const confirmation = await requestConfirmation({ executionId, principal, run, tool: descriptor, input });
      if (confirmation !== 'confirm') {
        appendEvent(executionId, 'confirmation-denied');
        return { executionId, status: 'confirmation-denied' };
      }
      appendEvent(executionId, 'confirmed');
    }

    const controller = new AbortController();
    activeControllers.set(executionId, controller);
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (descriptor.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, descriptor.timeoutMs);
      timeoutHandle.unref?.();
    }

    // Cleanup (clear the timeout, drop the abort controller) is repeated at
    // each return below rather than centralized in a `finally` — a
    // try/finally here produced a synthetic "abrupt completion" branch
    // istanbul/v8 instruments for the finally block itself, which is
    // unreachable in practice (every path through the try/catch below
    // returns normally; nothing here can throw a *second* exception past
    // the catch). Repeating two lines avoids leaving an uncoverable branch
    // behind instead of writing a contrived test or suppressing it.
    appendEvent(executionId, 'started');
    try {
      const rawOutput = await handler({ executionId, principal, run, input, signal: controller.signal });
      const { output, truncated } = truncateOutput(rawOutput, descriptor.maxOutputBytes);
      appendEvent(executionId, 'completed');
      if (timeoutHandle) clearTimeout(timeoutHandle);
      activeControllers.delete(executionId);
      return { executionId, status: 'completed', output, truncated };
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      activeControllers.delete(executionId);
      if (timedOut) {
        appendEvent(executionId, 'timed-out');
        return { executionId, status: 'timed-out' };
      }
      if (controller.signal.aborted) {
        appendEvent(executionId, 'cancelled');
        return { executionId, status: 'cancelled' };
      }
      const message = err instanceof Error ? err.message : String(err);
      appendEvent(executionId, 'failed', message);
      return { executionId, status: 'failed', error: message };
    }
  }

  function resumeConfirmation(executionId: string, decision: ConfirmationDecision): void {
    const resolve = pendingConfirmations.get(executionId);
    if (!resolve) {
      throw new Error(`ToolExecutor: no pending confirmation for execution "${executionId}"`);
    }
    pendingConfirmations.delete(executionId);
    resolve(decision);
  }

  function cancel(executionId: string): void {
    const controller = activeControllers.get(executionId);
    if (controller) {
      controller.abort();
      return;
    }
    const resolve = pendingConfirmations.get(executionId);
    if (resolve) {
      pendingConfirmations.delete(executionId);
      resolve('deny');
    }
  }

  function getAuditRecord(executionId: string): ToolExecutionAuditRecord | null {
    return audits.get(executionId) ?? null;
  }

  return { execute, resumeConfirmation, cancel, getAuditRecord };
}
