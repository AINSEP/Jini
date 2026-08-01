import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MediaProviderCredentials,
  MediaProviderMap,
  MediaProvidersLoadState,
  MediaProvidersPort,
  MediaProvidersSaveState,
} from '@jini-ai/ui-core';
import { hasAnyConfiguredProvider, isEntryEmpty, mergeDaemonProviders, shouldSyncLocalProvidersToDaemon } from '@jini-ai/ui-core';

/** The operator-editable fields of a provider entry. Server markers
 *  (`apiKeyConfigured`/`apiKeyTail`) are deliberately excluded — they only
 *  ever arrive FROM the daemon, never typed by the operator; see
 *  `MediaProviderCredentials`'s own doc comment for the recoverable-vs-marker
 *  distinction this narrows around. */
export type MediaProviderEditPatch = Pick<MediaProviderCredentials, 'apiKey' | 'baseUrl' | 'model'>;

export interface UseMediaProvidersTabOptions {
  port: MediaProvidersPort;
  /** Host-persisted local edits from before this tab mounted (e.g. the
   *  host's own locally-cached config, read before the daemon round-trip
   *  completes). Defaults to none. Threaded into the initial
   *  daemon-reconciliation merge unchanged, so a first-run migration
   *  (`shouldSyncLocalProvidersToDaemon`) has real local data to detect. */
  initialProviders?: MediaProviderMap | undefined;
}

export interface UseMediaProvidersTabResult {
  /** The full working set: local edits layered over whatever the daemon last
   *  reported. Reflects `initialProviders` until the first load settles. */
  providers: MediaProviderMap;
  load: MediaProvidersLoadState;
  save: MediaProvidersSaveState;
  hasAnyConfigured: boolean;
  /** Provider ids with an edit not yet flushed to the daemon. A `reload()`
   *  preserves exactly these over whatever the server reports for them — see
   *  `mergeDaemonProviders`'s `preserveLocalProviderIds`. */
  pendingProviderIds: ReadonlySet<string>;
  updateProvider: (providerId: string, patch: MediaProviderEditPatch) => void;
  /** Drops the provider entirely (recoverable fields AND server markers) and
   *  immediately persists the removal. Clear is treated as a decisive action
   *  — same as the origin's confirm-then-clear flow — not a pending edit an
   *  operator might still back out of via `reload()`. */
  clearProvider: (providerId: string) => void;
  /** Flushes every current provider to the daemon. */
  saveChanges: () => void;
  /** Re-reads the daemon's copy and reconciles it against local state. */
  reload: () => void;
}

/**
 * Owns the tab's async edges: the initial daemon fetch (plus the one-time
 * first-upload migration `shouldSyncLocalProvidersToDaemon` guards), manual
 * reload, per-field edits, clear, and save. Origin: `MediaProvidersSection`'s
 * own `useState`/`useEffect` block in `SettingsDialog.tsx`, split from the
 * App.tsx-level boot migration it used to depend on — ported as a
 * self-contained hook (matches `useProjectLocationsTab`'s convention) so this
 * tab does not need a host-level daemon-config bootstrap to behave correctly.
 *
 * The `null` vs `{}` distinction `mergeDaemonProviders` turns on is preserved
 * end-to-end here: a `null` fetch result renders as `'unreachable'` and never
 * reaches `mergeDaemonProviders` at all (local state is left exactly as it
 * was), while a reached-but-empty `{}` result merges normally and can drop
 * stale local markers. Collapsing the two — e.g. defaulting a `null` result to
 * `{}` before merging — would make a transient daemon blip read as "the
 * server manages nothing" and silently wipe local edits.
 */
