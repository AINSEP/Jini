import type { Principal, RunRef, ToolDescriptor, AuthorizationDecision, SurfaceEmitter, ToolRegistry, ToolHandler, ToolOutputValidator, ToolOutputMismatchReporter } from '@jini-ai/core';
import type { ToolInvocationAuthorization } from '@jini-ai/core/composition';
import type { PrepareToolGuidance } from "@jini-ai/core/contracts/site/daemon";


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
 * `requiresConfirmation` unset has no default prompt; a host may strengthen a single call with `requireConfirmation: true`.
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
  | 'approval-recorded'
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

/**
 * Distinguishes a `'failed'` execution's cause, for a transport-facing status mapping that needs to
 * answer with a 4xx rather than fold every failure into one redacted 5xx. `'validation'` means a
 * handler (or a validator it called, e.g. `@jini-ai/cms`'s `registration-kit.ts` `requireString`)
 * threw `@jini-ai/core`'s `ToolInputError` — the caller's input was the problem, and a different call
 * would succeed. `'internal'` is everything else a handler can throw, where retrying with different
 * input has no reason to help.
 *
 * Absent for every status other than `'failed'` — `'timed-out'`/`'cancelled'` are already their own
 * distinct statuses a transport maps independently, and `'denied'`/`'confirmation-denied'` carry no
 * thrown error to classify.
 */
export type ToolExecutionErrorKind = 'validation' | 'internal';

export interface ToolExecutionResult {
  /** Value-free rewrites, retained even when output text is truncated. */
  readonly normalizationNotes?: readonly string[];
  readonly executionId: string;
  readonly status: ToolExecutionStatus;
  readonly output?: unknown;
  readonly truncated?: boolean;
  readonly error?: string;
  /** Set only when `status === 'failed'` — see {@link ToolExecutionErrorKind}. */
  readonly errorKind?: ToolExecutionErrorKind;
}

export interface ToolExecutor {
  /**
   * @param emitSurface - Transport-supplied seam letting the handler push a human-only surface into
   * the run's event stream *before* this call settles. Omit for a caller with no run event stream;
   * see `@jini-ai/core`'s `SurfaceEmitter` for why a handler that waits on a human needs it.
   * @param requireConfirmation - Strengthens this call only; cannot bypass a descriptor confirmation.
   * @throws {ToolInputError} If `toolId` isn't registered, with up to eight registered prefix matches.
   */
  execute(args: { readonly principal: Principal; readonly run: RunRef; readonly toolId: string; readonly input: unknown }, optionalArgs?: { readonly signal?: AbortSignal; readonly emitSurface?: SurfaceEmitter; readonly requireConfirmation?: true }
  ): Promise<ToolExecutionResult>;
  /** @throws If `executionId` has no confirmation currently pending (already resumed, never required one, or unknown). */
  resumeConfirmation(args: { readonly executionId: string; readonly decision: ConfirmationDecision }): void;
  /** Cancels an in-flight execution, unblocking a still-pending confirmation. No-op if `executionId` is already terminal or unknown. */
  cancel(args: { readonly executionId: string }): void;
  getAuditRecord(args: { readonly executionId: string }): ToolExecutionAuditRecord | null;
}

export type { PrepareToolGuidance } from "@jini-ai/core/contracts/site/daemon";

/**
 * Checks a tool's raw settled output against its declared `outputSchema`. `'enforce'` turns a
 * mismatch into one fixed internal failure; `'report'` emits one value-free diagnostic and keeps the
 * normal result. The host picks the mode and supplies the validator; the executor reads no ambient
 * configuration.
 */
export interface ToolOutputValidation {
  readonly mode: 'enforce' | 'report';
  readonly validator: ToolOutputValidator;
  readonly reportMismatch: ToolOutputMismatchReporter;
}

export interface CreateToolExecutorOptions {
  readonly prepareGuidance?: PrepareToolGuidance;
  /** Omit to settle every output unchecked, which is also what a tool with no `outputSchema` gets. */
  readonly outputValidation?: ToolOutputValidation;
  /** Host redaction for nested internal failures only; top-level failures keep their wrapper path. */
  readonly redactNestedFailure?: (required: { result: ToolExecutionResult; toolId: string; runId: string; principalId: string }) => string | undefined;
  readonly registry: ToolRegistry;
  readonly delegate?: ExecutionDelegate;
  /** Injectable clock for audit timestamps — defaults to `Date.now`. Test-only hook. */
  readonly now?: () => number;
  /** Cap on retained finished audit records, oldest evicted first. See {@link DEFAULT_MAX_AUDIT_RECORDS}. */
  readonly maxAuditRecords?: number;
}

/** The `'allow'` arm of an authorization outcome — the only one that carries a handler. */
export type AllowedInvocation = Extract<ToolInvocationAuthorization, { decision: 'allow' }>;

/** Everything `runHandler` needs about one authorized (and, if required, confirmed) call. */
export interface AdmittedCall {
  readonly executionId: string;
  readonly controller: AbortController;
  readonly principal: Principal;
  readonly run: RunRef;
  readonly toolId: string;
  readonly input: unknown;
  readonly descriptor: ToolDescriptor;
  readonly handler: ToolHandler;
  readonly normalizationNotes: readonly string[];
  readonly invocationRegistry: ToolRegistry;
}

export type ExecutorExecute = (required: Parameters<ToolExecutor['execute']>[0], optional?: NonNullable<Parameters<ToolExecutor['execute']>[1]> & { invocationRegistry?: ToolRegistry }) => Promise<ToolExecutionResult>;
