// Sub-hooks of `useMemoryConnectors`, split by responsibility: the catalogue/status
// reads, connect-flow auth state, selection derivation, and the scan → suggest →
// save loop. State shared across the auth/list seam is owned by the orchestrator
// and threaded in (see the design note in `useMemoryConnectors.hooks.ts`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyConnectorStatuses, hasConnectorStatusChanges, withoutConnectedEntries } from '../../../connectors/rules.js';
import type { Connector, ConnectorStatusMap } from '../../../connectors/types.js';
import { createAsyncCommitGuard } from '../../async-commit-guard.js';
import {
  DEFAULT_CONNECTOR_PROVIDER,
  MEMORY_CONNECTOR_APP_IDS,
  MEMORY_CONNECTOR_APP_LABELS,
} from '../../constants.js';
import { describeExtractionFailure } from '../../formatters.js';
import type { MemoryConnectorsPort } from '../../ports.js';
import { applyMemoryConnectorStatus, memoryEntryIdForConnectorSuggestion } from '../../rules.js';
import type { ConnectorMemoryAttempt, MemoryExtractionRecord, MemorySuggestion } from '../../types.js';
import {
  describeConnectorSuggestionOutcome,
  describeConnectorSuggestionsSaveOutcome,
  isRecentFailedConnectorExtraction,
} from './useMemoryConnectors.rules.js';

/** `onSaveConnectorSuggestions`'s save loop, isolated: writes each selected
 *  suggestion as a memory entry in order, collecting which ones landed and
 *  the first thrown failure (a later item's failure does not roll back an
 *  earlier item's success). The caller decides what to do with the result —
 *  this only performs the writes. Exported for direct unit testing; not part
 *  of this package's public barrel. */
export async function saveSelectedConnectorSuggestions({
  suggestions,
  port,
}: {
  suggestions: MemorySuggestion[];
  port: Pick<MemoryConnectorsPort, 'saveMemoryEntry'>;
}): Promise<{ savedSuggestionIds: Set<string>; failure: unknown }> {
  const savedSuggestionIds = new Set<string>();
  let failure: unknown;
  try {
    for (const suggestion of suggestions) {
      const entry = await port.saveMemoryEntry({
        id: memoryEntryIdForConnectorSuggestion(suggestion),
        name: suggestion.name,
        description: suggestion.description ?? '',
        type: suggestion.type,
        body: suggestion.body,
      });
      if (entry) {
        savedSuggestionIds.add(suggestion.id);
      }
    }
  } catch (err) {
    failure = err;
  }
  return { savedSuggestionIds, failure };
}

/** Connect-flow state: which connectors are mid-authorization / connecting / errored. */
export function useConnectorAuthState(port: MemoryConnectorsPort) {
  const [pendingConnectorAuthIds, setPendingConnectorAuthIds] = useState<Set<string>>(port.readPendingConnectorAuthIds);
  const [connectorConnectErrors, setConnectorConnectErrors] = useState<Record<string, string>>({});
  const [connectingConnectorIds, setConnectingConnectorIds] = useState<Set<string>>(() => new Set());
  // Two synchronous `onConnectMemoryConnector(id)` calls in the SAME React
  // batch (e.g. a double-click before the first render commits) would both
  // read the same pre-update `connectingConnectorIds` closure and both pass
  // the re-entrancy guard below — React state updates aren't visible to
  // their own batch. This ref is updated synchronously (not batched), so the
  // second call in the same batch still sees the first one's claim.
  const connectingConnectorIdsRef = useRef<Set<string>>(new Set());

  // Persist which connectors are mid-authorization so a reload resumes polling
  // instead of stranding a half-finished OAuth handshake.
  useEffect(() => {
    port.writePendingConnectorAuthIds(pendingConnectorAuthIds);
  }, [pendingConnectorAuthIds, port]);

  return {
    pendingConnectorAuthIds,
    setPendingConnectorAuthIds,
    connectorConnectErrors,
    setConnectorConnectErrors,
    connectingConnectorIds,
    setConnectingConnectorIds,
    connectingConnectorIdsRef,
  };
}

