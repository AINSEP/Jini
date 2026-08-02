import { useMemo } from 'react';
import { createFakeConnectorsDependencies } from '../dependencies.js';
import type { ConnectorsDependencies } from '../ports.js';
import type { ConnectorAuthResultEvent } from '../types.js';
import { useConnectorCatalog, type ConnectorCatalogController } from './useConnectorCatalog.js';
import { useConnectorAuthorization, type ConnectorAuthorizationController } from './useConnectorAuthorization.js';
import { useConnectorDetail, type ConnectorDetailController } from './useConnectorDetail.js';

export interface UseWiredConnectorsBrowserParams {
  /** Host-supplied dependencies. Omit to fall back to the package's in-memory fake. */
  dependencies?: ConnectorsDependencies | undefined;
  unlocked: boolean;
  catalogRefreshKey?: string | number | undefined;
  onConnectorsChanged?: (() => void) | undefined;
  onConnectorAuthResult?: ((event: ConnectorAuthResultEvent) => void) | undefined;
  /** Custom hook overrides for dependency injection / testing — mirrors `ConnectorsBrowserProps`. */
  useConnectorCatalog?: typeof useConnectorCatalog;
  useConnectorAuthorization?: typeof useConnectorAuthorization;
  useConnectorDetail?: typeof useConnectorDetail;
}

export interface WiredConnectorsBrowserController {
  /** The resolved dependency bundle (host-supplied, or the package's fake) — still needed by the host
   *  component for the one call site (`openExternalUrl`) that isn't already surfaced by a sub-controller. */
  deps: ConnectorsDependencies;
  catalog: ConnectorCatalogController;
  authorization: ConnectorAuthorizationController;
  detail: ConnectorDetailController;
}

/**
 * Wirer for `ConnectorsBrowser`'s whole dependency cluster: resolves
 * `dependencies` (host-supplied, or the package's in-memory fake) once, then
 * runs the catalog/authorization/detail hooks against it in the order each
 * depends on the last (`authorization` and `detail` both read/write
 * `catalog`'s `connectors` state). Mirrors `features/asset-grid/`'s
 * `useWiredAssetGridData` shape: the only export here that touches a
 * concrete adapter, so `ConnectorsBrowser` itself never imports
 * `dependencies.ts` directly. The three sub-hooks stay independently
 * fake-able (via this hook's own override params, threaded straight through
 * from `ConnectorsBrowserProps`) — this wirer only collapses the *dependency
 * resolution*, not the sub-hooks' individual test seams.
 */
export function useWiredConnectorsBrowser(params: UseWiredConnectorsBrowserParams): WiredConnectorsBrowserController {
  const {
    dependencies,
    unlocked,
    catalogRefreshKey = 0,
    onConnectorsChanged,
    onConnectorAuthResult,
    useConnectorCatalog: useConnectorCatalogHook = useConnectorCatalog,
    useConnectorAuthorization: useConnectorAuthorizationHook = useConnectorAuthorization,
    useConnectorDetail: useConnectorDetailHook = useConnectorDetail,
  } = params;

  const deps = useMemo(() => dependencies ?? createFakeConnectorsDependencies(), [dependencies]);

  const catalog = useConnectorCatalogHook(deps.data, { unlocked, refreshKey: catalogRefreshKey });
  const authorization = useConnectorAuthorizationHook(deps.data, deps.authPendingStorage, deps.authBridge, {
    connectors: catalog.connectors,
    setConnectors: catalog.setConnectors,
    ...(onConnectorsChanged ? { onConnectorsChanged } : {}),
    ...(onConnectorAuthResult ? { onAuthResult: onConnectorAuthResult } : {}),
  });
  const toolPreviewRetryToken = `${unlocked ? 'configured' : 'unconfigured'}:${String(catalogRefreshKey)}`;
  const detail = useConnectorDetailHook(deps.data, {
    connectors: catalog.connectors,
    setConnectors: catalog.setConnectors,
    unlocked,
    retryToken: toolPreviewRetryToken,
  });

  return { deps, catalog, authorization, detail };
}
