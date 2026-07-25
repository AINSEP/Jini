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
 * Three failure modes are handled explicitly rather than left to chance:
 *
 * 1. **Two surfaces claiming the same capability for one run.** Ambiguity is an error, never
 *    last-writer-wins — silently picking one means a click lands in a tab the user isn't looking at.
 * 2. **A duplicate answer** (stream reconnect, retried POST, a surface that answers twice).
 *    {@link FrontendSessionRegistry.settle} is idempotent and reports whether it was the one that
 *    settled the invocation; the pending map *is* the idempotency store.
 * 3. **A surface that never answers** (backgrounded tab, closed laptop). `invoke` rejects on its
 *    caller's `AbortSignal`, which inside a handler is `ToolExecutor`'s own timeout/cancel signal —
 *    so the existing `timeoutMs` on a tool descriptor covers this for free.
 */
import { randomUUID } from 'node:crypto';

/** A surface that has attached itself to a run and can execute capabilities on its behalf. */
export interface FrontendSessionDescriptor {
  /** Identifies this surface. Minted by the host at attach time; opaque here. */
  readonly sessionId: string;
  /** The run whose agent may drive this surface. */
  readonly runId: string;
  /**
   * Capability ids this surface claims it can execute. A call for anything absent from every
   * attached surface fails closed rather than hanging.
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
   * Routes one capability call to the single attached surface that claims it, and resolves with
   * that surface's output.
   *
   * @throws If no attached surface for `runId` claims `capabilityId`, if more than one does, if
   * delivery itself fails, if the surface answers with a refusal, or if `signal` aborts first.
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
  /** Capability ids reachable for `runId` right now. Empty when nothing is attached. */
  capabilitiesFor(runId: string): readonly string[];
  /** Currently attached surfaces for `runId`, in attach order. */
  sessionsFor(runId: string): readonly FrontendSessionDescriptor[];
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
 * @complexity `attach`/`settle`/`detach` are O(1); `invoke`/`capabilitiesFor`/`sessionsFor` are
 * O(n) in attached surfaces, which is bounded by open tabs.
 */
export function createFrontendSessionRegistry(
  options: CreateFrontendSessionRegistryOptions = {},
): FrontendSessionRegistry {
  const newInvocationId = options.newInvocationId ?? randomUUID;
  const sessions = new Map<string, AttachedSession>();

  function sessionsForRun(runId: string): AttachedSession[] {
    return [...sessions.values()].filter((session) => session.descriptor.runId === runId);
  }

  /** Resolves the one surface that may serve this call, or explains why there isn't exactly one. */
  function resolveTarget(runId: string, capabilityId: string): AttachedSession {
    const candidates = sessionsForRun(runId).filter(
      (session) => session.descriptor.capabilities.includes(capabilityId),
    );
    const [only] = candidates;
    if (only === undefined) {
      throw new Error(
        `no attached frontend for run "${runId}" can execute "${capabilityId}"`,
      );
    }
    if (candidates.length > 1) {
      const ids = candidates.map((session) => session.descriptor.sessionId).join(', ');
      // Picking one would silently act on a surface the user may not be looking at. Making the
      // host choose is the only answer that cannot act on the wrong window.
      throw new Error(
        `"${capabilityId}" is claimed by ${candidates.length} attached frontends for run `
        + `"${runId}" (${ids}) — detach all but the one that should act`,
      );
    }
    return only;
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
        for (const [, entry] of session.pending) {
          entry.dispose();
          entry.reject(new Error(`frontend session "${descriptor.sessionId}" detached before answering`));
        }
        session.pending.clear();
      },
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
      const onAbort = (): void => {
        target.pending.delete(invocationId);
        reject(new Error(`"${capabilityId}" was cancelled before the frontend answered`));
      };
      const dispose = (): void => signal?.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        reject(new Error(`"${capabilityId}" was cancelled before the frontend answered`));
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
    const entry = sessions.get(sessionId)?.pending.get(invocationId);
    if (entry === undefined) return false;
    sessions.get(sessionId)?.pending.delete(invocationId);
    entry.dispose();
    if (outcome.ok) entry.resolve(outcome.output);
    else entry.reject(new Error(outcome.message));
    return true;
  }

  function capabilitiesFor(runId: string): readonly string[] {
    const claimed = new Set<string>();
    for (const session of sessionsForRun(runId)) {
      for (const capability of session.descriptor.capabilities) claimed.add(capability);
    }
    return [...claimed];
  }

  function sessionsFor(runId: string): readonly FrontendSessionDescriptor[] {
    return sessionsForRun(runId).map((session) => session.descriptor);
  }

  return { attach, invoke, settle, capabilitiesFor, sessionsFor };
}