type ConnectorAuthState = ReturnType<typeof useConnectorAuthState>;

/** Catalogue/status state, the ordering guards, and the synchronous status commit. */
function useCatalogueCore() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorStatuses, setConnectorStatuses] = useState<ConnectorStatusMap>({});
  const [connectorsLoading, setConnectorsLoading] = useState(true);
  // Discovery and status polling are independent reads. Keeping one error for
  // both made a successful status poll erase a still-live catalogue failure,
  // so the UI falsely implied that all connector data had recovered.
  const [connectorCatalogueLoadError, setConnectorCatalogueLoadError] = useState<string | null>(null);
  const [connectorStatusLoadError, setConnectorStatusLoadError] = useState<string | null>(null);
  const connectorsRef = useRef(connectors);
  const connectorStatusesRef = useRef(connectorStatuses);
  // Two independent ordering domains, not one. The status snapshot
  // (`connectorStatuses`) is written by both `reloadConnectors` and
  // `refreshConnectorStatuses` (the OAuth poll and popup callback can
  // overlap too) — only the newest of those may commit. The full-details
  // catalogue (`connectors`, via `fetchMemoryConnectors`) is written ONLY by
  // `reloadConnectors` — a status-only refresh must NOT invalidate an
  // in-flight catalogue fetch, or the freshly-fetched discovery response
  // gets silently discarded while `connectorsLoading` still clears (the
  // catalogue guard is independent of the reload-loading guard below too).
  const connectorStatusGuardRef = useRef(createAsyncCommitGuard());
  const connectorCatalogueGuardRef = useRef(createAsyncCommitGuard());
  const connectorReloadGuardRef = useRef(createAsyncCommitGuard());

  useEffect(() => {
    connectorsRef.current = connectors;
  }, [connectors]);

  useEffect(() => {
    connectorStatusesRef.current = connectorStatuses;
  }, [connectorStatuses]);

  // Commits a new status map. `connectorStatusesRef` is updated SYNCHRONOUSLY
  // here rather than relying solely on the effect above: a catalogue fetch
  // that resolves in the microtask gap between this state commit and the
  // effect's flush would otherwise read a one-cycle-stale ref, silently
  // defeating the "merge against the latest status" guarantee below. The
  // effect stays as a backup sync for any status write that doesn't route
  // through here.
  // Commits a new status map. `connectorStatusesRef` is updated SYNCHRONOUSLY
  // here rather than relying solely on the effect above: a catalogue fetch
  // that resolves in the microtask gap between this state commit and the
  // effect's flush would otherwise read a one-cycle-stale ref, silently
  // defeating the "merge against the latest status" guarantee below. The
  // effect stays as a backup sync for any status write that doesn't route
  // through here.
  const commitConnectorStatuses = useCallback((statuses: ConnectorStatusMap) => {
    connectorStatusesRef.current = statuses;
    setConnectorStatuses(statuses);
  }, []);

  return {
    connectors,
    setConnectors,
    connectorStatuses,
    connectorsLoading,
    setConnectorsLoading,
    setConnectorCatalogueLoadError,
    setConnectorStatusLoadError,
    connectorCatalogueLoadError,
    connectorStatusLoadError,
    connectorsRef,
    connectorStatusesRef,
    connectorStatusGuardRef,
    connectorCatalogueGuardRef,
    connectorReloadGuardRef,
    commitConnectorStatuses,
  };
}

type CatalogueCore = ReturnType<typeof useCatalogueCore>;

