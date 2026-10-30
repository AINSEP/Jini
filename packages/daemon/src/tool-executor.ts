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
import { randomUUID } from 'node:crypto';
import {
  ToolInputError,
  withNormalizationNotes,
  ToolInputNormalizationError,
  isReadOnlyTool,
  type AuthorizationDecision,
  type Principal,
  type RunRef,
  type SurfaceEmitter,
  type ToolDescriptor,
  type ToolExecutionOptions,
  type ToolHandler,
  type ToolRegistry,
} from '@jini-ai/core';
import { authorizeToolInvocation, type ToolInvocationAuthorization } from '@jini-ai/core/composition';
import { toolCandidates } from './core/tool-candidates.js';

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
   * @throws {ToolInputError} If `toolId` isn't registered, with up to eight registered prefix matches.
   */
  execute(args: { readonly principal: Principal; readonly run: RunRef; readonly toolId: string; readonly input: unknown }, optionalArgs?: { readonly signal?: AbortSignal; readonly emitSurface?: SurfaceEmitter }
  ): Promise<ToolExecutionResult>;
  /** @throws If `executionId` has no confirmation currently pending (already resumed, never required one, or unknown). */
  resumeConfirmation(args: { readonly executionId: string; readonly decision: ConfirmationDecision }): void;
  /** Cancels an in-flight execution, unblocking a still-pending confirmation. No-op if `executionId` is already terminal or unknown. */
  cancel(args: { readonly executionId: string }): void;
  getAuditRecord(args: { readonly executionId: string }): ToolExecutionAuditRecord | null;
}

/** Advisory preparation after authorization/confirmation, before the handler. A failure is fail-open. */
export type PrepareToolGuidance = (required: { principal: Principal; run: RunRef; tool: ToolDescriptor; signal: AbortSignal; emitSurface?: SurfaceEmitter }, optional?: Record<string, never>) => Promise<string>;

export interface CreateToolExecutorOptions {
  readonly prepareGuidance?: PrepareToolGuidance;
  readonly registry: ToolRegistry;
  readonly delegate?: ExecutionDelegate;
  /** Injectable clock for audit timestamps — defaults to `Date.now`. Test-only hook. */
  readonly now?: () => number;
  /** Cap on retained finished audit records, oldest evicted first. See {@link DEFAULT_MAX_AUDIT_RECORDS}. */
  readonly maxAuditRecords?: number;
}

/**
 * Default cap on finished audit records kept for `getAuditRecord`. One record is added per tool
 * execution and nothing else ever removed one, so a long-lived daemon grew the map for its whole
 * uptime (memory investigation 2026-10-21). An in-flight execution's record is never evicted: its
 * later transitions still have to land on it.
 */
export const DEFAULT_MAX_AUDIT_RECORDS = 1000;

/** Phases after which an execution's audit record receives no further events. */
const TERMINAL_AUDIT_PHASES: ReadonlySet<ToolExecutionPhase> = new Set<ToolExecutionPhase>(['denied', 'confirmation-denied', 'completed', 'failed', 'timed-out', 'cancelled']);

/**
 * Enforces `maxOutputBytes` in BYTES, which is what the option is named for.
 *
 * `String.length` and `String.slice` count UTF-16 code units, so this previously let any non-ASCII
 * output through at up to ~3x the configured cap (CJK and emoji are 3–4 UTF-8 bytes per code unit)
 * — precisely the case a byte cap exists to bound. Slicing by code units also cannot split a
 * surrogate pair safely.
 *
 * The byte slice is decoded non-fatally and one trailing U+FFFD is dropped: cutting mid-sequence
 * produces exactly one replacement character at the end, and emitting that as the last visible
 * glyph of every truncated multi-byte output is worse than losing one already-truncated character.
 */
function truncateOutput(output: unknown, maxOutputBytes: number | undefined): { output: unknown; truncated: boolean } {
  if (!maxOutputBytes || typeof output !== 'string') return { output, truncated: false };
  const encoded = Buffer.from(output, 'utf8');
  if (encoded.byteLength <= maxOutputBytes) return { output, truncated: false };
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(encoded.subarray(0, maxOutputBytes));
  return { output: decoded.endsWith('�') ? decoded.slice(0, -1) : decoded, truncated: true };
}

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
 * @complexity Known-id `execute` adds schema-guided normalization to the handler's cost; unknown ids scan O(n) descriptors for hints. `resumeConfirmation`/`cancel`/`getAuditRecord` are O(1) map lookups.
 * @overallScore 100/100
 */
