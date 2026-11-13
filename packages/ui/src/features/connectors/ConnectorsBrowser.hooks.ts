import { useCallback, useMemo, useState } from 'react';
import type { useT } from '../i18n/index.js';
import { AUTHORIZATION_CANCEL_FAILED_MESSAGE, DEFAULT_PROVIDER_TAB_ID } from './constants.js';
import { connectorPanelAlerts, scopeConnectorsToProvider, sortConnectorsForSearch } from './rules.js';
import { useWiredConnectorsBrowser } from './hooks/useWiredConnectorsBrowser.js';
import type { ConnectorsBrowserProps, ConnectorActionCallbacks } from './ConnectorsBrowser.js';
import type { ProviderTab } from './types.js';

type BrowserInput = { [K in 'unlocked' | 'catalogRefreshKey' | 'dependencies' | 'getCategoryLabel' | 'gate' | 'onProviderTabClick' | 'onConnectorAuthResult' | 'onConnectorsChanged' | 'useConnectorCatalog' | 'useConnectorAuthorization' | 'useConnectorDetail']: ConnectorsBrowserProps[K] } & {
  providerTabs: readonly ProviderTab[]; t: ReturnType<typeof useT>;
};

/** Wire the connector catalog, filtering, provider selection, and host actions. */
export function useConnectorsBrowserView({ unlocked, providerTabs, catalogRefreshKey, dependencies, getCategoryLabel, gate, onProviderTabClick, onConnectorAuthResult, onConnectorsChanged, useConnectorCatalog, useConnectorAuthorization, useConnectorDetail, t }: BrowserInput, _options = {}) {
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

  const categoryLabelProps = getCategoryLabel ? { getCategoryLabel } : {};
  const gateProps = gate ? { gate: { ...gate, onClick: handleGateClick } } : {};
  return { filter, setFilter, selectedProvider, catalog, authorization, detail, filteredConnectors, hasNoResults, alerts, handleProviderTabSelect, actions, categoryLabelProps, gateProps };
}
