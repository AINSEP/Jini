// Dumb panel for the "Import from apps" (connected) tab: the source summary,
// the connector picker workbench (connect/select rows), the scan run bar, the
// suggestion review list, the status/error banners, the last-scan diagnostics,
// and the recent-scans history. Rendering only — every list, flag, and handler
// is supplied by a host's connectors/extractions hooks. Connector
// labels/byte counts come from the slice formatters. `ConnectorLogo` is
// `@jini-ai/ui`'s own (`features/connectors`) — it has no theme prop (that
// concern was already dropped when the connectors canary shipped; a host
// resolving theme-swapped logo URLs does so before handing `logoUrl` in).
import { useMemo } from 'react';
import { type Connector, type ConnectorStatusMap } from '../../../connectors/types.js';
import {
  connectorAttemptDetail,
  connectorAttemptTitle,
  formatConnectorContextBytes,
  memoryTypeLabels,
} from '../../formatters.js';
import type {
  ConnectorMemoryAttempt,
  MemoryExtractionRecord,
  MemorySuggestion,
} from '../../types.js';
import { ConnectorLogo } from '../../../connectors/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { MemoryExtractionCard } from './MemoryExtractionCard.js';

export function MemoryConnectedPanel({
  enabled,
  onOpenConnectors,
  connectorStatuses,
  connectorsLoading,
  connectedCount,
  selectedConnectorIds,
  selectedConnectedConnectorIds,
  connectingConnectorIds,
  pendingConnectorAuthIds,
  connectorConnectErrors,
  connectorIdsWithDetails,
  connectorExtracting,
  connectorSaving,
  connectorScanLabel,
  connectorSuggestions,
  selectedSuggestionIds,
  selectedConnectorSuggestions,
  connectorStatus,
  connectorError,
  connectorLoadError,
  connectorAttempts,
  connectorContextBytes,
  connectorExtractions,
  memoryConnectors,
  toggleConnectorSelection,
  onConnectMemoryConnector,
  toggleConnectorSuggestion,
  onSuggestConnectorMemory,
  onSaveConnectorSuggestions,
  onDiscardConnectorSuggestions,
  nowClock,
  onOpenPreview,
  onDeleteExtraction,
}: {
  enabled: boolean;
  onOpenConnectors?: (() => void) | undefined;
  connectorStatuses: ConnectorStatusMap;
  connectorsLoading: boolean;
  connectedCount: number;
  selectedConnectorIds: Set<string>;
  selectedConnectedConnectorIds: string[];
  connectingConnectorIds: Set<string>;
  pendingConnectorAuthIds: Set<string>;
  connectorConnectErrors: Record<string, string>;
  connectorIdsWithDetails: Set<string>;
  connectorExtracting: boolean;
  connectorSaving: boolean;
  connectorScanLabel: string;
  connectorSuggestions: MemorySuggestion[];
  selectedSuggestionIds: Set<string>;
  selectedConnectorSuggestions: MemorySuggestion[];
  connectorStatus: string | null;
  connectorError: string | null;
  connectorLoadError: string | null;
  connectorAttempts: ConnectorMemoryAttempt[];
  connectorContextBytes: number;
  connectorExtractions: MemoryExtractionRecord[];
  memoryConnectors: Connector[];
  toggleConnectorSelection: (connectorId: string) => void;
  onConnectMemoryConnector: (connectorId: string) => void;
  toggleConnectorSuggestion: (suggestionId: string) => void;
  onSuggestConnectorMemory: () => void;
  onSaveConnectorSuggestions: () => void;
  onDiscardConnectorSuggestions: () => void;
  /** Wall clock so extraction-card relative ages re-render without freezing. */
  nowClock: number;
  onOpenPreview: (id: string) => void;
  onDeleteExtraction: (id: string) => void;
}) {
  const t = useT();
  const typeLabel = useMemo(() => memoryTypeLabels(t), [t]);
  return (
    <div className="memory-tab-panel memory-connected-panel">
      <div className="memory-source-summary memory-connected-summary">
        <span className="memory-block-icon">
          <Icon name="link" size={15} />
        </span>
        <div>
          <h4>{t('Import from apps')}</h4>
          <p className="hint">
            {t('Choose apps to scan for design preferences, project context, and visual references. Nothing is scanned until you select an app.')}
          </p>
        </div>
        <span className="memory-source-badge">{connectorsLoading ? t('Loading') : `${connectedCount} ${t('connected')}`}</span>
        <button type="button" className="ghost memory-source-action" onClick={onOpenConnectors} disabled={!onOpenConnectors}>
          {t('Manage')}
        </button>
      </div>
      <div className="memory-connector-workbench">
        {connectorLoadError ? (
          <div role="alert" className="memory-connector-result is-error">
            {connectorLoadError}
          </div>
        ) : null}
        <div className="memory-connector-picker-head">
          <div>
            <h4>{t('Choose sources')}</h4>
            <p className="hint">{t('Select connected apps first. Only the apps you choose are scanned.')}</p>
          </div>
          <span className="memory-source-badge">
            {selectedConnectedConnectorIds.length} {t('selected')}
          </span>
        </div>
        <div className="memory-connector-list" aria-label={t('Connected memory apps')}>
          {memoryConnectors.map((connector) => {
            const connected = connector.status === 'connected';
            const selected = selectedConnectorIds.has(connector.id) && connected;
            const connecting = connectingConnectorIds.has(connector.id);
            const authorizationPending = pendingConnectorAuthIds.has(connector.id);
            const connectError = connectorConnectErrors[connector.id];
            const statusResolved = connectorIdsWithDetails.has(connector.id) || connectorStatuses[connector.id] !== undefined;
            const checkingStatus = connectorsLoading && !statusResolved && !connected && !authorizationPending && !connectError && !connecting;
            const connectorLastError = connector.lastError?.trim();
            const reconnecting = connector.status === 'error';
            const connectorHint = connected
              ? connector.accountLabel || `${connector.tools.length} ${t('read tools')}`
              : checkingStatus
                ? t('Checking connection status…')
                : authorizationPending
                  ? t('Finish authorization in your browser, then return here')
                  : connectorLastError || connectError || t('Connect this app before extraction');
            return (
              <label
                key={connector.id}
                className={`memory-connector-row${connected ? '' : ' is-disabled'}${selected ? ' is-selected' : ''}`}
                data-memory-connector-id={connector.id}
              >
                <input
                  className="memory-connector-input"
                  type="checkbox"
                  checked={selected}
                  disabled={!connected}
                  aria-label={`${t('Use')} ${connector.name} ${t('for memory extraction')}`}
                  onChange={() => toggleConnectorSelection(connector.id)}
                />
                <span className={`memory-connector-brand${selected ? ' is-selected' : ''}`}>
                  <ConnectorLogo connectorId={connector.id} connectorName={connector.name} logoUrl={connector.logoUrl} size="sm" />
                  <span className="memory-connector-selected-mark" aria-hidden="true">
                    {selected ? <Icon name="check" size={13} /> : null}
                  </span>
                </span>
                <span className="memory-connector-copy">
                  <strong>{connector.name}</strong>
                  <small>{connectorHint}</small>
                </span>
                {connected ? (
                  <span className={`memory-connector-picker${selected ? ' is-selected' : ''}`}>
                    <span className="memory-connector-picker-box" aria-hidden="true">
                      {selected ? <Icon name="check" size={12} /> : null}
                    </span>
                    <span>{selected ? t('Selected') : t('Select')}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`memory-connector-connect-button${connecting || authorizationPending || checkingStatus ? ' is-loading' : ''}`}
                    disabled={connecting || authorizationPending || checkingStatus}
                    aria-busy={connecting || authorizationPending || checkingStatus || undefined}
                    aria-label={`${reconnecting ? t('Reconnect') : t('Connect')} ${connector.name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onConnectMemoryConnector(connector.id);
                    }}
                  >
                    <Icon
                      name={connecting || authorizationPending || checkingStatus ? 'refresh' : 'plus'}
                      size={12}
                      className={connecting || authorizationPending || checkingStatus ? 'icon-spin' : ''}
                    />
                    <span>
                      {checkingStatus
                        ? t('Checking')
                        : authorizationPending
                          ? t('Waiting')
                          : connecting
                            ? t('Connecting')
                            : reconnecting
                              ? t('Reconnect')
                              : t('Connect')}
                    </span>
                  </button>
                )}
              </label>
            );
          })}
        </div>
        <div className="memory-connector-actions memory-connector-runbar">
          <span className="hint">
            {t('Selected')} {selectedConnectedConnectorIds.length} {t('of')} {connectedCount} {t('connected')}{' '}
            {connectedCount === 1 ? t('app') : t('apps')}.
          </span>
          <button
            type="button"
            className="primary memory-source-action"
            onClick={() => void onSuggestConnectorMemory()}
            disabled={!enabled || connectorExtracting || connectorSaving || selectedConnectedConnectorIds.length === 0}
          >
            <Icon name={connectorExtracting ? 'refresh' : 'sparkles'} size={14} className={connectorExtracting ? 'icon-spin' : ''} />
            <span>{t(connectorScanLabel)}</span>
          </button>
        </div>
      </div>
      {connectorSuggestions.length > 0 ? (
        <div className="memory-suggestion-panel">
          <div className="memory-subsection-head">
            <div>
              <h4>{t('Suggested memories')}</h4>
              <p className="hint">{t('Review design-related memories before saving them.')}</p>
            </div>
            <span className="memory-source-badge">
              {selectedConnectorSuggestions.length} {t('selected')}
            </span>
          </div>
          <div className="memory-suggestion-list">
            {connectorSuggestions.map((suggestion) => {
              const selected = selectedSuggestionIds.has(suggestion.id);
              const sourceLabel = suggestion.source?.connectorName || suggestion.source?.toolTitle || t('Connected apps');
              return (
                <label key={suggestion.id} className={`memory-suggestion-card${selected ? ' is-selected' : ''}`}>
                  <span className="memory-connector-check">
                    <input type="checkbox" checked={selected} onChange={() => toggleConnectorSuggestion(suggestion.id)} />
                    <span aria-hidden="true">{selected ? <Icon name="check" size={13} /> : null}</span>
                  </span>
                  <span className="memory-suggestion-copy">
                    <span className="memory-suggestion-title">
                      <strong>{suggestion.name}</strong>
                      <span className="memory-type-badge">{typeLabel[suggestion.type]}</span>
                    </span>
                    {suggestion.description ? <small>{suggestion.description}</small> : null}
                    <span className="memory-suggestion-body">{suggestion.body}</span>
                  </span>
                  <span className="memory-connector-state is-connected">{sourceLabel}</span>
                </label>
              );
            })}
          </div>
          <div className="memory-connector-actions">
            <button
              type="button"
              className="primary memory-source-action"
              onClick={() => void onSaveConnectorSuggestions()}
              disabled={connectorSaving || selectedConnectorSuggestions.length === 0}
            >
              <Icon name={connectorSaving ? 'refresh' : 'check'} size={14} className={connectorSaving ? 'icon-spin' : ''} />
              <span>{connectorSaving ? t('Saving') : t('Save selected')}</span>
            </button>
            <button type="button" className="ghost memory-source-action" onClick={onDiscardConnectorSuggestions} disabled={connectorSaving}>
              {t('Discard')}
            </button>
          </div>
        </div>
      ) : null}
      {connectorStatus ? (
        <div role="status" className="memory-connector-result is-success">
          {connectorStatus}
        </div>
      ) : null}
      {connectorError ? (
        <div role="alert" className="memory-connector-result is-error">
          {connectorError}
        </div>
      ) : null}
      {connectorAttempts.length > 0 ? (
        <div className="memory-connector-diagnostics" aria-label={t('Connected app read status')}>
          <div className="memory-connector-diagnostics-head">
            <strong>{t('Last scan')}</strong>
            <span>
              {formatConnectorContextBytes(connectorContextBytes)} {t('read')}
            </span>
          </div>
          <div className="memory-connector-diagnostics-list">
            {connectorAttempts.map((attempt) => (
              <div
                key={`${attempt.connectorId}-${attempt.status}-${attempt.toolName ?? 'none'}`}
                className={`memory-connector-diagnostic-row is-${attempt.status}`}
              >
                <span className="memory-connector-diagnostic-dot" aria-hidden="true" />
                <span className="memory-connector-diagnostic-copy">
                  <strong>{connectorAttemptTitle(attempt)}</strong>
                  <small>{connectorAttemptDetail(attempt)}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {connectorExtractions.length > 0 ? (
        <details className="memory-scan-history">
          <summary>
            <span>{t('Recent scans')}</span>
            <span>{connectorExtractions.length}</span>
          </summary>
          <div className="memory-connector-run-history" aria-label={t('Connected app memory run status')}>
            {connectorExtractions.slice(0, 4).map((record) => (
              <MemoryExtractionCard key={record.id} record={record} nowClock={nowClock} onOpenPreview={onOpenPreview} onDelete={onDeleteExtraction} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
