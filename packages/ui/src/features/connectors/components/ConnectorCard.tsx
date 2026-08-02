import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react';
import { useT } from '../../i18n/index.js';
import { getConnectorDisplayToolCount, statusLabel, toolsBadgeTranslation } from '../rules.js';
import type { Connector, ConnectorAction, ConnectorAuthorizationPending } from '../types.js';
import { Icon } from '../../../react/components/Icon.js';
import { ConnectorLogo } from './ConnectorLogo.js';

export interface ConnectorCardProps {
  connector: Connector;
  disabled?: boolean;
  pendingAction: ConnectorAction | null;
  authorizationPending?: ConnectorAuthorizationPending | undefined;
  authorizationCancelFailed: boolean;
  toolsLoaded: boolean;
  onConnect: (connectorId: string) => void;
  onDisconnect: (connectorId: string) => void;
  onCancelAuthorization: (connectorId: string) => void;
  onOpenDetails: (connectorId: string) => void;
  getCategoryLabel?: (category: string) => string;
  cancelFailedMessage?: string;
  continueInBrowserLabel?: string;
  onOpenExternalUrl?: (url: string) => void;
}

export function ConnectorCard({
  connector,
  disabled = false,
  pendingAction,
  authorizationPending,
  authorizationCancelFailed,
  toolsLoaded,
  onConnect,
  onDisconnect,
  onCancelAuthorization,
  onOpenDetails,
  getCategoryLabel = (category) => category,
  cancelFailedMessage,
  continueInBrowserLabel,
  onOpenExternalUrl,
}: ConnectorCardProps) {
  const t = useT();
  const resolvedCancelFailedMessage = cancelFailedMessage ?? t("Couldn't cancel authorization. Try again.");
  const resolvedContinueInBrowserLabel = continueInBrowserLabel ?? t('Continue in browser');
  const isConnecting = pendingAction === 'connect';
  const isDisconnecting = pendingAction === 'disconnect';
  const isConnected = connector.status === 'connected';
  const isAuthorizationPending = !isConnected && authorizationPending !== undefined;
  const isPending = pendingAction !== null || isAuthorizationPending;
  const canConnect = !disabled && !isPending && connector.status === 'available';
  const canDisconnect = !disabled && !isPending && isConnected;
  const toolCount = getConnectorDisplayToolCount(connector);
  const showToolsBadge = connector.toolCount !== undefined || connector.tools.length > 0 || toolsLoaded;
  const toolsBadge = toolsBadgeTranslation(toolCount);
  const toolsBadgeLabel = t(toolsBadge.key, toolsBadge.vars);
  const categoryLabel = getCategoryLabel(connector.category);

  function openDetails() {
    if (disabled) return;
    onOpenDetails(connector.id);
  }

  function onKeyActivate(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    openDetails();
  }

  function stop(event: SyntheticEvent) {
    event.stopPropagation();
  }

  function continueAuthorization(event: SyntheticEvent) {
    stop(event);
    // `continueAuthorization`'s only call site (the "continue in browser"
    // button below) only ever renders while
    // `isAuthorizationPending && authorizationPending.redirectUrl` already
    // holds in that same render, and React re-binds this closure fresh on
    // every render — so a re-check here was dead code for every real
    // click, removed rather than tested around (see
    // packages/ui/source-map.md's 2026-07-22 dated entry).
    onOpenExternalUrl?.(authorizationPending!.redirectUrl!);
  }

  return (
    <article
      className={`connector-card status-${connector.status}${disabled ? ' is-locked' : ''}`}
      data-connector-id={connector.id}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={t('Open details for {name}', { name: connector.name })}
      onClick={openDetails}
      onKeyDown={onKeyActivate}
    >
      <div className="connector-card-top">
        <ConnectorLogo connectorId={connector.id} connectorName={connector.name} logoUrl={connector.logoUrl} size="sm" />
        <div className="connector-card-head">
          <h3 className="connector-card-title">
            <span className="connector-card-title-name">{connector.name}</span>
            {isConnected ? (
              <span
                className={`connector-status-dot connector-card-title-dot status-${connector.status}`}
                aria-label={t(statusLabel(connector.status))}
                title={t(statusLabel(connector.status))}
                role="img"
              />
            ) : isAuthorizationPending ? (
              <span
                className="connector-status-dot connector-card-title-dot status-pending"
                aria-label={t('Authorization pending')}
                title={t('Authorization pending')}
                role="img"
              />
            ) : null}
          </h3>
          <div className="connector-meta">
            <span className="connector-meta-item connector-meta-category" title={categoryLabel}>
              {categoryLabel}
            </span>
            <span className="connector-meta-tools" aria-hidden={!showToolsBadge}>
              {showToolsBadge ? (
                <span className="connector-tools-badge is-ready" title={toolsBadgeLabel}>
                  <span>{toolsBadgeLabel}</span>
                </span>
              ) : null}
            </span>
          </div>
        </div>
        <div className="connector-card-actions">
          {isConnected ? (
            <button
              type="button"
              className={`icon-only connector-action is-disconnect${isDisconnecting ? ' is-loading' : ''}`}
              disabled={!canDisconnect}
              aria-busy={isDisconnecting || undefined}
              aria-label={t('Disconnect')}
              title={t('Disconnect')}
              tabIndex={disabled ? -1 : undefined}
              onMouseDown={stop}
              onKeyDown={stop}
              onClick={(e) => {
                stop(e);
                onDisconnect(connector.id);
              }}
            >
              <Icon name={isDisconnecting ? 'spinner' : 'close'} size={12} />
            </button>
          ) : (
            <button
              type="button"
              className={`icon-only connector-action is-connect${isConnecting || isAuthorizationPending ? ' is-loading' : ''}`}
              disabled={!canConnect}
              aria-busy={isConnecting || isAuthorizationPending || undefined}
              aria-label={isAuthorizationPending ? t('Authorization pending') : t('Connect')}
              title={isAuthorizationPending ? t('Authorization in progress') : t('Connect')}
              tabIndex={disabled ? -1 : undefined}
              onMouseDown={stop}
              onKeyDown={stop}
              onClick={(e) => {
                stop(e);
                onConnect(connector.id);
              }}
            >
              <Icon name={isConnecting || isAuthorizationPending ? 'spinner' : 'plus'} size={12} />
            </button>
          )}
          {isAuthorizationPending ? (
            <button
              type="button"
              className="icon-only connector-action is-cancel-authorization"
              aria-label={t('Cancel authorization')}
              title={t('Cancel authorization')}
              onMouseDown={stop}
              onKeyDown={stop}
              onClick={(e) => {
                stop(e);
                onCancelAuthorization(connector.id);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
          {connector.status === 'error' || connector.status === 'disabled' ? (
            <span className={`connector-status-pill status-${connector.status}`}>{t(statusLabel(connector.status))}</span>
          ) : null}
        </div>
      </div>
      {authorizationCancelFailed ? (
        <p className="connector-authorization-hint connector-authorization-error" role="alert">
          {resolvedCancelFailedMessage}
        </p>
      ) : null}
      {isAuthorizationPending && authorizationPending.redirectUrl ? (
        <button type="button" className="connector-authorization-link" title={t('Authorization in progress')} onClick={continueAuthorization}>
          {resolvedContinueInBrowserLabel}
        </button>
      ) : null}
    </article>
  );
}
