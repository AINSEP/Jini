import { useCallback, useMemo, useState } from 'react';
import { useT } from '../i18n/index.js';
import type { ConnectorsDependencies } from '@jini-ai/ui-core';
import type { Connector, ConnectorAuthResultEvent, ProviderTab } from '@jini-ai/ui-core';
import { useConnectorCatalog } from './hooks/useConnectorCatalog.js';
import { useConnectorAuthorization } from './hooks/useConnectorAuthorization.js';
import { useConnectorDetail } from './hooks/useConnectorDetail.js';
import { useWiredConnectorsBrowser } from './hooks/useWiredConnectorsBrowser.js';
import { connectorPanelAlerts, scopeConnectorsToProvider, sortConnectorsForSearch } from '@jini-ai/ui-core';
import { AUTHORIZATION_CANCEL_FAILED_MESSAGE, DEFAULT_PROVIDER_TABS, DEFAULT_PROVIDER_TAB_ID } from '@jini-ai/ui-core';
import { CenteredLoader } from '../../react/components/Loading.js';
import { ProviderTabBar } from './components/ProviderTabBar.js';
import { ConnectorSearchBar } from './components/ConnectorSearchBar.js';
import { ConnectorAlertList } from './components/ConnectorAlertList.js';
import { ConnectorGrid } from './components/ConnectorGrid.js';
import { ConnectorDetailDrawer } from './components/ConnectorDetailDrawer.js';
import type { ConnectorGateProps } from './components/ConnectorGate.js';

export interface ConnectorsBrowserProps {
  /** Whether the host's provider is configured (e.g. an API key is saved) — gates enrichment + unmasks the grid. */
  unlocked: boolean;
  providerTabs?: readonly ProviderTab[];
  catalogRefreshKey?: string | number;
  dependencies?: ConnectorsDependencies;
  getCategoryLabel?: (category: string) => string;
  getDisplayableAccountLabel?: (connector: Connector) => string | undefined;
  /** Copy + link for the locked/gated state. Omit to hide the gate overlay entirely while locked. */
  gate?: ConnectorGateProps;
  onProviderTabClick?: (element: 'provider_chip' | 'search_connectors' | 'gate_card') => void;
  onConnectorAuthResult?: (event: ConnectorAuthResultEvent) => void;
  onConnectorsChanged?: () => void;
  /** Custom hook overrides for dependency injection / testing. */
  useConnectorCatalog?: typeof useConnectorCatalog;
  useConnectorAuthorization?: typeof useConnectorAuthorization;
  useConnectorDetail?: typeof useConnectorDetail;
}

/**
 * Connector cards + search — an OAuth integration marketplace UI. Owns its
 * own data lifecycle: fetches the catalog on mount, lazily enriches once
 * `unlocked`, and rehydrates statuses on window focus and OAuth callback
 * messages. Ported from OD's `ConnectorsBrowser.tsx` — see
 * `packages/ui/source-map.md` for full provenance.
 */
