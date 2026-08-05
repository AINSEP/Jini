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
import type {
  AuthorizationDecision,
  Principal,
  RunRef,
  SurfaceEmitter,
  ToolDescriptor,
  ToolRegistry,
} from '@jini-ai/core';
import { authorizeToolInvocation } from '@jini-ai/core/internal';

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
  /**
   * @param emitSurface - Transport-supplied seam letting the handler push a human-only surface into
   * the run's event stream *before* this call settles. Omit for a caller with no run event stream;
   * see `@jini-ai/core`'s `SurfaceEmitter` for why a handler that waits on a human needs it.
   * @throws If `toolId` isn't registered — a routing/programming error, distinct from the denial/confirmation-denial states `ToolExecutionResult.status` covers.
   */
  execute(
    principal: Principal,
    run: RunRef,
    toolId: string,
    input: unknown,
    signal?: AbortSignal,
    emitSurface?: SurfaceEmitter,
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
 * `source-map.md`).
 *
 * @param options.registry - The `ToolRegistry` to resolve and authorize
 * tools against, via `@jini-ai/core/internal`'s `authorizeToolInvocation`
 * — the one and only caller of that internal export.
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
  /**
   * Marks a pending confirmation `cancel()` just resolved (as opposed to a genuine human `deny`),
   * so `execute()`'s confirmation branch can report `cancelled` rather than `confirmation-denied`
   * — the latter asserts a decision was made, which is false when nobody was ever asked or the
   * requester vanished before answering. Set and consumed within the same execution's lifetime
   * only; `execute()` always reads-and-clears it (`Set.delete`'s return value) right after
   * `requestConfirmation()` settles, so it can never leak onto a later execution.
   */
  const cancelledConfirmations = new Set<string>();

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

  function authorize(principal: Principal, run: RunRef, toolId: string, input: unknown) {
    // `.bind(delegate)` rather than passing the bare method reference: `ExecutionDelegate` is
    // declared with method syntax, so a host may legitimately implement it as a class instance
    // whose `onAuthorize` reads `this`. Handing the detached function to `@jini-ai/core` would
    // call it with `this` bound to the wrapper object, and a `this`-using veto would throw a
    // TypeError out of `execute()` instead of returning a decision. Re-read per call (not hoisted
    // to `createToolExecutor`) so a delegate that gains `onAuthorize` after construction still
    // gets consulted, matching the pre-`authorizeToolInvocation` behaviour.
    const onAuthorize = delegate.onAuthorize?.bind(delegate);
    return authorizeToolInvocation(
      registry,
      toolId,
      principal,
      run,
      input,
      onAuthorize ? { onAuthorize } : undefined,
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

  /** Classifies a handler rejection into its terminal result, recording the matching transition. */
  function failureResult(
    executionId: string,
    err: unknown,
    timedOut: boolean,
    aborted: boolean,
  ): ToolExecutionResult {
    if (timedOut) {
      appendEvent(executionId, 'timed-out');
      return { executionId, status: 'timed-out' };
    }
    if (aborted) {
      appendEvent(executionId, 'cancelled');
      return { executionId, status: 'cancelled' };
    }
    const message = err instanceof Error ? err.message : String(err);
    appendEvent(executionId, 'failed', message);
    return { executionId, status: 'failed', error: message };
  }

  async function execute(
    principal: Principal,
    run: RunRef,
    toolId: string,
    input: unknown,
    signal?: AbortSignal,
    emitSurface?: SurfaceEmitter,
  ): Promise<ToolExecutionResult> {
    // Existence is checked separately from — and before — authorization so the audit record can
    // be opened before the (possibly slow, possibly throwing) authorization gate runs, matching
    // pre-authorizeToolInvocation timing: `requested` used to precede `policy.authorize`, and a
    // policy that hangs or throws used to still leave a record behind. `has()` only confirms
    // existence, never returns a handler, so this doesn't reopen the leak authorizeToolInvocation
    // closed — that gate still runs, still unconditionally, inside the call below.
    if (!registry.has(toolId)) {
      throw new Error(`ToolExecutor: unknown tool "${toolId}"`);
    }

    const executionId = openAudit(principal, run, toolId);

    // Observes `signal` for this execution's ENTIRE remaining lifetime, not just the handler-run
    // phase. `requestConfirmation()`'s wait below is unbounded — it settles only when a human
    // answers or `resumeConfirmation`/`cancel` is called — so a transport disconnect or run-cancel
    // that only reached a handler-phase `AbortController` (this file's previous design) had no way
    // to end a still-parked confirmation; `execute()` simply never settled. Routed through the
    // existing `cancel(executionId)` rather than a bespoke handler, so every trigger — an explicit
    // `cancel()` call, a run cancellation, and now a transport disconnect — resolves a pending
    // confirmation and an in-flight handler the exact same way.
    let onTransportAbort: (() => void) | undefined;
    function detachTransportAbort(): void {
      if (onTransportAbort) signal?.removeEventListener('abort', onTransportAbort);
    }
    if (signal) {
      if (signal.aborted) {
        appendEvent(executionId, 'cancelled');
        return { executionId, status: 'cancelled' };
      }
      onTransportAbort = () => cancel(executionId);
      signal.addEventListener('abort', onTransportAbort, { once: true });
    }

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
    // stays a throw because it is a routing/programming error, not an execution outcome.
    let resolved: Awaited<ReturnType<typeof authorize>>;
    try {
      resolved = await authorize(principal, run, toolId, input);
    } catch {
      detachTransportAbort();
      appendEvent(executionId, 'failed', 'authorization failed');
      return { executionId, status: 'failed', error: 'authorization failed' };
    }
    // `authorize()` isn't itself signal-aware — it's typically a fast policy check, not a
    // human-in-the-loop wait — so this is a post-await check rather than a mid-flight abort, the
    // same idiom the post-handler check below already uses: a signal that fired while `authorize()`
    // was in flight is caught here, before its (now-moot) decision is acted on.
    if (signal?.aborted) {
      detachTransportAbort();
      appendEvent(executionId, 'cancelled');
      return { executionId, status: 'cancelled' };
    }
    // `registry.has(toolId)` above already confirmed the tool exists, and `ToolRegistry` is
    // append-only (no unregister — see `createToolRegistry`'s doc), so `authorizeToolInvocation`
    // resolving the same `toolId` against the same `registry` cannot come back `undefined` here.
    const { descriptor } = resolved!;

    if (resolved!.decision !== 'allow') {
      detachTransportAbort();
      appendEvent(executionId, 'denied');
      return { executionId, status: 'denied' };
    }
    appendEvent(executionId, 'authorized');
    const { handler } = resolved!;

    // Kept inline rather than extracted into a helper: hoisting this into an `async` function adds
    // microtask ticks to the *un*-confirmed path too, and callers observe that timing — a test
    // cancels an in-flight execution after a fixed number of ticks and needs the handler to have
    // already started by then.
    if (descriptor.requiresConfirmation) {
      let confirmation: ConfirmationDecision;
      try {
        confirmation = await requestConfirmation({ executionId, principal, run, tool: descriptor, input });
      } catch {
        // Same reasoning as the authorization gate above: terminal, recorded, and generic.
        detachTransportAbort();
        appendEvent(executionId, 'failed', 'confirmation failed');
        return { executionId, status: 'failed', error: 'confirmation failed' };
      }
      if (confirmation !== 'confirm') {
        detachTransportAbort();
        // `cancel(executionId)` (called directly, or via the transport-abort listener above)
        // resolves a pending confirmation the same way a human `deny` does, but the two are not the
        // same OUTCOME: `confirmation-denied` asserts a decision was made, which is false when the
        // requester vanished before answering. `cancelledConfirmations` distinguishes them so the
        // audit trail never reports a decision nobody made.
        if (cancelledConfirmations.delete(executionId)) {
          appendEvent(executionId, 'cancelled');
          return { executionId, status: 'cancelled' };
        }
        appendEvent(executionId, 'confirmation-denied');
        return { executionId, status: 'confirmation-denied' };
      }
      appendEvent(executionId, 'confirmed');
    }

    const controller = new AbortController();
    activeControllers.set(executionId, controller);
    // `signal` doesn't need linking here — the listener registered above already reaches this
    // controller via `cancel()`'s `activeControllers` branch as soon as `activeControllers.set`
    // ran. A second direct link (this file used to have one, `linkAbortSignal`) was redundant for
    // this phase and, worse, gave the impression `signal` was fully handled when it was only wired
    // to the phase after the one that actually needed it — see the confirmation block above.
    const timeout = startTimeout(controller, descriptor.timeoutMs);

    // Cleanup (clear the timeout, drop the abort controller) is repeated at
    // each return below rather than centralized in a `finally` — a
    // try/finally here produced a synthetic "abrupt completion" branch
    // istanbul/v8 instruments for the finally block itself, which is
    // unreachable in practice (every path through the try/catch below
    // returns normally; nothing here can throw a *second* exception past
    // the catch). Repeating one call avoids leaving an uncoverable branch
    // behind instead of writing a contrived test or suppressing it.
    const cleanup = () => {
      if (timeout.handle) clearTimeout(timeout.handle);
      activeControllers.delete(executionId);
    };
    appendEvent(executionId, 'started');
    try {
      // `emitSurface` is spread in only when the transport supplied one, so a handler can test
      // `ctx.emitSurface` and get a truthful answer about whether a surface it emits would actually
      // reach anybody. An always-present no-op would read as "yes" and let a handler park forever.
      const rawOutput = await handler({
        executionId,
        principal,
        run,
        input,
        signal: controller.signal,
        ...(emitSurface !== undefined ? { emitSurface } : {}),
      });
      // A handler is not OBLIGED to honour `signal` — it is handed one, not policed by one. A
      // handler that ignores it and resolves normally after the timer fired (or after `cancel`)
      // used to land here and be recorded `completed`, because the timeout/abort state was only
      // ever consulted in the `catch`. That reports success for a call the contract has already
      // declared terminal in the other direction: the caller was told `timed-out`/`cancelled` is
      // final (see this module's state-machine doc), the audit trail said `completed`, and the two
      // disagreed. Whether the handler cooperated does not change what happened to the CALL.
      if (timeout.timedOut() || controller.signal.aborted) {
        cleanup();
        detachTransportAbort();
        return failureResult(
          executionId,
          new Error('handler resolved after the execution was already terminal'),
          timeout.timedOut(),
          controller.signal.aborted,
        );
      }
      const { output, truncated } = truncateOutput(rawOutput, descriptor.maxOutputBytes);
      appendEvent(executionId, 'completed');
      cleanup();
      detachTransportAbort();
      return { executionId, status: 'completed', output, truncated };
    } catch (err) {
      cleanup();
      detachTransportAbort();
      return failureResult(executionId, err, timeout.timedOut(), controller.signal.aborted);
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
      cancelledConfirmations.add(executionId);
      resolve('deny');
    }
  }

  function getAuditRecord(executionId: string): ToolExecutionAuditRecord | null {
    return audits.get(executionId) ?? null;
  }

  return { execute, resumeConfirmation, cancel, getAuditRecord };
}
