import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { CONNECTOR_AUTH_PENDING_POLL_MS } from '../constants.js';
import type {
  ConnectorAuthBridgePort,
  ConnectorAuthPendingStoragePort,
  ConnectorsPort,
} from '../ports.js';
import {
  applyConnectorStatuses,
  clearConnectorAuthorizationCancelFailuresForConnected,
  clearConnectorAuthorizationErrorsForConnected,
  clearConnectorAuthorizationPending,
  findStaleAuthorizations,
  hasConnectorStatusChanges,
  mergeConnectorActionResult,
  pruneConnectorAuthorizationPending,
  updateConnectorAuthorizationPendingFromConnectResponse,
  updateConnectorAuthorizationPendingFromStatuses,
  withoutKey,
} from '../rules.js';
import type {
  Connector,
  ConnectorAction,
  ConnectorActionResult,
  ConnectorAuthorizationPendingState,
  ConnectorAuthResultEvent,
  ConnectorStatusMap,
  PendingConnectorAction,
} from '../types.js';

export interface UseConnectorAuthorizationParams {
  connectors: Connector[];
  setConnectors: Dispatch<SetStateAction<Connector[]>>;
  /** Fired when a status refresh detects a real connect/disconnect change (for cross-surface refresh). */
  onConnectorsChanged?: () => void;
  onAuthResult?: (event: ConnectorAuthResultEvent) => void;
  pollMs?: number;
}

export interface ConnectorAuthorizationController {
  pending: ConnectorAuthorizationPendingState;
  cancelFailed: Record<string, boolean>;
  authError: Record<string, string>;
  pendingConnectorAction: PendingConnectorAction | null;
  reloadStatuses: () => Promise<ConnectorStatusMap>;
  runConnectorAction: (connectorId: string, action: ConnectorAction) => Promise<void>;
  cancelAuthorization: (connectorId: string) => Promise<void>;
}

export interface ConnectorActionSetters {
  onConnectorsChanged?: (() => void) | undefined;
  onAuthResult?: ((event: ConnectorAuthResultEvent) => void) | undefined;
  setPending: Dispatch<SetStateAction<ConnectorAuthorizationPendingState>>;
  setAuthError: Dispatch<SetStateAction<Record<string, string>>>;
}

/** Reports a thrown (as opposed to a resolved failure result) connector
 *  action failure via `onAuthResult`, then rethrows — shared by both
 *  {@link performConnectorConnect}'s and {@link performConnectorDisconnect}'s
 *  catch blocks, which previously duplicated this formatting. Exported for
 *  direct unit testing. */
export function reportThrownConnectorActionFailure(
  { connectorId, action }: { connectorId: string; action: ConnectorAction },
  { onAuthResult }: { onAuthResult?: ((event: ConnectorAuthResultEvent) => void) | undefined },
  err: unknown,
): never {
  onAuthResult?.({
    connectorId,
    action,
    result: 'failed',
    errorCode: err instanceof Error ? err.message : String(err),
  });
  throw err;
}

/** The resolved-success half of `performConnectorConnect`'s result handling. */
function applyConnectorConnectSuccess(
  { connectorId, result }: { connectorId: string; result: ConnectorActionResult },
  { onConnectorsChanged, onAuthResult, setPending }: Omit<ConnectorActionSetters, 'setAuthError'> & {
    setPending: Dispatch<SetStateAction<ConnectorAuthorizationPendingState>>;
  },
): void {
  if (result.connector?.status === 'connected') onConnectorsChanged?.();
  setPending((curr) => updateConnectorAuthorizationPendingFromConnectResponse(curr, result, Date.now()));
  onAuthResult?.({ connectorId, action: 'connect', result: 'success' });
}

/** The resolved-failure half of `performConnectorConnect`'s result handling
 *  (a `{ error }` result, as opposed to a thrown rejection). */
function applyConnectorConnectFailureResult(
  { connectorId, result }: { connectorId: string; result: ConnectorActionResult },
  { onAuthResult, setPending, setAuthError }: ConnectorActionSetters,
): void {
  setPending((curr) => clearConnectorAuthorizationPending(curr, connectorId));
  if (result.error) {
    setAuthError((curr) => ({ ...curr, [connectorId]: result.error! }));
  }
  onAuthResult?.({ connectorId, action: 'connect', result: 'failed', ...(result.error ? { errorCode: result.error } : {}) });
}