export function ConnectorsBrowser({
  unlocked,
  providerTabs = DEFAULT_PROVIDER_TABS,
  catalogRefreshKey = 0,
  dependencies,
  getCategoryLabel,
  getDisplayableAccountLabel,
  gate,
  onProviderTabClick,
  onConnectorAuthResult,
  onConnectorsChanged,
  useConnectorCatalog: useConnectorCatalogHook = useConnectorCatalog,
  useConnectorAuthorization: useConnectorAuthorizationHook = useConnectorAuthorization,
  useConnectorDetail: useConnectorDetailHook = useConnectorDetail,
}: ConnectorsBrowserProps) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>(providerTabs[0]?.id ?? DEFAULT_PROVIDER_TAB_ID);

  // Dependency resolution (host-supplied, or the package's in-memory fake)
  // plus the catalog/authorization/detail cluster all live in one wirer —
  // see `hooks/useWiredConnectorsBrowser.ts` — matching `features/asset-grid/`'s
  // `useWiredAssetGridData` precedent for keeping "which adapter" out of the
  // component. The three sub-hooks stay independently overridable for tests.
  const { deps, catalog, authorization, detail } = useWiredConnectorsBrowser({
    dependencies,
    unlocked,
    catalogRefreshKey,
    ...(onConnectorsChanged ? { onConnectorsChanged } : {}),
    ...(onConnectorAuthResult ? { onConnectorAuthResult } : {}),
    useConnectorCatalog: useConnectorCatalogHook,
    useConnectorAuthorization: useConnectorAuthorizationHook,
    useConnectorDetail: useConnectorDetailHook,
  });

  const providerScopedConnectors = useMemo(
    () => scopeConnectorsToProvider(catalog.connectors, providerTabs, selectedProvider),
    [catalog.connectors, providerTabs, selectedProvider],
  );

  const filteredConnectors = useMemo(
    () => sortConnectorsForSearch(providerScopedConnectors, filter),
    [providerScopedConnectors, filter],
  );

  const hasQuery = filter.trim().length > 0;
  const hasNoResults = hasQuery && filteredConnectors.length === 0;

  const alerts = useMemo(
    () =>
      connectorPanelAlerts(
        catalog.connectors,
        detail.detailConnectorId,
        authorization.authError,
        authorization.cancelFailed,
        t(AUTHORIZATION_CANCEL_FAILED_MESSAGE),
      ),
    [catalog.connectors, detail.detailConnectorId, authorization.authError, authorization.cancelFailed, t],
  );

  const handleProviderTabSelect = useCallback(
    (id: string) => {
      onProviderTabClick?.('provider_chip');
      setSelectedProvider(id);
    },
    [onProviderTabClick],
  );

  const handleGateClick = useCallback(() => {
    onProviderTabClick?.('gate_card');
    gate?.onClick?.();
  }, [onProviderTabClick, gate]);

  return (
    <div className="tab-panel connectors-panel connectors-panel-embedded">
      <div className="tab-panel-toolbar">
        <div className="toolbar-left connectors-heading">
          <div>
            <h2>{t('Connectors')}</h2>
            <p>{t('Connect third-party tools and services.')}</p>
          </div>
        </div>
        <div className="toolbar-right">
          <ProviderTabBar
            tabs={providerTabs}
            selectedId={selectedProvider}
            onSelect={handleProviderTabSelect}
          />
          <ConnectorSearchBar
            value={filter}
            onChange={setFilter}
            disabled={!unlocked}
            onFocus={() => onProviderTabClick?.('search_connectors')}
          />
        </div>
      </div>

      <ConnectorAlertList alerts={alerts} onOpenDetails={detail.openDetails} />

      {catalog.loading ? (
        <CenteredLoader label={t('Loading…')} />
      ) : (
        <ConnectorGrid
          connectors={filteredConnectors}
          locked={!unlocked}
          hasNoResults={hasNoResults}
          searchQuery={filter}
          pendingConnectorAction={authorization.pendingConnectorAction}
          authorizationPending={authorization.pending}
          authorizationCancelFailed={authorization.cancelFailed}
          toolsLoaded={catalog.enriched}
          onConnect={(connectorId) => void authorization.runConnectorAction(connectorId, 'connect')}
          onDisconnect={(connectorId) => void authorization.runConnectorAction(connectorId, 'disconnect')}
          onCancelAuthorization={(connectorId) => void authorization.cancelAuthorization(connectorId)}
          onOpenDetails={detail.openDetails}
          onOpenExternalUrl={(url) => void deps.data.openExternalUrl(url)}
          {...(getCategoryLabel ? { getCategoryLabel } : {})}
          onClearSearch={() => setFilter('')}
          {...(gate ? { gate: { ...gate, onClick: handleGateClick } } : {})}
        />
      )}

      {detail.detailConnector ? (
        <ConnectorDetailDrawer
          connector={detail.detailConnector}
          disabled={!unlocked}
          pendingAction={
            authorization.pendingConnectorAction?.connectorId === detail.detailConnector.id
              ? authorization.pendingConnectorAction.action
              : null
          }
          authorizationPending={authorization.pending[detail.detailConnector.id]}
          authorizationCancelFailed={authorization.cancelFailed[detail.detailConnector.id] === true}
          authorizationError={authorization.authError[detail.detailConnector.id] ?? null}
          toolsPreviewLoading={detail.toolPreviewLoading}
          toolsLoaded={detail.toolsLoaded}
          onClose={detail.closeDetails}
          onConnect={(connectorId) => void authorization.runConnectorAction(connectorId, 'connect')}
          onDisconnect={(connectorId) => void authorization.runConnectorAction(connectorId, 'disconnect')}
          onCancelAuthorization={(connectorId) => void authorization.cancelAuthorization(connectorId)}
          onLoadMoreTools={(connectorId, cursor) => void detail.loadMoreTools(connectorId, cursor)}
          onOpenExternalUrl={(url) => void deps.data.openExternalUrl(url)}
          {...(getCategoryLabel ? { getCategoryLabel } : {})}
          {...(getDisplayableAccountLabel ? { getDisplayableAccountLabel } : {})}
        />
      ) : null}
    </div>
  );
}
