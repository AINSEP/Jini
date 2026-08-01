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
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const pendingRef = useRef(pendingProviderIds);
  pendingRef.current = pendingProviderIds;

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
   * The same guard for the SAVE edge, which had none.
   *
   * `saveChanges` and `clearProvider` both go through `persist`, the port
   * replaces the WHOLE map, and nothing disables Clear while a save is in
   * flight — so an ordinary Save-then-Clear double-click issues two overlapping
   * whole-map writes. If the earlier save (whose map still contained the
   * provider) resolves last, its `setProviders(saved)` puts the just-cleared
   * credential back on screen and marks it pending again. Only the newest
   * persist may write state.
   */
  const persistTicket = useRef(0);

  /**
   * `'superseded'` is deliberately distinct from `'failed'`, not folded into it.
   * `clearProvider` rolls its optimistic delete back when a save does not
   * succeed — but rolling back a save that was merely OVERTAKEN would restore
   * the pre-clear map and resurrect exactly the credential this fix is about.
   * A superseded save is not a failure and must produce no state change at all.
   */
  type PersistOutcome =
    | { readonly status: 'saved'; readonly map: MediaProviderMap }
    | { readonly status: 'failed' }
    | { readonly status: 'superseded' };

  const persist = useCallback(async (next: MediaProviderMap): Promise<PersistOutcome> => {
    const ticket = ++persistTicket.current;
    setSave({ status: 'saving' });
    try {
      const saved = await portRef.current.saveMediaProviders(next);
      if (!alive.current || persistTicket.current !== ticket) return { status: 'superseded' };
      setProviders(saved);
      setPendingProviderIds(new Set());
      setSave({ status: 'saved' });
      return { status: 'saved', map: saved };
    } catch (error: unknown) {
      if (!alive.current || persistTicket.current !== ticket) return { status: 'superseded' };
      setSave({ status: 'save-error', message: error instanceof Error ? error.message : String(error) });
      return { status: 'failed' };
    }
  }, []);

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
        setProviders(merged);
        setLoad({ status: 'ok' });
        if (migrateOnFirstUpload && shouldSyncLocalProvidersToDaemon(localBeforeMerge, daemonResult)) {
          void persist(merged);
        }
      });
    },
    [persist],
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

  const updateProvider = useCallback((providerId: string, patch: MediaProviderEditPatch) => {
    setProviders((current) => {
      const nextEntry: MediaProviderCredentials = { ...(current[providerId] ?? {}), ...patch };
      const nextMap = { ...current };
      if (isEntryEmpty(nextEntry)) {
        delete nextMap[providerId];
      } else {
        nextMap[providerId] = nextEntry;
      }
      return nextMap;
    });
    setPendingProviderIds((current) => (current.has(providerId) ? current : new Set(current).add(providerId)));
  }, []);

  const clearProvider = useCallback(
    (providerId: string) => {
      void (async () => {
        const previousProviders = providersRef.current;
        const next = { ...previousProviders };
        delete next[providerId];
        setProviders(next);
        const outcome = await persist(next);
        // A FAILED save rolls the optimistic clear back so the operator does
        // not lose a credential the daemon never actually dropped — same
        // rollback shape as `useProjectLocationsTab.removeDraft`. A SUPERSEDED
        // one must not: a newer persist already owns the state, and restoring
        // this call's pre-clear snapshot would put the cleared credential back.
        if (outcome.status === 'failed' && alive.current) setProviders(previousProviders);
      })();
    },
    [persist],
  );

  const saveChanges = useCallback(() => {
    void persist(providersRef.current);
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