/** `runConnectorAction`'s `'connect'` branch, thinly wrapped by the callback
 *  below — isolated so its own control flow (success / failed-result /
 *  thrown) is readable and testable without a rendered hook. Exported for
 *  direct unit testing; not part of this package's public barrel. */
export async function performConnectorConnect(
  { connectorId, port, updateConnector }: { connectorId: string; port: ConnectorsPort; updateConnector: (next: Connector | null) => void },
  { onConnectorsChanged, onAuthResult, setPending, setAuthError, setCancelFailed }: ConnectorActionSetters & {
    setCancelFailed: Dispatch<SetStateAction<Record<string, boolean>>>;
  },
): Promise<void> {
  setCancelFailed((curr) => withoutKey({ record: curr, key: connectorId }));
  setAuthError((curr) => withoutKey({ record: curr, key: connectorId }));
  try {
    const result = await port.connectConnector(connectorId);
    updateConnector(result.connector);
    if (result.connector && !result.error) {
      applyConnectorConnectSuccess({ connectorId, result }, { onConnectorsChanged, onAuthResult, setPending });
      return;
    }
    applyConnectorConnectFailureResult({ connectorId, result }, { onAuthResult, setPending, setAuthError });
  } catch (err) {
    reportThrownConnectorActionFailure({ connectorId, action: 'connect' }, { onAuthResult }, err);
  }
}

/** `runConnectorAction`'s `'disconnect'` branch — see {@link performConnectorConnect}. */
export async function performConnectorDisconnect(
  { connectorId, port, updateConnector }: { connectorId: string; port: ConnectorsPort; updateConnector: (next: Connector | null) => void },
  { onConnectorsChanged, onAuthResult, setPending, setAuthError }: ConnectorActionSetters,
): Promise<void> {
  setPending((curr) => clearConnectorAuthorizationPending(curr, connectorId));
  setAuthError((curr) => withoutKey({ record: curr, key: connectorId }));
  try {
    updateConnector(await port.disconnectConnector(connectorId));
    onConnectorsChanged?.();
    onAuthResult?.({ connectorId, action: 'disconnect', result: 'success' });
  } catch (err) {
    reportThrownConnectorActionFailure({ connectorId, action: 'disconnect' }, { onAuthResult }, err);
  }
}

type PendingSetter = Dispatch<SetStateAction<ConnectorAuthorizationPendingState>>;
type CancelFailedSetter = Dispatch<SetStateAction<Record<string, boolean>>>;
type AuthErrorSetter = Dispatch<SetStateAction<Record<string, string>>>;
type UpdateConnector = (next: Connector | null) => void;

/** Cancels authorizations that were pending before a refocus reload but are no longer in flight. */
function useCancelStaleAuthorizations({ port, updateConnector, setCancelFailed, setAuthError, setPending }: {
  port: ConnectorsPort; updateConnector: UpdateConnector; setCancelFailed: CancelFailedSetter;
  setAuthError: AuthErrorSetter; setPending: PendingSetter;
}, _options = {}) {
  return useCallback(
    async (pendingBeforeReload: ConnectorAuthorizationPendingState, statuses: ConnectorStatusMap) => {
      const stuck = findStaleAuthorizations(pendingBeforeReload, statuses, Date.now());
      if (stuck.length === 0) return;
      await Promise.allSettled(
        stuck.map(async (connectorId) => {
          let connector: Connector | null = null;
          try {
            connector = await port.cancelConnectorAuthorization(connectorId);
          } catch {
            connector = null;
          }
          if (!connector) {
            setCancelFailed((curr) => ({ ...curr, [connectorId]: true }));
            return;
          }
          updateConnector(connector);
          setCancelFailed((curr) => withoutKey({ record: curr, key: connectorId }));
          // This clear's `curr[connectorId] !== undefined` guard is
          // structurally unreachable as *true*: `authError[connectorId]`
          // and `pending[connectorId]` (this function only ever runs for
          // ids that were in `pendingBeforeReload`) can never both be set
          // for the same id at the same time. Every path that sets
          // `authError[id]` (`runConnectorAction`'s connect-failure branch)
          // unconditionally clears `pending[id]` in that same update, and
          // the only path that ever sets `pending[id]` to a new truthy
          // value again (a later connect call's success branch)
          // unconditionally clears `authError[id]` first, before ever
          // reaching its own success branch. So by the time any id reaches
          // this stale-sweep success path with a real `pending[id]` entry,
          // `authError[id]` is guaranteed already absent. Left in place
          // (not stripped) as a guard against a future refactor breaking
          // that invariant — see archived UI provenance ledger's 2026-07-22
          // dated entry for the full proof.
          // Correction (2026-10-21 coverage pass): the proof above misses one interleaving. While this
          // sweep's `cancelConnectorAuthorization` call is still awaiting, a `runConnectorAction(id,
          // 'connect')` that resolves with `{ error }` sets `authError[id]`; the cancel then succeeds and
          // this clear removes that NEWER error. Reproduced in
          // `__tests__/hooks/useConnectorAuthorization.stale-race.test.ts`; flagged for an owner decision
          // on whether the sweep should leave a fresher error alone.
          setAuthError((curr) => withoutKey({ record: curr, key: connectorId }));
          setPending((curr) => clearConnectorAuthorizationPending(curr, connectorId));
        }),
      );
    },
    [port, updateConnector],
  );
}

