/**
 * `FrontendSessionRegistry` — the addressing layer between a run and an attached surface.
 *
 * Everything else on the delegated-tool path already exists: a CLI agent calls the injected MCP
 * server, which posts `{runId, toolUseId, toolId, input}` back over loopback, which reaches
 * `DelegatedToolBridge` and then `ToolExecutor`. What was missing is one concept — **a run has an
 * id, a browser tab has nothing**, so a tool call arrives with no addressee. This registry is that
 * addressee: a surface attaches itself against a run, and a tool handler can then reach *that*
 * surface, execute a capability there, and get an answer back.
 *
 * Deliberately generic. This module knows nothing about `page.*`, the DOM, or chat — it routes an
 * opaque `capabilityId` plus an opaque input to whichever surface claimed that capability. The
 * vocabulary of what can be executed is the host's to define (see `@jini/chat-core/agentic`), which
 * is what keeps a browser concept out of a server package.
 *
 * It also introduces **no second execution path**. The registry is only reachable from inside a
 * `ToolHandler`, so every call through it has already passed `ToolExecutor`'s authorization,
 * confirmation, timeout, cancellation, truncation, and audit trail. A route that called `invoke`
 * directly would be strictly weaker, which is exactly the failure this design exists to avoid.
 *
 * **Attaching and binding are separate on purpose.** A surface attaches once, when it opens — a
 * chat pane mounts long before the user sends anything, and runs are created per message, so a
 * surface cannot know a run id at attach time. A run is *bound* to the surface that originated it
 * when it starts. Beyond matching reality, this dissolves the worst routing hazard by construction:
 * a run has exactly one originating surface, so a capability call can never be ambiguous between
 * two open tabs, and no tie-break heuristic is needed that could act on a window nobody is
 * watching.
 *
 * Three failure modes are handled explicitly rather than left to chance:
 *
 * 1. **A capability nothing can serve** — no surface bound to the run, or one that does not claim
 *    the capability. Both fail closed with a message naming what was missing, never hang.
 * 2. **A duplicate answer** (stream reconnect, retried POST, a surface that answers twice).
 *    {@link FrontendSessionRegistry.settle} is idempotent and reports whether it was the one that
 *    settled the invocation; the pending map *is* the idempotency store.
 * 3. **A surface that never answers** (backgrounded tab, closed laptop). `invoke` rejects on its
 *    caller's `AbortSignal`, which inside a handler is `ToolExecutor`'s own timeout/cancel signal —
 *    so the existing `timeoutMs` on a tool descriptor covers this for free.
 */
import { randomUUID } from 'node:crypto';

/** A surface that has attached itself and can execute capabilities on a bound run's behalf. */
export interface FrontendSessionDescriptor {
  /** Identifies this surface. Minted by the host at attach time; opaque here. */
  readonly sessionId: string;
  /**
   * Capability ids this surface claims it can execute. A call for anything this surface does not
   * claim fails closed rather than hanging.
   */
  readonly capabilities: readonly string[];
}

/** One capability call pushed to a surface, awaiting exactly one answer. */
export interface FrontendInvocation {
  /** Correlates the answer with this call. Minted here, never supplied by the surface. */
  readonly invocationId: string;
  readonly capabilityId: string;
  readonly input: Record<string, unknown>;
}

/** A surface's answer. A refusal is an outcome, not a transport failure. */
export type FrontendOutcome =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly message: string };

export interface FrontendSessionHandle {
  readonly sessionId: string;
  /**
   * Detaches the surface. Every invocation still awaiting it is rejected rather than left pending,
   * so a closed tab surfaces as a failed tool call instead of a run that never finishes.
   */
  detach(): void;
}

