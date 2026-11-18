// Feature-local hook for the memory-connectors cluster: the connector
// list/status catalogue, per-connector OAuth connect flow, the mid-authorization
// status poll, selection, and the scan → suggest → save loop that turns
// connected-app content into memory entries.
//
// WHY ONE HOOK (design rationale, kept here so a future reader doesn't
// re-litigate it): the tempting split is "auth vs. list", but that is a bad
// seam. `refreshConnectorStatuses` writes the list domain (`connectors`,
// `connectorStatuses`) AND the auth domain (`pendingConnectorAuthIds`,
// `connectorConnectErrors`) in one pass, and the selection-reconcile effect
// keys off `connected` status — the exact thing the auth flow transitions. So
// auth↔list is bidirectional coupling over shared mutable state. Splitting there
// would thread setters across the boundary in both directions (routed through
// a host, since no hook may import another), i.e. relocate state across a
// seam and pay indirection for it — which is the "state relocation" disease
// this refactor exists to cure. Testability doesn't force the split either:
// the single hook already takes an injected port + coordination, so it
// unit-tests with a fake. If this ever earns a split, cut out SCAN/SUGGEST/SAVE
// (it only *reads* `selectedConnectedConnectorIds` and coordinates outward to
// `reload`/`reloadExtractions` — a clean, one-directional seam), not auth.
//
// UPDATE (size refactor): the hook body is now composed from per-responsibility
// sub-hooks in `useMemoryConnectors.parts.hooks.ts` (auth state, catalogue,
// selection, scan/suggest/save). The shared auth/list state is still owned by
// this orchestrator and threaded into them, so the coupling above is unchanged.
//
// WHERE THE EFFECTS LIVE (and why): a hook effect that opens an EXTERNAL,
// ACCUMULATING subscription (setInterval / addEventListener / EventSource) is a
// hazard if the hook is ever instantiated by more than one component — you get
// two pollers, two listeners, and silent double-fires. So those do NOT live
// here. The two OAuth subscriptions (the mid-auth status poll + the popup
// callback message) are owned by a host orchestrator, which is structurally a
// single instance; it drives this hook's exposed `refreshConnectorStatuses`
// through its own provider bridges. This hook keeps only INTERNAL-STATE
// effects (a ref sync, a selection reconcile, a pending-auth persist) — those
// can't accumulate or surprise, no matter how many instances exist. Same
// reasoning that keeps the SSE stream out of this hook, applied consistently.
// (Today the hook is single-consumer per the slice's feature-local rule, so
// this is defence-in-depth, not a live bug.)
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Connector, ConnectorActionResult, ConnectorStatusMap } from '../../../connectors/types.js';
import type { MemoryConnectorsPort } from '../../ports.js';
import {
  connectorWithPendingAuthorization,
  upsertMemoryConnector,
} from '../../rules.js';
import type {
  ConnectorMemoryAttempt,
  MemoryExtractionRecord,
  MemorySuggestion,
} from '../../types.js';
import { useMemoryPorts } from '../MemoryPorts.js';
import { withoutKey, withoutSetMember } from './useMemoryConnectors.rules.js';
import {
  saveSelectedConnectorSuggestions,
  useConnectorAuthState,
  useConnectorCatalogue,
  useConnectorSelection,
  useConnectorSuggestions,
} from './useMemoryConnectors.parts.hooks.js';

export { saveSelectedConnectorSuggestions };

/** Runtime coordination the connectors hook receives from a host: the
 *  entries reload (saving a suggestion mutates the memory list), the extraction
 *  reload (a connector scan surfaces failures in the extraction history), and
 *  the chat context the daemon uses to pick a model for the scan. */
export interface MemoryConnectorsCoordination {
  reload: () => Promise<void>;
  reloadExtractions: () => Promise<MemoryExtractionRecord[]>;
  chatAgentId: string | null;
  chatModel: string | null;
}