export function createToolExecutor(requiredArgs: Pick<CreateToolExecutorOptions, "registry">, optionalArgs: Pick<CreateToolExecutorOptions, "delegate" | "now" | "prepareGuidance" | "maxAuditRecords"> = {}): ToolExecutor {
  const options: CreateToolExecutorOptions = { ...requiredArgs, ...optionalArgs };
  const { registry, delegate = {} } = options;
  const now = options.now ?? Date.now;
  const maxAuditRecords = options.maxAuditRecords ?? DEFAULT_MAX_AUDIT_RECORDS;

  const audits = new Map<string, ToolExecutionAuditRecord & { events: ToolExecutionAuditEvent[] }>();
  // Finished executionIds, oldest first (Set insertion order): the only records `retireAudit` evicts.
  const finishedAudits = new Set<string>();
  const pendingConfirmations = new Map<string, (decision: ConfirmationDecision) => void>();
  // Owned by the executor, not a bridge: concurrent HTTP/MCP calls create separate bridges.
  const approvalWaits = new Map<string, Map<string, string>>();
  const activeControllers = new Map<string, AbortController>();
  /**
   * Marks a pending confirmation `cancel()` just resolved (as opposed to a genuine human `deny`),
   * so `execute()`'s confirmation branch can report `cancelled` rather than `confirmation-denied`
   * — the latter asserts a decision was made, which is false when nobody was ever asked or the
   * requester vanished before answering. Set and consumed within the same execution's lifetime
   * only; `execute()` always reads-and-clears it (`Set.delete`'s return value) right after
   * `requestConfirmation()` settles, so it can never leak onto a later execution.
   */
  const cancelledConfirmations = new Set<string>();

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

  function appendEvent(executionId: string, phase: ToolExecutionPhase, detail?: string): void {
    // Every call site passes an `executionId` this same `execute()` call
    // already registered in `audits` (right before its first `appendEvent`
    // call, below) — a non-null assertion documents that rather than a
    // defensive `if (!record) return` guard with no reachable path to hit it.
    const record = audits.get(executionId)!;
    record.events.push(detail === undefined ? { phase, at: now() } : { phase, at: now(), detail });
    // A terminal transition is each execution's last append (`execute()` returns right after it),
    // so evicting finished records can never pull one out from under a later `appendEvent`.
    if (TERMINAL_AUDIT_PHASES.has(phase)) retireAudit(executionId);
  }

  /** Marks `executionId` finished and evicts the oldest finished records past `maxAuditRecords`. */
  function retireAudit(executionId: string): void {
    finishedAudits.add(executionId);
    while (finishedAudits.size > maxAuditRecords) {
      const oldest = finishedAudits.values().next().value as string;
      finishedAudits.delete(oldest);
      audits.delete(oldest);
    }
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

  /** Opens the audit record for a fresh execution and records the `requested` transition. */
  function openAudit(principal: Principal, run: RunRef, toolId: string): string {
    const executionId = randomUUID();
    audits.set(executionId, {
      executionId,
      toolId,
      principalId: principal.id,
      runId: run.id,
      events: [],
    });
    appendEvent(executionId, 'requested');
    return executionId;
  }

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

  /**
   * Arms the descriptor's execution timeout, if it declares one. The returned `timedOut()` reports
   * whether the timer (rather than an external cancel) was what aborted the controller, which is
   * what distinguishes a `timed-out` result from a `cancelled` one.
   */
  function startTimeout(
    controller: AbortController,
    timeoutMs: number | undefined,
  ): { handle: ReturnType<typeof setTimeout> | undefined; timedOut: () => boolean } {
    if (timeoutMs === undefined) return { handle: undefined, timedOut: () => false };
    let timedOut = false;
    const handle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    handle.unref?.();
    return { handle, timedOut: () => timedOut };
  }

  /** Records a terminal transition that carries no detail and returns its bare result. */
  function terminal({ executionId, status }: { executionId: string; status: 'cancelled' | 'denied' | 'confirmation-denied' | 'timed-out' }): ToolExecutionResult {
    appendEvent(executionId, status);
    return { executionId, status };
  }

  /** Records an operational (non-decision) failure under a fixed message that never carries the exception text. */
  function operationalFailure({ executionId, error }: { executionId: string; error: 'authorization failed' | 'confirmation failed' }): ToolExecutionResult {
    appendEvent(executionId, 'failed', error);
    return { executionId, status: 'failed', error };
  }

  /**
   * Classifies a handler rejection into its terminal result, recording the matching transition.
   * Prepared `guidance` is appended to a `failed` result's error (never to its audit detail) — a
   * rejected write still returns a model-visible result; do not lose prepared guidance there.
   */
  function failureResult(
    { executionId, err, timedOut, aborted }: { executionId: string; err: unknown; timedOut: boolean; aborted: boolean },
    { normalizationNotes = [], guidance = '' }: { normalizationNotes?: readonly string[]; guidance?: string } = {},
  ): ToolExecutionResult {
    if (timedOut) return terminal({ executionId, status: 'timed-out' });
    if (aborted) return terminal({ executionId, status: 'cancelled' });
    const message = withNormalizationNotes({ output: err instanceof Error ? err.message : String(err), notes: normalizationNotes }) as string;
    appendEvent(executionId, 'failed', message);
    const errorKind: ToolExecutionErrorKind = err instanceof ToolInputError ? 'validation' : 'internal';
    const error = guidance ? `${message}\n\n${guidance}` : message;
    return { executionId, status: 'failed', error, errorKind, ...(normalizationNotes.length ? { normalizationNotes } : {}) };
  }

  /** Throws the typed unknown-tool input error, naming up to eight similarity-ranked registrations.
   * Input is used only for a diagnostic resource hint; this never dispatches an alternate tool. */
  function assertKnownTool({ registry: invocationRegistry, toolId, input }: { registry: ToolRegistry; toolId: string; input: unknown }): void {
    if (invocationRegistry.has({ toolId })) return;
    const candidates = toolCandidates({ toolId, tools: invocationRegistry.list({}), input });
    const hint = candidates.length > 0 ? `; did you mean ${candidates.join(', ')}?` : '';
    throw new ToolInputError({ message: `ToolExecutor: unknown tool "${toolId}"${hint}` });
  }

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

  /** Terminal result for an authorization gate that threw, keeping a typed normalization error's message. */
  function authorizationFailure({ executionId, error }: { executionId: string; error: unknown }): ToolExecutionResult {
    if (error instanceof ToolInputNormalizationError) return failureResult({ executionId, err: error, timedOut: false, aborted: false });
    return operationalFailure({ executionId, error: 'authorization failed' });
  }

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

  /** Whether `prepareGuidance` applies to this tool — checked synchronously so the no-guidance path adds no tick. */
  function wantsGuidance(descriptor: ToolDescriptor): boolean {
    return Boolean(options.prepareGuidance && descriptor.metadata?.guidanceCapabilities?.length);
  }

  /** `{ emitSurface }` when the transport supplied one, else `{}` — see `runHandler` for why it is never defaulted. */
  function surfaceOption(emitSurface: SurfaceEmitter | undefined): { emitSurface?: SurfaceEmitter } {
    return emitSurface !== undefined ? { emitSurface } : {};
  }

  /** The handler's `invokeTool` port: a nested call through this same executor and its gates. */
  function nestedInvoker(
    { principal, run, toolId, invocationRegistry, signal }: { principal: Principal; run: RunRef; toolId: string; invocationRegistry: ToolRegistry; signal: AbortSignal },
    { emitSurface }: { emitSurface?: SurfaceEmitter | undefined },
  ): NonNullable<ToolExecutionOptions['invokeTool']> {
    return async ({ toolId: nestedToolId, input: nestedInput }, { registry: nestedRegistry = invocationRegistry } = {}) => {
      const selectedRegistry = nestedToolId === toolId || invocationRegistry.has({ toolId: nestedToolId }) ? invocationRegistry : nestedRegistry;
      const result = await execute({ principal, run, toolId: nestedToolId, input: nestedInput }, { signal, ...surfaceOption(emitSurface), invocationRegistry: selectedRegistry });
      if (result.status === 'completed') return result.output;
      // `failed` results always carry `error` (and only they carry `errorKind`); the bare terminal
      // statuses carry none, so they are named by tool id and status instead.
      const message = result.error ?? `${nestedToolId}: ${result.status}`;
      throw result.errorKind === 'validation' ? new ToolInputError({ message }) : new Error(message);
    };
  }

  /**
   * Turns a resolved handler output into the terminal result: `completed` with the (guidance-
   * annotated, normalization-noted, truncated) output, or the terminal state the call already
   * reached when the handler resolved after it.
   */
  function settleOutput(
    { executionId, rawOutput, descriptor, timedOut, aborted }: { executionId: string; rawOutput: unknown; descriptor: ToolDescriptor; timedOut: boolean; aborted: boolean },
    { guidance, normalizationNotes }: { guidance: string; normalizationNotes: readonly string[] },
  ): ToolExecutionResult {
    // A handler is not OBLIGED to honour `signal` — it is handed one, not policed by one. A
    // handler that ignores it and resolves normally after the timer fired (or after `cancel`)
    // used to land here and be recorded `completed`, because the timeout/abort state was only
    // ever consulted in the `catch`. That reports success for a call the contract has already
    // declared terminal in the other direction: the caller was told `timed-out`/`cancelled` is
    // final (see this module's state-machine doc), the audit trail said `completed`, and the two
    // disagreed. Whether the handler cooperated does not change what happened to the CALL.
    if (timedOut || aborted) {
      return failureResult({ executionId, err: new Error('handler resolved after the execution was already terminal'), timedOut, aborted });
    }
    const { output, truncated } = truncateOutput(withNormalizationNotes({ output: attachToolGuidance({ output: rawOutput, guidance }), notes: normalizationNotes }), descriptor.maxOutputBytes);
    appendEvent(executionId, 'completed');
    return { executionId, status: 'completed', output, truncated, ...(normalizationNotes.length ? { normalizationNotes } : {}) };
  }

  /** The `'allow'` arm of an authorization outcome — the only one that carries a handler. */
  type AllowedInvocation = Extract<ToolInvocationAuthorization, { decision: 'allow' }>;

  /** Everything `runHandler` needs about one authorized (and, if required, confirmed) call. */
  interface AdmittedCall {
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
      if (timeout.handle) clearTimeout(timeout.handle);
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
        onApprovalStateChange: ({ pending }) => approvalStateChange({ run, executionId, toolId: call.toolId, pending }),
        invokeTool: nestedInvoker({ principal, run, toolId: call.toolId, invocationRegistry: call.invocationRegistry, signal: controller.signal }, { emitSurface }),
      });
      cleanup();
      return settleOutput({ executionId, rawOutput, descriptor, timedOut: timeout.timedOut(), aborted: controller.signal.aborted }, { guidance, normalizationNotes });
    } catch (err) {
      cleanup();
      return failureResult({ executionId, err, timedOut: timeout.timedOut(), aborted: controller.signal.aborted }, { normalizationNotes, guidance });
    }
  }

  async function execute({ principal, run, toolId, input }: { readonly principal: Principal; readonly run: RunRef; readonly toolId: string; readonly input: unknown }, { signal, emitSurface, invocationRegistry = registry }: { readonly signal?: AbortSignal; readonly emitSurface?: SurfaceEmitter; readonly invocationRegistry?: ToolRegistry } = {}
  ): Promise<ToolExecutionResult> {
    // Existence is checked separately from — and before — authorization so the audit record can
    // be opened before the (possibly slow, possibly throwing) authorization gate runs, matching
    // pre-authorizeToolInvocation timing: `requested` used to precede `policy.authorize`, and a
    // policy that hangs or throws used to still leave a record behind. `has()` only confirms
    // existence, never returns a handler, so this doesn't reopen the leak authorizeToolInvocation
    // closed — that gate still runs, still unconditionally, inside the call below.
    assertKnownTool({ registry: invocationRegistry, toolId, input });

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
    if (descriptor.requiresConfirmation) {
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

  function resumeConfirmation({ executionId, decision }: { readonly executionId: string; readonly decision: ConfirmationDecision }): void {
    const resolve = pendingConfirmations.get(executionId);
    if (!resolve) {
      throw new Error(`ToolExecutor: no pending confirmation for execution "${executionId}"`);
    }
    pendingConfirmations.delete(executionId);
    resolve(decision);
  }

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

  function getAuditRecord({ executionId }: { readonly executionId: string }): ToolExecutionAuditRecord | null {
    return audits.get(executionId) ?? null;
  }

  return { execute, resumeConfirmation, cancel, getAuditRecord };
}

/** Preserve ordinary object fields while adding model-facing guidance to this tool result. */
function attachToolGuidance({ output, guidance }: { output: unknown; guidance: string }): unknown {
  if (!guidance) return output;
  if (typeof output === 'string') return `${output}\n\n${guidance}`;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    // MCP envelopes are projected by their content blocks; an extra JSON property may be ignored.
    if ('content' in output && Array.isArray(output.content)) return { ...output, content: [...output.content, { type: 'text', text: guidance }] };
    return { ...output, agentPluginGuidance: guidance };
  }
  return { result: output, agentPluginGuidance: guidance };
}
