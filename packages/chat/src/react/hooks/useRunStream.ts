/**
 * @module useRunStream
 *
 * Owns the current `runId`, streaming flag, accumulated `AgentEvent[]`,
 * error/terminal state, and the ephemeral tool-input-delta buffer (keyed by
 * tool id) for a single active run. Calls `transport.startRun`/
 * `reattachRun`/`stopRun` — never touches `fetch`/`EventSource` itself; the
 * `ChatTransport` port (see `../../transport.js`) is the only I/O this hook
 * performs. Per `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §4's hook table.
 *
 * This hook IS the "single-instance orchestrator" the §4 accumulating-
 * subscription rule refers to: it owns the one active browser-side
 * subscription for whichever run it is currently attached to. Each
 * start/reattach bumps a generation counter; handlers from a superseded
 * generation are ignored, so a slow/duplicate callback from an aborted
 * subscription can never clobber a newer one's state (a plain `runId`
 * comparison can't do this — `start()`'s handlers must exist before the
 * transport's promise resolves with the real id).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '@jini-ai/chat/core';
import type { ChatTransport, RunHandlers, StartRunInput } from '@jini-ai/chat/core';

export type RunStreamStatus = 'idle' | 'streaming' | 'done' | 'error' | 'canceled';

export interface RunStreamState {
  runId: string | null;
  status: RunStreamStatus;
  events: AgentEvent[];
  error: Error | null;
  /** Ephemeral live tool-input fragments, keyed by tool-use id. Never persisted. */
  toolInputDeltas: Record<string, string>;
}

export type StartRunOptions = Omit<StartRunInput, 'signal' | 'cancelSignal'>;

export interface UseRunStreamResult extends RunStreamState {
  /** True while `status === 'streaming'`. Convenience for render conditions. */
  isStreaming: boolean;
  start: (input: StartRunOptions) => Promise<{ runId: string } | null>;
  /** Resume listening to an already-started run (reconnect/replay), optionally seeded with its persisted events. */
  reattach: (runId: string, initialEvents?: AgentEvent[]) => Promise<void>;
  /** Aborts the current browser-side subscription AND asks the transport to stop the run host-side. */
  cancel: () => void;
  /** Clears all state back to `idle` without touching the transport (e.g. moving to a fresh turn). */
  reset: () => void;
}

const INITIAL_STATE: RunStreamState = {
  runId: null,
  status: 'idle',
  events: [],
  error: null,
  toolInputDeltas: {},
};