export function useMediaProvidersTab({ port, initialProviders }: UseMediaProvidersTabOptions): UseMediaProvidersTabResult {
  const [providers, setProviders] = useState<MediaProviderMap>(() => ({ ...(initialProviders ?? {}) }));
  const [pendingProviderIds, setPendingProviderIds] = useState<ReadonlySet<string>>(() => new Set());
  const [load, setLoad] = useState<MediaProvidersLoadState>({ status: 'loading' });
  const [save, setSave] = useState<MediaProvidersSaveState>({ status: 'idle' });

  /** Volatile values async callbacks need at RUN time, not at schedule time —
   *  same convention as `useProjectLocationsTab`'s refs. */
  const portRef = useRef(port);
  portRef.current = port;

  /**
   * The working set, mirrored into refs that update SYNCHRONOUSLY with each
   * mutation rather than at the next render.
   *
   * These are not a render-time convenience here, they are the send-time
   * source of truth: a queued whole-map write builds its payload from
   * `providersRef.current` at the moment it reaches the port (see `flushNow`).
   * Assigning them during render instead would leave a write that is issued in
   * the same tick as an edit sending the map from BEFORE that edit. Every
   * mutation therefore goes through `applyProviders`/`applyPending` — nothing
   * in this hook may call `setProviders`/`setPendingProviderIds` directly.
   */
  const providersRef = useRef(providers);
  const pendingRef = useRef(pendingProviderIds);

  const applyProviders = useCallback((next: MediaProviderMap) => {
    providersRef.current = next;
    setProviders(next);
  }, []);

  const applyPending = useCallback((next: ReadonlySet<string>) => {
    pendingRef.current = next;
    setPendingProviderIds(next);
  }, []);

  /**
   * Provider ids mutated locally since the in-flight write took its payload.
   * Reset at send time by `flushNow`, which then treats exactly these ids as
   * "the server's answer does not describe this one" — see its doc comment.
   */
  const mutatedSinceSend = useRef<Set<string>>(new Set());

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** One monotonic ticket for the load edge: a manual `reload()` can be
   *  triggered again before a previous fetch settles, and responses are not
   *  guaranteed to land in send order — only the newest ticket may write
   *  state (same guard as `useExecutionTab`'s detection ticket). */
  const loadTicket = useRef(0);

  /**
   * `'abandoned'` is deliberately distinct from `'failed'`, not folded into it.
   * `clearProvider` rolls its optimistic delete back when a save does not
   * succeed — but a write whose component unmounted mid-flight has no state
   * left to roll back, and treating it as a failure would touch a dead tree.
   * An abandoned write must produce no state change at all.
   */
  type PersistOutcome =
    | { readonly status: 'saved' }
    | { readonly status: 'failed' }
    | { readonly status: 'abandoned' };

  /**
   * Issues ONE whole-map write and reconciles the server's answer.
   *
   * The payload is read from `providersRef` HERE, not passed in by the caller,
   * because this function may run long after the caller asked for it (see
   * `persist`'s serialization). Building it at send time is what makes waiting
   * safe: a queued write always carries the live working set, never the
   * snapshot that was current when it was requested.
   *
   * On success the server's copy is authoritative for everything this request
   * sent — but NOT for a provider the operator touched while it was in flight.
   * That entry was never in `sent`, so taking the server's value for it would
   * eat the edit, and for a clear would put the credential back on screen. Those
   * ids (`mutatedSinceSend`) keep local truth, including local deletion.
   */
  const flushNow = useCallback(async (): Promise<PersistOutcome> => {
    const sent = providersRef.current;
    mutatedSinceSend.current = new Set();
    try {
      const saved = await portRef.current.saveMediaProviders(sent);
      if (!alive.current) return { status: 'abandoned' };
      const touched = mutatedSinceSend.current;
      const next: MediaProviderMap = { ...saved };
      for (const providerId of touched) {
        const local = providersRef.current[providerId];
        if (local === undefined) delete next[providerId];
        else next[providerId] = local;
      }
      applyProviders(next);
      // Everything this write sent is now persisted; only edits made during
      // the flight are still unflushed.
      applyPending(new Set([...pendingRef.current].filter((providerId) => touched.has(providerId))));
      setSave({ status: 'saved' });
      return { status: 'saved' };
    } catch (error: unknown) {
      if (!alive.current) return { status: 'abandoned' };
      setSave({ status: 'save-error', message: error instanceof Error ? error.message : String(error) });
      return { status: 'failed' };
    }
  }, [applyProviders, applyPending]);

  /** True while a write is at the port. */
  const writing = useRef(false);
  /** The single coalesced follow-up write requested during that one. */
  const queued = useRef<{ readonly promise: Promise<PersistOutcome>; readonly settle: (outcome: PersistOutcome) => void } | null>(null);

  /**
   * The whole-map contract makes concurrent writes unorderable, so this hook
   * issues at most ONE at a time.
   *
   * `saveMediaProviders` replaces the ENTIRE map and carries no
   * expected-revision (`ports.ts`), so when two writes overlap the daemon keeps
   * whichever it happens to handle LAST — not whichever the operator issued
   * last. A response-side ticket cannot fix that: it only decides which
   * RESPONSE may write UI state, while the losing REQUEST has already rewritten
   * the server. Save-then-Clear could therefore show a cleared credential,
   * report success, and leave the credential intact on the daemon.
   *
   * Serializing removes the precondition instead of guarding the symptom — with
   * one write in flight, request order IS commit order. A second request
   * arriving while one is already queued coalesces into it rather than adding a
   * third round trip, because both would send the same send-time map anyway.
   */
  const persist = useCallback((): Promise<PersistOutcome> => {
    setSave({ status: 'saving' });

    if (writing.current) {
      if (queued.current === null) {
        let settle!: (outcome: PersistOutcome) => void;
        const promise = new Promise<PersistOutcome>((resolve) => {
          settle = resolve;
        });
        queued.current = { promise, settle };
      }
      return queued.current.promise;
    }

    writing.current = true;
    return (async () => {
      try {
        let outcome = await flushNow();
        while (queued.current !== null) {
          const waiter = queued.current;
          queued.current = null;
          outcome = await flushNow();
          waiter.settle(outcome);
        }
        return outcome;
      } finally {
        writing.current = false;
      }
    })();
  }, [flushNow]);

  const fetchAndReconcile = useCallback(
    (migrateOnFirstUpload: boolean) => {
      const ticket = ++loadTicket.current;
      const isCurrent = () => alive.current && loadTicket.current === ticket;
      const localBeforeMerge = providersRef.current;
      setLoad({ status: 'loading' });
      portRef.current.fetchMediaProviders().then((daemonResult) => {
        if (!isCurrent()) return;
        if (daemonResult == null) {
          // Unreachable is a value, not a failure (see this port's doc) —
          // local state is left exactly as it was, never defaulted to {}.
          setLoad({ status: 'unreachable' });
          return;
        }
        const merged = mergeDaemonProviders(localBeforeMerge, daemonResult, {
          preserveLocalProviderIds: pendingRef.current,
        });
        applyProviders(merged);
        setLoad({ status: 'ok' });
        if (migrateOnFirstUpload && shouldSyncLocalProvidersToDaemon(localBeforeMerge, daemonResult)) {
          void persist();
        }
      });
    },
    [persist, applyProviders],
  );

  useEffect(() => {
    // Mount (or host-supplied port swap): migration is a one-time boot
    // check, matching the origin's App.tsx boot sequence — a manual
    // `reload()` below must not re-trigger it on every click.
    fetchAndReconcile(true);
  }, [port, fetchAndReconcile]);

  const reload = useCallback(() => {
    fetchAndReconcile(false);
  }, [fetchAndReconcile]);

  const updateProvider = useCallback(
    (providerId: string, patch: MediaProviderEditPatch) => {
      const current = providersRef.current;
      const nextEntry: MediaProviderCredentials = { ...(current[providerId] ?? {}), ...patch };
      const nextMap = { ...current };
      if (isEntryEmpty(nextEntry)) {
        delete nextMap[providerId];
      } else {
        nextMap[providerId] = nextEntry;
      }
      applyProviders(nextMap);
      const currentPending = pendingRef.current;
      if (!currentPending.has(providerId)) applyPending(new Set(currentPending).add(providerId));
      mutatedSinceSend.current.add(providerId);
    },
    [applyProviders, applyPending],
  );

  const clearProvider = useCallback(
    (providerId: string) => {
      void (async () => {
        const previousEntry = providersRef.current[providerId];
        const next = { ...providersRef.current };
        delete next[providerId];
        applyProviders(next);
        mutatedSinceSend.current.add(providerId);
        const outcome = await persist();
        // A FAILED save rolls the optimistic clear back so the operator does
        // not lose a credential the daemon never actually dropped — same
        // rollback shape as `useProjectLocationsTab.removeDraft`.
        if (outcome.status !== 'failed' || !alive.current) return;
        if (previousEntry === undefined) return;
        // Restore ONLY this provider, into whatever the map is NOW. Restoring
        // the whole pre-clear snapshot (as this used to) would silently discard
        // an edit made to a DIFFERENT provider while the save was in flight —
        // the same whole-map-replacement mistake the port makes, repeated
        // locally. And if the operator has since re-entered this provider by
        // hand, their value wins over the rollback.
        if (providersRef.current[providerId] !== undefined) return;
        applyProviders({ ...providersRef.current, [providerId]: previousEntry });
      })();
    },
    [persist, applyProviders],
  );

  const saveChanges = useCallback(() => {
    void persist();
  }, [persist]);

  return {
    providers,
    load,
    save,
    hasAnyConfigured: hasAnyConfiguredProvider(providers),
    pendingProviderIds,
    updateProvider,
    clearProvider,
    saveChanges,
    reload,
  };
}