export interface MemoryConnectorsController {
  connectorStatuses: ConnectorStatusMap;
  connectorsLoading: boolean;
  selectedConnectorIds: Set<string>;
  connectorExtracting: boolean;
  connectorSaving: boolean;
  connectorSuggestions: MemorySuggestion[];
  selectedSuggestionIds: Set<string>;
  connectorAttempts: ConnectorMemoryAttempt[];
  connectorContextBytes: number;
  connectorStatus: string | null;
  connectorError: string | null;
  /** Non-null when the connector catalogue or its statuses could not be refreshed. */
  connectorLoadError: string | null;
  connectingConnectorIds: Set<string>;
  pendingConnectorAuthIds: Set<string>;
  connectorConnectErrors: Record<string, string>;
  memoryConnectors: Connector[];
  connectorIdsWithDetails: Set<string>;
  connectedMemoryConnectors: Connector[];
  selectedConnectedConnectorIds: string[];
  connectedCount: number;
  connectorScanLabel: string;
  selectedConnectorSuggestions: MemorySuggestion[];
  reloadConnectors: () => Promise<void>;
  /** Re-fetch connector statuses and reconcile pending-auth/error state. A
   *  host drives this from the OAuth poll + popup-callback subscriptions
   *  (which it owns, being a single instance). */
  refreshConnectorStatuses: () => Promise<void>;
  toggleConnectorSelection: (connectorId: string) => void;
  onConnectMemoryConnector: (connectorId: string) => Promise<void>;
  toggleConnectorSuggestion: (suggestionId: string) => void;
  onSuggestConnectorMemory: () => Promise<void>;
  onDiscardConnectorSuggestions: () => void;
  onSaveConnectorSuggestions: () => Promise<void>;
}

/** `onConnectMemoryConnector`'s "the port call itself threw" path (as
 *  opposed to a resolved `{ error }` result) — must still land in
 *  connect-error state instead of propagating as an unhandled rejection.
 *  Exported for direct unit testing; not part of this package's public
 *  barrel. */
export function applyMemoryConnectorConnectThrown(
  { connectorId, err }: { connectorId: string; err: unknown },
  {
    setConnectorConnectErrors,
    setPendingConnectorAuthIds,
  }: {
    setConnectorConnectErrors: Dispatch<SetStateAction<Record<string, string>>>;
    setPendingConnectorAuthIds: Dispatch<SetStateAction<Set<string>>>;
  },
): void {
  setConnectorConnectErrors((prev) => ({ ...prev, [connectorId]: err instanceof Error ? err.message : String(err) }));
  setPendingConnectorAuthIds((prev) => withoutSetMember(prev, connectorId));
}

/** `onConnectMemoryConnector`'s "the port call resolved" path: decides and
 *  applies the connector upsert, pending-auth membership, and connect-error
 *  state from the result. Returns whether the caller should follow up with a
 *  status refresh (skipped when the resolved result reported its own error).
 *  Exported for direct unit testing; not part of this package's public
 *  barrel. */
export function applyMemoryConnectorConnectResult(
  {
    connectorId,
    result,
    port,
  }: { connectorId: string; result: ConnectorActionResult; port: Pick<MemoryConnectorsPort, 'notifyConnectorsChanged'> },
  {
    setConnectors,
    setConnectorConnectErrors,
    setPendingConnectorAuthIds,
    invalidateCatalogueGuard,
  }: {
    setConnectors: Dispatch<SetStateAction<Connector[]>>;
    setConnectorConnectErrors: Dispatch<SetStateAction<Record<string, string>>>;
    setPendingConnectorAuthIds: Dispatch<SetStateAction<Set<string>>>;
    invalidateCatalogueGuard: () => void;
  },
): boolean {
  if (result.connector?.status === 'connected') port.notifyConnectorsChanged();
  const requiresAuthorizationCompletion = result.auth?.kind === 'redirect_required' || result.auth?.kind === 'pending';
  setConnectors((prev) =>
    upsertMemoryConnector(
      { current: prev,
      next: requiresAuthorizationCompletion && result.connector ? connectorWithPendingAuthorization(result.connector) : result.connector },
    ),
  );
  // This upsert just committed newer-than-any-in-flight-discovery truth for
  // this connector. Invalidate any older `reloadConnectors` catalogue fetch
  // so its (now stale) wholesale replace can't land after this and silently
  // overwrite what was just connected.
  invalidateCatalogueGuard();
  if (result.error) {
    setConnectorConnectErrors((prev) => ({ ...prev, [connectorId]: result.error! }));
    setPendingConnectorAuthIds((prev) => withoutSetMember(prev, connectorId));
    return false;
  }
  setPendingConnectorAuthIds((prev) =>
    requiresAuthorizationCompletion ? new Set(prev).add(connectorId) : withoutSetMember(prev, connectorId),
  );
  return true;
}