export interface FrontendSessionRegistry {
  /**
   * Registers a surface and the function that pushes invocations to it (an SSE write, a WebSocket
   * send, an in-process call for a browser-resident caller that needs no relay at all).
   *
   * @throws If `sessionId` is already attached.
   */
  attach(
    descriptor: FrontendSessionDescriptor,
    deliver: (invocation: FrontendInvocation) => void,
  ): FrontendSessionHandle;
  /**
   * Associates a started run with the surface that originated it, so capability calls made by that
   * run's agent reach that surface. Re-binding the same run to the same session is a no-op; binding
   * it to a different one replaces the association, which is what a host should do when a run is
   * genuinely taken over.
   *
   * @returns A function that removes this association — call it when the run reaches a terminal
   * state so a long-lived surface does not accumulate bindings for runs that ended.
   * @throws If `sessionId` is not attached. Binding a run to a surface that is already gone would
   * produce calls that hang until their tool timeout instead of failing immediately.
   */
  bindRun(runId: string, sessionId: string): () => void;
  /**
   * Routes one capability call to the surface bound to `runId` and resolves with its output.
   *
   * @throws If no surface is bound to `runId`, if the bound surface does not claim `capabilityId`,
   * if delivery fails, if the surface answers with a refusal, or if `signal` aborts first.
   */
  invoke(
    runId: string,
    capabilityId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  /**
   * Settles a pending invocation with the surface's answer.
   *
   * @returns `true` if this call settled it; `false` if it was already settled, unknown, or belongs
   * to a different session — the duplicate-answer case, which is a no-op by design.
   */
  settle(sessionId: string, invocationId: string, outcome: FrontendOutcome): boolean;
  /**
   * Capability ids reachable for `runId` right now — empty when nothing is bound. A caller uses
   * this to advertise only what can actually be served, so an agent is never offered a capability
   * that would fail the moment it tried.
   */
  capabilitiesFor(runId: string): readonly string[];
  /** The surface bound to `runId`, or `undefined` when there is none. */
  sessionFor(runId: string): FrontendSessionDescriptor | undefined;
}

export interface CreateFrontendSessionRegistryOptions {
  /** Injectable id source for invocation ids — defaults to `randomUUID`. Test-only hook. */
  readonly newInvocationId?: () => string;
}

interface PendingInvocation {
  readonly resolve: (output: unknown) => void;
  readonly reject: (error: Error) => void;
  /** Removes the abort listener; called on every settlement path so a long run cannot leak them. */
  readonly dispose: () => void;
}

interface AttachedSession {
  readonly descriptor: FrontendSessionDescriptor;
  readonly deliver: (invocation: FrontendInvocation) => void;
  readonly pending: Map<string, PendingInvocation>;
}

/**
 * Creates an in-memory registry of attached surfaces.
 *
 * State is per-process and intentionally not persisted: an attached surface is a live connection,
 * so it cannot outlive the process that holds it, and a restart correctly presents as "nothing
 * attached" rather than as a stale route to a tab that is long gone.
 *
 * @complexity Every operation is O(1) except `detach`, which is O(p + b) in that surface\'s pending
 * invocations and bound runs.
 */
export function createFrontendSessionRegistry(
  options: CreateFrontendSessionRegistryOptions = {},
): FrontendSessionRegistry {
  const newInvocationId = options.newInvocationId ?? randomUUID;
  const sessions = new Map<string, AttachedSession>();
  const runBindings = new Map<string, string>();

  /** Resolves the surface that may serve this call, or explains precisely what is missing. */
  function resolveTarget(runId: string, capabilityId: string): AttachedSession {
    const sessionId = runBindings.get(runId);
    const session = sessionId === undefined ? undefined : sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`no frontend is bound to run "${runId}", so "${capabilityId}" cannot be executed`);
    }
    if (!session.descriptor.capabilities.includes(capabilityId)) {
      throw new Error(
        `the frontend bound to run "${runId}" does not offer "${capabilityId}" `
        + `(it offers: ${session.descriptor.capabilities.join(', ') || 'nothing'})`,
      );
    }
    return session;
  }

  function attach(
    descriptor: FrontendSessionDescriptor,
    deliver: (invocation: FrontendInvocation) => void,
  ): FrontendSessionHandle {
    if (sessions.has(descriptor.sessionId)) {
      throw new Error(`FrontendSessionRegistry: session "${descriptor.sessionId}" is already attached`);
    }
    const session: AttachedSession = { descriptor, deliver, pending: new Map() };
    sessions.set(descriptor.sessionId, session);

    return {
      sessionId: descriptor.sessionId,
      detach(): void {
        sessions.delete(descriptor.sessionId);
        for (const [runId, boundTo] of runBindings) {
          if (boundTo === descriptor.sessionId) runBindings.delete(runId);
        }
        for (const [, entry] of session.pending) {
          entry.dispose();
          entry.reject(new Error(`frontend session "${descriptor.sessionId}" detached before answering`));
        }
        session.pending.clear();
      },
    };
  }

  function bindRun(runId: string, sessionId: string): () => void {
    if (!sessions.has(sessionId)) {
      throw new Error(`FrontendSessionRegistry: cannot bind run "${runId}" to unattached session "${sessionId}"`);
    }
    runBindings.set(runId, sessionId);
    return () => {
      // Only release a binding this call still owns: a run taken over by another surface must not
      // have its newer binding torn down by the older one\'s cleanup.
      if (runBindings.get(runId) === sessionId) runBindings.delete(runId);
    };
  }

  // `async` so that a routing refusal from `resolveTarget` surfaces as a rejected promise like
  // every other failure here. Throwing synchronously out of a Promise-returning function would
  // make `invoke(...).catch(...)` an uncaught exception for exactly the fail-closed cases this
  // registry exists to report.
  async function invoke(
    runId: string,
    capabilityId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const target = resolveTarget(runId, capabilityId);
    const invocationId = newInvocationId();

    return new Promise<unknown>((resolve, reject) => {
      const cancelled = (): Error =>
        new Error(`"${capabilityId}" was cancelled before the frontend answered`);
      const onAbort = (): void => {
        target.pending.delete(invocationId);
        reject(cancelled());
      };
      const dispose = (): void => signal?.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        reject(cancelled());
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      target.pending.set(invocationId, { resolve, reject, dispose });

      try {
        target.deliver({ invocationId, capabilityId, input });
      } catch (error) {
        // A dead channel must fail the call rather than leave it pending until the tool times out.
        target.pending.delete(invocationId);
        dispose();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function settle(sessionId: string, invocationId: string, outcome: FrontendOutcome): boolean {
    const session = sessions.get(sessionId);
    const entry = session?.pending.get(invocationId);
    if (session === undefined || entry === undefined) return false;
    session.pending.delete(invocationId);
    entry.dispose();
    if (outcome.ok) entry.resolve(outcome.output);
    else entry.reject(new Error(outcome.message));
    return true;
  }

  function sessionFor(runId: string): FrontendSessionDescriptor | undefined {
    const sessionId = runBindings.get(runId);
    return sessionId === undefined ? undefined : sessions.get(sessionId)?.descriptor;
  }

  function capabilitiesFor(runId: string): readonly string[] {
    return sessionFor(runId)?.capabilities ?? [];
  }

  return { attach, bindRun, invoke, settle, capabilitiesFor, sessionFor };
}