/** Full reload: statuses first, then the discovery catalogue, each committing only if still the newest. */
function useReloadConnectors(port: MemoryConnectorsPort, core: CatalogueCore) {
  const {
    setConnectors, setConnectorsLoading, setConnectorCatalogueLoadError, setConnectorStatusLoadError,
    connectorStatusesRef, connectorStatusGuardRef, connectorCatalogueGuardRef, connectorReloadGuardRef, commitConnectorStatuses,
  } = core;

  return useCallback(async () => {
    const statusRevision = connectorStatusGuardRef.current.begin();
    const catalogueRevision = connectorCatalogueGuardRef.current.begin();
    const reloadRevision = connectorReloadGuardRef.current.begin();
    setConnectorsLoading(true);
    try {
      const statuses = await port.fetchConnectorStatuses();
      if (connectorStatusGuardRef.current.isCurrent(statusRevision)) {
        commitConnectorStatuses(statuses);
        setConnectors((prev) => applyConnectorStatuses(prev, statuses));
        setConnectorStatusLoadError(null);
      }
    } catch {
      if (connectorStatusGuardRef.current.isCurrent(statusRevision)) {
        setConnectorStatusLoadError("Connected app statuses couldn't be loaded. Try again shortly.");
      }
      // The catalogue response contains its own connector status. Continue
      // with that independent read so a status-poll outage does not turn known
      // connected apps into an unusable empty state; the status error remains
      // visible until a status retry succeeds.
    }
    try {
      const next = await port.fetchMemoryConnectors();
      if (!connectorCatalogueGuardRef.current.isCurrent(catalogueRevision)) return;
      // Merge against the LATEST known status map, not the `statuses` value
      // captured above — a newer status commit (poll, callback, or this same
      // reload's own status step racing a concurrent refresh) may have landed
      // while this discovery fetch was still in flight, and stamping the
      // captured snapshot back over it would silently revert it.
      setConnectors(applyConnectorStatuses(next, connectorStatusesRef.current));
      setConnectorCatalogueLoadError(null);
    } catch {
      // Discovery is required for the real catalogue. Keep prior details rather
      // than replacing them with synthetic empty rows, and make the outage
      // visible to the user.
      if (connectorCatalogueGuardRef.current.isCurrent(catalogueRevision)) {
        setConnectorCatalogueLoadError("Connected apps couldn't be loaded. Try again shortly.");
      }
    } finally {
      if (connectorReloadGuardRef.current.isCurrent(reloadRevision)) {
        setConnectorsLoading(false);
      }
    }
  }, [port, commitConnectorStatuses]);
}

/** Status-only refresh; also reconciles pending-auth / connect-error state from the new statuses. */
function useRefreshConnectorStatuses(port: MemoryConnectorsPort, core: CatalogueCore, auth: ConnectorAuthState) {
  const { setPendingConnectorAuthIds, setConnectorConnectErrors } = auth;
  const { setConnectors, setConnectorStatusLoadError, connectorsRef, connectorStatusGuardRef, commitConnectorStatuses } = core;

  return useCallback(async () => {
    const revision = connectorStatusGuardRef.current.begin();
    let statuses: ConnectorStatusMap;
    try {
      statuses = await port.fetchConnectorStatuses();
    } catch {
      // This function is called by the background OAuth poll and popup callback
      // subscriptions as well as the connect action. Keep its failures in UI
      // state so those fire-and-forget callers cannot produce an unhandled
      // rejection or undo the optimistic connector update.
      if (connectorStatusGuardRef.current.isCurrent(revision)) {
        setConnectorStatusLoadError("Connected app statuses couldn't be loaded. Try again shortly.");
      }
      return;
    }
    if (!connectorStatusGuardRef.current.isCurrent(revision)) return;
    const statusChanged = hasConnectorStatusChanges(connectorsRef.current, statuses);
    commitConnectorStatuses(statuses);
    setConnectors((prev) => applyConnectorStatuses(prev, statuses));
    setConnectorStatusLoadError(null);
    setPendingConnectorAuthIds((prev) => {
      const next = new Set(prev);
      for (const connectorId of prev) {
        if (statuses[connectorId]?.status === 'connected') next.delete(connectorId);
      }
      return next.size === prev.size ? prev : next;
    });
    setConnectorConnectErrors((prev) => withoutConnectedEntries({ record: prev, statuses }));
    if (statusChanged) port.notifyConnectorsChanged();
  }, [port, commitConnectorStatuses, setPendingConnectorAuthIds, setConnectorConnectErrors]);
}

