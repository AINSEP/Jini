import { useCallback, useMemo, useState } from 'react';
import { agentSubHandle } from '@jini-ai/agentic';
import { useT } from '../i18n/index.js';
import {
  AUTHORIZATION_CANCEL_FAILED_MESSAGE,
  DEFAULT_PROVIDER_TAB_ID,
  DEFAULT_PROVIDER_TABS,
} from './constants.js';
import type { ConnectorsDependencies } from './ports.js';
import {
  connectorPanelAlerts,
  scopeConnectorsToProvider,
  sortConnectorsForSearch,
} from './rules.js';
import type { Connector, ConnectorAuthResultEvent, ProviderTab } from './types.js';
import type { useConnectorCatalog } from './hooks/useConnectorCatalog.js';
import type { ConnectorAuthorizationController, useConnectorAuthorization } from './hooks/useConnectorAuthorization.js';
import type { ConnectorDetailController, useConnectorDetail } from './hooks/useConnectorDetail.js';
import { useWiredConnectorsBrowser } from './hooks/useWiredConnectorsBrowser.js';
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
  /**
   * This browser's own agent handle, published by the host. The provider tab bar, the search bar,
   * every connector card, and the detail drawer all derive their own `data-agent-*` handle from
   * this ONE base via `agentSubHandle`/`agentHandleProps`. Omit and no `data-agent-*` markup is
   * emitted anywhere — additive, never a behavior change.
   */
  agentHandle?: string;
}

/** `{ agentHandle }` for a child derived from the browser's own handle, or `{}` when the host published none. */
function subHandleProp({ base, action }: { base: string | undefined; action: string }): { agentHandle?: string } {
  return base ? { agentHandle: agentSubHandle({ base, action }) } : {};
}

/** The connect/disconnect/cancel/open-url callbacks shared by the grid cards and the detail drawer. */
interface ConnectorActionCallbacks {
  onConnect: (connectorId: string) => void;
  onDisconnect: (connectorId: string) => void;
  onCancelAuthorization: (connectorId: string) => void;
  onOpenExternalUrl: (url: string) => void;
}

interface ConnectorsDetailPaneProps {
  detail: ConnectorDetailController;
  authorization: ConnectorAuthorizationController;
  unlocked: boolean;
  actions: ConnectorActionCallbacks;
  getCategoryLabel: ConnectorsBrowserProps['getCategoryLabel'];
  getDisplayableAccountLabel: ConnectorsBrowserProps['getDisplayableAccountLabel'];
  agentHandle: string | undefined;
}

/** The detail drawer for the connector currently opened, or nothing when none is. */
function ConnectorsDetailPane({
  detail,
  authorization,
  unlocked,
  actions,
  getCategoryLabel,
  getDisplayableAccountLabel,
  agentHandle,
}: ConnectorsDetailPaneProps) {
  const connector = detail.detailConnector;
  if (!connector) return null;
  const { pendingConnectorAction } = authorization;
  return (
    <ConnectorDetailDrawer
      connector={connector}
      disabled={!unlocked}
      pendingAction={pendingConnectorAction?.connectorId === connector.id ? pendingConnectorAction.action : null}
      authorizationPending={authorization.pending[connector.id]}
      authorizationCancelFailed={authorization.cancelFailed[connector.id] === true}
      authorizationError={authorization.authError[connector.id] ?? null}
      toolsPreviewLoading={detail.toolPreviewLoading}
      toolsLoaded={detail.toolsLoaded}
      onClose={detail.closeDetails}
      {...actions}
      onLoadMoreTools={(connectorId, cursor) => void detail.loadMoreTools(connectorId, cursor)}
      {...(getCategoryLabel ? { getCategoryLabel } : {})}
      {...(getDisplayableAccountLabel ? { getDisplayableAccountLabel } : {})}
      {...subHandleProp({ base: agentHandle, action: 'detail' })}
    />
  );
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
  catalogRefreshKey,
  dependencies,
  getCategoryLabel,
  getDisplayableAccountLabel,
  gate,
  onProviderTabClick,
  onConnectorAuthResult,
  onConnectorsChanged,
  useConnectorCatalog,
  useConnectorAuthorization,
  useConnectorDetail,
  agentHandle,
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
    onConnectorsChanged,
    onConnectorAuthResult,
    useConnectorCatalog,
    useConnectorAuthorization,
    useConnectorDetail,
  });

  const providerScopedConnectors = useMemo(
    () => scopeConnectorsToProvider(catalog.connectors, providerTabs, selectedProvider),
    [catalog.connectors, providerTabs, selectedProvider],
  );

  const filteredConnectors = useMemo(
    () => sortConnectorsForSearch(providerScopedConnectors, filter),
    [providerScopedConnectors, filter],
  );

  const hasNoResults = filter.trim().length > 0 && filteredConnectors.length === 0;

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

  const actions: ConnectorActionCallbacks = {
    onConnect: (connectorId) => void authorization.runConnectorAction(connectorId, 'connect'),
    onDisconnect: (connectorId) => void authorization.runConnectorAction(connectorId, 'disconnect'),
    onCancelAuthorization: (connectorId) => void authorization.cancelAuthorization(connectorId),
    onOpenExternalUrl: (url) => void deps.data.openExternalUrl(url),
  };

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
            {...subHandleProp({ base: agentHandle, action: 'provider' })}
          />
          <ConnectorSearchBar
            value={filter}
            onChange={setFilter}
            disabled={!unlocked}
            onFocus={() => onProviderTabClick?.('search_connectors')}
            {...subHandleProp({ base: agentHandle, action: 'search' })}
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
          {...actions}
          onOpenDetails={detail.openDetails}
          {...(getCategoryLabel ? { getCategoryLabel } : {})}
          onClearSearch={() => setFilter('')}
          {...(gate ? { gate: { ...gate, onClick: handleGateClick } } : {})}
          {...subHandleProp({ base: agentHandle, action: 'connector' })}
        />
      )}

      <ConnectorsDetailPane
        detail={detail}
        authorization={authorization}
        unlocked={unlocked}
        actions={actions}
        getCategoryLabel={getCategoryLabel}
        getDisplayableAccountLabel={getDisplayableAccountLabel}
        agentHandle={agentHandle}
      />
    </div>
  );
}
