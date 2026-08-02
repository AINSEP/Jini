import { useT } from '../../i18n/index.js';
import type { Connector, ConnectorAction, ConnectorAuthorizationPendingState } from '../types.js';
import { ConnectorCard } from './ConnectorCard.js';
import { ConnectorGate, type ConnectorGateProps } from './ConnectorGate.js';

export interface ConnectorGridProps {
  connectors: readonly Connector[];
  locked: boolean;
  hasNoResults: boolean;
  searchQuery: string;
  pendingConnectorAction: { connectorId: string; action: ConnectorAction } | null;
  authorizationPending: ConnectorAuthorizationPendingState;
  authorizationCancelFailed: Record<string, boolean>;
  toolsLoaded: boolean;
  onConnect: (connectorId: string) => void;
  onDisconnect: (connectorId: string) => void;
  onCancelAuthorization: (connectorId: string) => void;
  onOpenDetails: (connectorId: string) => void;
  onOpenExternalUrl?: (url: string) => void;
  getCategoryLabel?: (category: string) => string;
  onClearSearch: () => void;
  gate?: ConnectorGateProps;
  emptyNoMatchTitle?: (query: string) => string;
  emptyNoMatchBody?: string;
  emptyNoMatchAction?: string;
}

/** Card grid + the search-empty-state and locked-gate overlays. */
export function ConnectorGrid({
  connectors,
  locked,
  hasNoResults,
  searchQuery,
  pendingConnectorAction,
  authorizationPending,
  authorizationCancelFailed,
  toolsLoaded,
  onConnect,
  onDisconnect,
  onCancelAuthorization,
  onOpenDetails,
  onOpenExternalUrl,
  getCategoryLabel,
  onClearSearch,
  gate,
  emptyNoMatchTitle,
  emptyNoMatchBody,
  emptyNoMatchAction,
}: ConnectorGridProps) {
  const t = useT();
  const resolvedEmptyNoMatchTitle =
    emptyNoMatchTitle ?? ((query: string) => t('No connectors match "{query}"', { query }));
  const resolvedEmptyNoMatchBody = emptyNoMatchBody ?? t('Try a different search term.');
  const resolvedEmptyNoMatchAction = emptyNoMatchAction ?? t('Clear search');
  return (
    <div className={`connector-grid-wrap${locked ? ' is-masked' : ''}`} data-testid="connector-grid-wrap">
      {hasNoResults && !locked ? (
        <div className="tab-empty connectors-empty" role="status" aria-live="polite" data-testid="connectors-empty">
          <p className="connectors-empty-title">{resolvedEmptyNoMatchTitle(searchQuery.trim())}</p>
          <p className="connectors-empty-body">{resolvedEmptyNoMatchBody}</p>
          <button type="button" className="ghost connectors-empty-action" onClick={onClearSearch}>
            {resolvedEmptyNoMatchAction}
          </button>
        </div>
      ) : (
        <div className="connector-grid" aria-hidden={locked || undefined}>
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              disabled={locked}
              pendingAction={pendingConnectorAction?.connectorId === connector.id ? pendingConnectorAction.action : null}
              authorizationPending={authorizationPending[connector.id]}
              authorizationCancelFailed={authorizationCancelFailed[connector.id] === true}
              toolsLoaded={toolsLoaded}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onCancelAuthorization={onCancelAuthorization}
              onOpenDetails={onOpenDetails}
              {...(getCategoryLabel ? { getCategoryLabel } : {})}
              {...(onOpenExternalUrl ? { onOpenExternalUrl } : {})}
            />
          ))}
        </div>
      )}
      {locked && gate ? <ConnectorGate {...gate} /> : null}
    </div>
  );
}