/** The connector catalogue + status snapshot, with ordered commits. */
export function useConnectorCatalogue(port: MemoryConnectorsPort, auth: ConnectorAuthState) {
  const core = useCatalogueCore();
  const reloadConnectors = useReloadConnectors(port, core);
  const refreshConnectorStatuses = useRefreshConnectorStatuses(port, core, auth);

  return {
    connectors: core.connectors,
    setConnectors: core.setConnectors,
    connectorStatuses: core.connectorStatuses,
    connectorsLoading: core.connectorsLoading,
    connectorLoadError: core.connectorCatalogueLoadError ?? core.connectorStatusLoadError,
    connectorCatalogueGuardRef: core.connectorCatalogueGuardRef,
    reloadConnectors,
    refreshConnectorStatuses,
  };
}

/** The fixed memory-app rows, each overlaid with its connector details/status (synthesised when undiscovered). */
function buildMemoryConnectors(connectors: Connector[], connectorStatuses: ConnectorStatusMap): Connector[] {
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));
  return MEMORY_CONNECTOR_APP_IDS.map((id) => {
    const connector = byId.get(id);
    const status = connectorStatuses[id];
    if (connector) {
      return status ? applyMemoryConnectorStatus(connector, status) : connector;
    }
    return {
      id,
      // `MEMORY_CONNECTOR_APP_LABELS` is typed to require every
      // MEMORY_CONNECTOR_APP_IDS entry to have a label, so this lookup
      // can't miss — no `?? id` fallback needed (or reachable).
      name: MEMORY_CONNECTOR_APP_LABELS[id],
      provider: DEFAULT_CONNECTOR_PROVIDER,
      category: 'Memory source',
      status: status?.status ?? ('available' as const),
      ...(status?.accountLabel ? { accountLabel: status.accountLabel } : {}),
      ...(status?.lastError ? { lastError: status.lastError } : {}),
      tools: [],
    };
  });
}