export function useRunStream(transport: ChatTransport): UseRunStreamResult {
  const [state, setState] = useState<RunStreamState>(INITIAL_STATE);
  const subscriptionAbortRef = useRef<AbortController | null>(null);
  const cancelAbortRef = useRef<AbortController | null>(null);
  // Bumped on every start/reattach/reset. A handler closes over the
  // generation it was created for and drops itself once superseded.
  const generationRef = useRef(0);
  /**
   * Generations that were CANCELLED (as opposed to merely superseded) while their `startRun` was
   * still in flight.
   *
   * `cancel()` can only stop a run it has an id for, and during that window there is no id yet.
   * The generation bump then routes the eventual resolution down the "not current" path, so the
   * run was left alive on the daemon with nothing on the client able to reach it. Recording the
   * intent here lets the resolution finish the job. A supersession by a new start/reattach is
   * deliberately NOT recorded — that case really does need no stop.
   */
  const canceledGenerations = useRef<Set<number>>(new Set());

  const teardownSubscription = useCallback(() => {
    subscriptionAbortRef.current?.abort();
    subscriptionAbortRef.current = null;
    cancelAbortRef.current = null;
  }, []);

  // Abort any in-flight subscription on unmount so a slow transport can't
  // call back into a hook instance that no longer exists.
  useEffect(() => teardownSubscription, [teardownSubscription]);

  const makeHandlers = useCallback((generation: number): RunHandlers => {
    const isStale = () => generationRef.current !== generation;
    return {
      onEvent: (ev: AgentEvent) => {
        if (isStale()) return;
        setState((prev) => ({ ...prev, status: 'streaming', events: [...prev.events, ev] }));
      },
      onToolInputDelta: (id: string, _name: string, delta: string) => {
        if (isStale()) return;
        setState((prev) => ({
          ...prev,
          toolInputDeltas: { ...prev.toolInputDeltas, [id]: (prev.toolInputDeltas[id] ?? '') + delta },
        }));
      },
      onError: (err: Error) => {
        if (isStale()) return;
        setState((prev) => ({ ...prev, status: 'error', error: err }));
      },
      onDone: (finalEvents: AgentEvent[]) => {
        if (isStale()) return;
        setState((prev) => ({ ...prev, status: prev.status === 'error' ? prev.status : 'done', events: finalEvents }));
      },
    };
  }, []);

  const start = useCallback(
    async (input: StartRunOptions): Promise<{ runId: string } | null> => {
      teardownSubscription();
      const generation = ++generationRef.current;
      const subscriptionAbort = new AbortController();
      const cancelAbort = new AbortController();
      subscriptionAbortRef.current = subscriptionAbort;
      cancelAbortRef.current = cancelAbort;
      setState({ ...INITIAL_STATE, status: 'streaming' });
      try {
        const { runId } = await transport.startRun(
          { ...input, signal: subscriptionAbort.signal, cancelSignal: cancelAbort.signal },
          makeHandlers(generation),
        );
        if (generationRef.current !== generation) {
          // Consumed rather than assumed: only a CANCEL leaves an orphan here.
          if (canceledGenerations.current.delete(generation)) void transport.stopRun(runId);
          return { runId };
        }
        setState((prev) => ({ ...prev, runId }));
        return { runId };
      } catch (err) {
        // A start that never produced a run id has nothing to stop; drop the intent so the set does
        // not accumulate one entry per failed start for the lifetime of the hook.
        canceledGenerations.current.delete(generation);
        if (generationRef.current !== generation) return null;
        setState((prev) => ({ ...prev, status: 'error', error: toError(err) }));
        return null;
      }
    },
    [makeHandlers, teardownSubscription, transport],
  );

  const reattach = useCallback(
    async (runId: string, initialEvents: AgentEvent[] = []): Promise<void> => {
      teardownSubscription();
      const generation = ++generationRef.current;
      const subscriptionAbort = new AbortController();
      const cancelAbort = new AbortController();
      subscriptionAbortRef.current = subscriptionAbort;
      cancelAbortRef.current = cancelAbort;
      setState({ ...INITIAL_STATE, runId, status: 'streaming', events: initialEvents });
      try {
        // The subscription controller reaches the transport, so `teardownSubscription()` (unmount,
        // reset, or a superseding start/reattach) actually detaches the stream. Without it the
        // generation guard still stops stale callbacks from clobbering state, but the connection
        // and its read loop stay open until the run ends on its own.
        await transport.reattachRun(runId, makeHandlers(generation), { signal: subscriptionAbort.signal });
      } catch (err) {
        if (generationRef.current !== generation) return;
        setState((prev) => ({ ...prev, status: 'error', error: toError(err) }));
      }
    },
    [makeHandlers, teardownSubscription],
  );

  const cancel = useCallback(() => {
    cancelAbortRef.current?.abort();
    const runId = state.runId;
    // Recorded BEFORE the bump, so it names the generation currently in flight. When `runId` is
    // already known the `stopRun` below does the work and this entry is simply never consumed;
    // when it is not, this is the only thing that will ever stop that run.
    if (runId == null) canceledGenerations.current.add(generationRef.current);
    generationRef.current += 1;
    teardownSubscription();
    setState((prev) => ({ ...prev, status: 'canceled' }));
    if (runId) void transport.stopRun(runId);
  }, [state.runId, teardownSubscription, transport]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    teardownSubscription();
    setState(INITIAL_STATE);
  }, [teardownSubscription]);

  return { ...state, isStreaming: state.status === 'streaming', start, reattach, cancel, reset };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