/** Persists pending state, polls while anything is in flight, and listens for callback/refocus. */
function useAuthorizationLifecycleEffects({ pending, pendingRef, authPendingStorage, authBridge, pollMs }: {
  pending: ConnectorAuthorizationPendingState; pendingRef: { current: ConnectorAuthorizationPendingState };
  authPendingStorage: ConnectorAuthPendingStoragePort; authBridge: ConnectorAuthBridgePort; pollMs: number;
}, { setPending, reloadStatuses, cancelStaleAuthorizations }: {
  setPending: PendingSetter; reloadStatuses: () => Promise<ConnectorStatusMap>;
  cancelStaleAuthorizations: (before: ConnectorAuthorizationPendingState, statuses: ConnectorStatusMap) => Promise<void>;
}) {
  // Persist pending state whenever it changes.
  useEffect(() => {
    authPendingStorage.save(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replacing storage requires rehydrating pending state before writing it.
  }, [pending]);

  // Poll statuses while any authorization is in flight.
  useEffect(() => {
    if (Object.keys(pending).length === 0) return undefined;
    const interval = setInterval(() => {
      setPending((curr) => pruneConnectorAuthorizationPending(curr, Date.now()));
      void reloadStatuses();
    }, pollMs);
    return () => clearInterval(interval);
  }, [pending, pollMs, reloadStatuses]);

  // OAuth popup/system-browser callback.
  useEffect(() => authBridge.subscribeAuthCallback(() => void reloadStatuses()), [authBridge, reloadStatuses]);

  // Refresh + auto-cancel stale authorizations on window refocus.
  useEffect(
    () =>
      authBridge.subscribeWindowRefocus(() => {
        void (async () => {
          const pendingBeforeReload = pendingRef.current;
          const statuses = await reloadStatuses();
          await cancelStaleAuthorizations(pendingBeforeReload, statuses);
        })();
      }),
    [authBridge, reloadStatuses, cancelStaleAuthorizations],
  );
}

/** Runs one connect/disconnect at a time, tracking the in-flight action. */
function useRunConnectorAction({ port, updateConnector, pendingConnectorAction, setPendingConnectorAction }: {
  port: ConnectorsPort; updateConnector: UpdateConnector; pendingConnectorAction: PendingConnectorAction | null;
  setPendingConnectorAction: Dispatch<SetStateAction<PendingConnectorAction | null>>;
}, { onConnectorsChanged, onAuthResult, setPending, setAuthError, setCancelFailed }: {
  onConnectorsChanged: (() => void) | undefined; onAuthResult: ((event: ConnectorAuthResultEvent) => void) | undefined;
  setPending: PendingSetter; setAuthError: AuthErrorSetter; setCancelFailed: CancelFailedSetter;
}) {
  return useCallback(
    async (connectorId: string, action: ConnectorAction) => {
      if (pendingConnectorAction) return;
      setPendingConnectorAction({ connectorId, action });
      try {
        if (action === 'connect') {
          await performConnectorConnect(
            { connectorId, port, updateConnector },
            { onConnectorsChanged, onAuthResult, setPending, setAuthError, setCancelFailed },
          );
        } else {
          await performConnectorDisconnect(
            { connectorId, port, updateConnector },
            { onConnectorsChanged, onAuthResult, setPending, setAuthError },
          );
        }
      } finally {
        setPendingConnectorAction(null);
      }
    },
    [pendingConnectorAction, port, updateConnector, onConnectorsChanged, onAuthResult],
  );
}

/** User-initiated cancel; falls back to a status reload when the cancel call returns nothing. */
function useCancelAuthorization({ port, updateConnector, reloadStatuses, setCancelFailed, setAuthError, setPending }: {
  port: ConnectorsPort; updateConnector: UpdateConnector; reloadStatuses: () => Promise<ConnectorStatusMap>;
  setCancelFailed: CancelFailedSetter; setAuthError: AuthErrorSetter; setPending: PendingSetter;
}, _options = {}) {
  return useCallback(
    async (connectorId: string) => {
      const connector = await port.cancelConnectorAuthorization(connectorId);
      if (connector) {
        updateConnector(connector);
        setCancelFailed((curr) => withoutKey({ record: curr, key: connectorId }));
        setAuthError((curr) => withoutKey({ record: curr, key: connectorId }));
        setPending((curr) => clearConnectorAuthorizationPending(curr, connectorId));
        return;
      }
      try {
        const statuses = await reloadStatuses();
        if (statuses[connectorId]?.status === 'connected') return;
      } catch {
        // Keep the local failure visible when the status refresh itself fails.
      }
      setCancelFailed((curr) => ({ ...curr, [connectorId]: true }));
    },
    [port, updateConnector, reloadStatuses],
  );
}

/**
 * The concurrency-correctness core: persists in-flight OAuth authorization
 * state, polls statuses while anything is pending, listens for the OAuth
 * popup's postMessage callback, and refreshes + auto-cancels stale
 * authorizations on window refocus (a system-browser auth flow has no
 * opener to post back to, so this is the only way that path resolves).
 */
export function useConnectorAuthorization(
  port: ConnectorsPort,
  authPendingStorage: ConnectorAuthPendingStoragePort,
  authBridge: ConnectorAuthBridgePort,
  params: UseConnectorAuthorizationParams,
): ConnectorAuthorizationController {
  const { connectors, setConnectors, onConnectorsChanged, onAuthResult, pollMs = CONNECTOR_AUTH_PENDING_POLL_MS } = params;

  const [pending, setPending] = useState<ConnectorAuthorizationPendingState>(() =>
    pruneConnectorAuthorizationPending(authPendingStorage.load(), Date.now()),
  );
  const [cancelFailed, setCancelFailed] = useState<Record<string, boolean>>({});
  const [authError, setAuthError] = useState<Record<string, string>>({});
  const [pendingConnectorAction, setPendingConnectorAction] = useState<PendingConnectorAction | null>(null);

  const connectorsRef = useRef(connectors);
  useEffect(() => {
    connectorsRef.current = connectors;
  }, [connectors]);

  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const updateConnector = useCallback(
    (next: Connector | null) => {
      if (!next) return;
      setConnectors((curr) => curr.map((c) => (c.id === next.id ? mergeConnectorActionResult(c, next) : c)));
    },
    [setConnectors],
  );

  const reloadStatuses = useCallback(async (): Promise<ConnectorStatusMap> => {
    const statuses = await port.fetchConnectorStatuses();
    const statusChanged = hasConnectorStatusChanges(connectorsRef.current, statuses);
    setConnectors((curr) => applyConnectorStatuses(curr, statuses));
    setPending((curr) => updateConnectorAuthorizationPendingFromStatuses(curr, statuses, Date.now()));
    setAuthError((curr) => clearConnectorAuthorizationErrorsForConnected(curr, statuses));
    setCancelFailed((curr) => clearConnectorAuthorizationCancelFailuresForConnected(curr, statuses));
    if (statusChanged) onConnectorsChanged?.();
    return statuses;
  }, [port, setConnectors, onConnectorsChanged]);

  const cancelStaleAuthorizations = useCancelStaleAuthorizations({ port, updateConnector, setCancelFailed, setAuthError, setPending });
  useAuthorizationLifecycleEffects(
    { pending, pendingRef, authPendingStorage, authBridge, pollMs },
    { setPending, reloadStatuses, cancelStaleAuthorizations },
  );
  const runConnectorAction = useRunConnectorAction(
    { port, updateConnector, pendingConnectorAction, setPendingConnectorAction },
    { onConnectorsChanged, onAuthResult, setPending, setAuthError, setCancelFailed },
  );
  const cancelAuthorization = useCancelAuthorization({ port, updateConnector, reloadStatuses, setCancelFailed, setAuthError, setPending });

  return { pending, cancelFailed, authError, pendingConnectorAction, reloadStatuses, runConnectorAction, cancelAuthorization };
}