/** Memory-app connector rows + which of them are selected for a scan. */
export function useConnectorSelection(connectors: Connector[], connectorStatuses: ConnectorStatusMap) {
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<Set<string>>(() => new Set());

  const memoryConnectors = useMemo(
    () => buildMemoryConnectors(connectors, connectorStatuses),
    [connectorStatuses, connectors],
  );
  const connectorIdsWithDetails = useMemo(() => new Set(connectors.map((connector) => connector.id)), [connectors]);
  const connectedMemoryConnectors = useMemo(
    () => memoryConnectors.filter((connector) => connector.status === 'connected'),
    [memoryConnectors],
  );
  const selectedConnectedConnectorIds = useMemo(
    () => [...selectedConnectorIds].filter((id) => connectedMemoryConnectors.some((connector) => connector.id === id)),
    [selectedConnectorIds, connectedMemoryConnectors],
  );

  // Prune selection down to still-connected apps: disconnecting an app should
  // not leave it selected for a scan.
  useEffect(() => {
    setSelectedConnectorIds((prev) => {
      const connectedIds = connectedMemoryConnectors.map((connector) => connector.id);
      const connected = new Set(connectedIds);
      const next = new Set([...prev].filter((id) => connected.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [connectedMemoryConnectors]);

  const toggleConnectorSelection = useCallback((connectorId: string) => {
    setSelectedConnectorIds((prev) => {
      const next = new Set(prev);
      if (next.has(connectorId)) {
        next.delete(connectorId);
      } else {
        next.add(connectorId);
      }
      return next;
    });
  }, []);

  return {
    selectedConnectorIds,
    memoryConnectors,
    connectorIdsWithDetails,
    connectedMemoryConnectors,
    selectedConnectedConnectorIds,
    connectedCount: connectedMemoryConnectors.length,
    toggleConnectorSelection,
  };
}

interface ConnectorSuggestionsDeps {
  port: MemoryConnectorsPort;
  reload: () => Promise<void>;
  reloadExtractions: () => Promise<MemoryExtractionRecord[]>;
  chatAgentId: string | null;
  chatModel: string | null;
  selectedConnectedConnectorIds: string[];
}

/** Suggestion list/selection plus the scan/save status surfaces. */
function useSuggestionState() {
  const [connectorSuggestions, setConnectorSuggestions] = useState<MemorySuggestion[]>([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(() => new Set());
  const [connectorAttempts, setConnectorAttempts] = useState<ConnectorMemoryAttempt[]>([]);
  const [connectorContextBytes, setConnectorContextBytes] = useState(0);
  const [connectorStatus, setConnectorStatus] = useState<string | null>(null);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const selectedConnectorSuggestions = useMemo(
    () => connectorSuggestions.filter((suggestion) => selectedSuggestionIds.has(suggestion.id)),
    [connectorSuggestions, selectedSuggestionIds],
  );

  const toggleConnectorSuggestion = useCallback((suggestionId: string) => {
    setSelectedSuggestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(suggestionId)) {
        next.delete(suggestionId);
      } else {
        next.add(suggestionId);
      }
      return next;
    });
  }, []);

  const onDiscardConnectorSuggestions = useCallback(() => {
    setConnectorSuggestions([]);
    setSelectedSuggestionIds(new Set());
    setConnectorAttempts([]);
    setConnectorContextBytes(0);
    setConnectorStatus(null);
  }, []);

  const resetForScan = useCallback(() => {
    setConnectorSuggestions([]);
    setSelectedSuggestionIds(new Set());
    setConnectorAttempts([]);
    setConnectorContextBytes(0);
    setConnectorStatus(null);
    setConnectorError(null);
  }, []);

  return {
    resetForScan,
    connectorSuggestions, setConnectorSuggestions,
    selectedSuggestionIds, setSelectedSuggestionIds,
    connectorAttempts, setConnectorAttempts,
    connectorContextBytes, setConnectorContextBytes,
    connectorStatus, setConnectorStatus,
    connectorError, setConnectorError,
    selectedConnectorSuggestions,
    toggleConnectorSuggestion,
    onDiscardConnectorSuggestions,
  };
}

type SuggestionState = ReturnType<typeof useSuggestionState>;

/** Scan the selected connected apps for memory suggestions. */
function useSuggestAction(
  { port, reloadExtractions, chatAgentId, chatModel, selectedConnectedConnectorIds }: ConnectorSuggestionsDeps,
  st: SuggestionState,
) {
  const [connectorExtracting, setConnectorExtracting] = useState(false);
  // Button disabled state is only visible after React commits. This ref makes
  // the scan re-entrancy guard synchronous too, so two calls in one
  // event batch cannot duplicate remote work or race stale results back in.
  const connectorExtractionInFlightRef = useRef(false);
  const {
    resetForScan, setConnectorSuggestions, setSelectedSuggestionIds, setConnectorAttempts, setConnectorContextBytes, setConnectorStatus, setConnectorError,
  } = st;

  const onSuggestConnectorMemory = useCallback(async () => {
    if (selectedConnectedConnectorIds.length === 0 || connectorExtractionInFlightRef.current) return;
    connectorExtractionInFlightRef.current = true;
    setConnectorExtracting(true);
    resetForScan();
    const startedAt = Date.now();
    try {
      const result = await port.suggestConnectorMemories(selectedConnectedConnectorIds, {
        chatAgentId,
        chatModel,
      });
      if (!result) {
        setConnectorError('Could not read connected apps. Try again from the connectors panel.');
        return;
      }
      const latestExtractions = await reloadExtractions();
      const latestFailure = latestExtractions.find((record) => isRecentFailedConnectorExtraction(record, startedAt));
      const friendlyFailure = latestFailure ? describeExtractionFailure(latestFailure) : null;
      setConnectorAttempts(result.connectors);
      setConnectorContextBytes(result.contextBytes);
      const succeeded = result.connectors.filter((connector) => connector.status === 'succeeded').length;
      const outcome = describeConnectorSuggestionOutcome({ result, friendlyFailure, succeeded });
      if (outcome.suggestions) {
        setConnectorSuggestions(outcome.suggestions);
        setSelectedSuggestionIds(new Set(outcome.suggestions.map((suggestion) => suggestion.id)));
      }
      if (outcome.status) setConnectorStatus(outcome.status);
      if (outcome.error) setConnectorError(outcome.error);
    } catch (err) {
      setConnectorError(err instanceof Error ? err.message : String(err));
    } finally {
      connectorExtractionInFlightRef.current = false;
      setConnectorExtracting(false);
    }
  }, [
    chatAgentId, chatModel, reloadExtractions, selectedConnectedConnectorIds, port, resetForScan, setConnectorSuggestions,
    setSelectedSuggestionIds, setConnectorAttempts, setConnectorContextBytes, setConnectorStatus, setConnectorError,
  ]);

  return { connectorExtracting, onSuggestConnectorMemory };
}

/** Save the selected suggestions as memory entries, reconciling partial successes. */
function useSaveAction({ port, reload }: ConnectorSuggestionsDeps, st: SuggestionState) {
  const [connectorSaving, setConnectorSaving] = useState(false);
  const connectorSaveInFlightRef = useRef(false);
  const { selectedConnectorSuggestions, setConnectorSuggestions, setSelectedSuggestionIds, setConnectorStatus, setConnectorError } = st;

  const onSaveConnectorSuggestions = useCallback(async () => {
    if (selectedConnectorSuggestions.length === 0 || connectorSaveInFlightRef.current) return;
    connectorSaveInFlightRef.current = true;
    setConnectorSaving(true);
    setConnectorError(null);
    try {
      const { savedSuggestionIds, failure: saveFailure } = await saveSelectedConnectorSuggestions({
        suggestions: selectedConnectorSuggestions,
        port,
      });

      // A save can succeed before a later request fails. Refresh and reconcile
      // those confirmed writes before reporting the failure, so saved suggestions
      // do not remain visible as retryable rows.
      let failure = saveFailure;
      if (savedSuggestionIds.size > 0 || !failure) {
        try {
          await reload();
        } catch (err) {
          failure ??= err;
        }
      }

      if (savedSuggestionIds.size > 0) {
        setConnectorSuggestions((prev) => prev.filter((suggestion) => !savedSuggestionIds.has(suggestion.id)));
        // The user can still change the remaining checkboxes while this save
        // is in flight. Reconcile against that CURRENT selection rather than
        // restoring the callback's stale snapshot of selected suggestions.
        setSelectedSuggestionIds((prev) => new Set([...prev].filter((suggestionId) => !savedSuggestionIds.has(suggestionId))));
      }

      // The `selectedConnectorSuggestions.length === 0` early-return above
      // guarantees the list is non-empty here, so a zero-saved outcome always
      // has `size !== length` and is already covered by the branch below —
      // there is no separate "0 of 0" case to report.
      const { status, error } = describeConnectorSuggestionsSaveOutcome({
        savedCount: savedSuggestionIds.size,
        totalCount: selectedConnectorSuggestions.length,
        failure,
      });
      if (status) setConnectorStatus(status);
      if (error) setConnectorError(error);
    } finally {
      connectorSaveInFlightRef.current = false;
      setConnectorSaving(false);
    }
  }, [reload, selectedConnectorSuggestions, port, setConnectorSuggestions, setSelectedSuggestionIds, setConnectorStatus, setConnectorError]);

  return { connectorSaving, onSaveConnectorSuggestions };
}

/** Scan → suggest → save: turns connected-app content into memory entries. */
export function useConnectorSuggestions(deps: ConnectorSuggestionsDeps) {
  const st = useSuggestionState();
  const { connectorExtracting, onSuggestConnectorMemory } = useSuggestAction(deps, st);
  const { connectorSaving, onSaveConnectorSuggestions } = useSaveAction(deps, st);

  return {
    connectorExtracting,
    connectorSaving,
    connectorSuggestions: st.connectorSuggestions,
    selectedSuggestionIds: st.selectedSuggestionIds,
    connectorAttempts: st.connectorAttempts,
    connectorContextBytes: st.connectorContextBytes,
    connectorStatus: st.connectorStatus,
    connectorError: st.connectorError,
    selectedConnectorSuggestions: st.selectedConnectorSuggestions,
    toggleConnectorSuggestion: st.toggleConnectorSuggestion,
    onSuggestConnectorMemory,
    onDiscardConnectorSuggestions: st.onDiscardConnectorSuggestions,
    onSaveConnectorSuggestions,
  };
}