/** The per-connector connect flow (OAuth start), guarded against re-entrancy per connector id. */
function useConnectAction({ port, auth, catalogue }: {
  port: MemoryConnectorsPort;
  auth: ReturnType<typeof useConnectorAuthState>;
  catalogue: ReturnType<typeof useConnectorCatalogue>;
}) {
  const { setConnectorConnectErrors, setPendingConnectorAuthIds, setConnectingConnectorIds, connectingConnectorIdsRef } = auth;
  const { setConnectors, connectorCatalogueGuardRef, refreshConnectorStatuses } = catalogue;

  return useCallback(
    async (connectorId: string) => {
      if (connectingConnectorIdsRef.current.has(connectorId)) return;
      connectingConnectorIdsRef.current.add(connectorId);
      setConnectingConnectorIds((prev) => new Set(prev).add(connectorId));
      setConnectorConnectErrors((prev) => withoutKey({ record: prev, key: connectorId }));
      try {
        let result: ConnectorActionResult;
        try {
          result = await port.connectConnector(connectorId);
        } catch (err) {
          applyMemoryConnectorConnectThrown({ connectorId, err }, { setConnectorConnectErrors, setPendingConnectorAuthIds });
          return;
        }
        const shouldRefresh = applyMemoryConnectorConnectResult(
          { connectorId, result, port },
          {
            setConnectors,
            setConnectorConnectErrors,
            setPendingConnectorAuthIds,
            invalidateCatalogueGuard: () => connectorCatalogueGuardRef.current.invalidate(),
          },
        );
        if (shouldRefresh) await refreshConnectorStatuses();
      } finally {
        // The ref guard above means only one call per connectorId is ever
        // in-flight at a time, and nothing else touches this state — `prev`
        // is guaranteed to have `connectorId` here, so there is no "already
        // removed" case left to check.
        connectingConnectorIdsRef.current.delete(connectorId);
        setConnectingConnectorIds((prev) => {
          const next = new Set(prev);
          next.delete(connectorId);
          return next;
        });
      }
    },
    [refreshConnectorStatuses, port, setConnectorConnectErrors, setPendingConnectorAuthIds, setConnectingConnectorIds, connectingConnectorIdsRef, setConnectors, connectorCatalogueGuardRef],
  );
}

export function useMemoryConnectors(
  port: MemoryConnectorsPort,
  coord: MemoryConnectorsCoordination,
): MemoryConnectorsController {
  const auth = useConnectorAuthState(port);
  const catalogue = useConnectorCatalogue(port, auth);
  const selection = useConnectorSelection({ connectors: catalogue.connectors, connectorStatuses: catalogue.connectorStatuses });
  const suggestions = useConnectorSuggestions({
    port,
    ...coord,
    selectedConnectedConnectorIds: selection.selectedConnectedConnectorIds,
  });
  const onConnectMemoryConnector = useConnectAction({ port, auth, catalogue });

  // NOTE: the OAuth mid-auth status poll and popup-callback message listener are
  // deliberately NOT effects here — they open accumulating browser
  // subscriptions, so a host orchestrator (a guaranteed single instance) owns
  // them and drives `refreshConnectorStatuses` below. See the file header.

  const { connectorStatuses, connectorsLoading, connectorLoadError, reloadConnectors, refreshConnectorStatuses } = catalogue;
  const { memoryConnectors, connectedMemoryConnectors, connectedCount, selectedConnectedConnectorIds } = selection;
  const idleScanLabel = selectedConnectedConnectorIds.length === 0 ? 'Select apps to scan' : 'Scan selected apps';

  return {
    ...suggestions,
    connectorStatuses,
    connectorsLoading,
    selectedConnectorIds: selection.selectedConnectorIds,
    connectorLoadError,
    connectingConnectorIds: auth.connectingConnectorIds,
    pendingConnectorAuthIds: auth.pendingConnectorAuthIds,
    connectorConnectErrors: auth.connectorConnectErrors,
    memoryConnectors,
    connectorIdsWithDetails: selection.connectorIdsWithDetails,
    connectedMemoryConnectors,
    selectedConnectedConnectorIds,
    connectedCount,
    connectorScanLabel: suggestions.connectorExtracting ? 'Scanning apps' : idleScanLabel,
    reloadConnectors,
    refreshConnectorStatuses,
    toggleConnectorSelection: selection.toggleConnectorSelection,
    onConnectMemoryConnector,
  };
}

/**
 * Reads the host-injected connector catalogue/OAuth bridges from MemoryPortsProvider
 * (required), retaining runtime coordination. The deprecated demo catalogue is never a fallback.
 */
export function useWiredMemoryConnectors(coord: MemoryConnectorsCoordination): MemoryConnectorsController {
  return useMemoryConnectors(useMemoryPorts().connectors, coord);
}
