import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import { useT } from '../../i18n/index.js';
import { connectorActionFlags, getConnectorDisplayToolCount, statusLabel, toolsBadgeTranslation } from '../rules.js';
import type { Connector, ConnectorAction, ConnectorActionFlags, ConnectorAuthorizationPending } from '../types.js';
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
  /** This card's own agent handle — see `ConnectorsBrowser`'s `agentHandle` doc; `ConnectorGrid`
   *  derives one distinct handle per connector and passes it here. */
  agentHandle?: string;
}

type ConnectorStatusValue = Connector['status'];

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

/** Click handler for a card action: stops the click from also opening the card's details, then acts. */
function stopThen(onActivate: () => void) {
  return (event: SyntheticEvent) => {
    stopPropagation(event);
    onActivate();
  };
}

function ConnectorCardTitleDot({ status, isAuthorizationPending }: { status: ConnectorStatusValue; isAuthorizationPending: boolean }) {
  const t = useT();
  if (status === 'connected') {
    return (
      <span
        className={`connector-status-dot connector-card-title-dot status-${status}`}
        aria-label={t(statusLabel(status))}
        title={t(statusLabel(status))}
        role="img"
      />
    );
  }
  if (!isAuthorizationPending) return null;
  return (
    <span
      className="connector-status-dot connector-card-title-dot status-pending"
      aria-label={t('Authorization pending')}
      title={t('Authorization pending')}
      role="img"
    />
  );
}

function ConnectorCardToolsBadge({ connector, toolsLoaded }: { connector: Connector; toolsLoaded: boolean }) {
  const t = useT();
  const showToolsBadge = connector.toolCount !== undefined || connector.tools.length > 0 || toolsLoaded;
  const toolsBadge = toolsBadgeTranslation(getConnectorDisplayToolCount(connector));
  const toolsBadgeLabel = t(toolsBadge.key, toolsBadge.vars);
  return (
    <span className="connector-meta-tools" aria-hidden={!showToolsBadge}>
      {showToolsBadge ? (
        <span className="connector-tools-badge is-ready" title={toolsBadgeLabel}>
          <span>{toolsBadgeLabel}</span>
        </span>
      ) : null}
    </span>
  );
}

interface ConnectorCardActionButtonProps {
  flags: ConnectorActionFlags;
  disabled: boolean;
  agentHandle: string | undefined;
  onActivate: () => void;
}

function ConnectorDisconnectButton({ flags, disabled, agentHandle, onActivate }: ConnectorCardActionButtonProps) {
  const t = useT();
  const { isDisconnecting } = flags;
  return (
    <button
      type="button"
      className={`icon-only connector-action is-disconnect${isDisconnecting ? ' is-loading' : ''}`}
      disabled={!flags.canDisconnect}
      aria-busy={isDisconnecting || undefined}
      aria-label={t('Disconnect')}
      title={t('Disconnect')}
      tabIndex={disabled ? -1 : undefined}
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
      onClick={stopThen(onActivate)}
      {...agentHandleProps({}, { base: agentHandle, action: 'disconnect', role: 'button', label: t('Disconnect') })}
    >
      <Icon name={isDisconnecting ? 'spinner' : 'close'} size={12} />
    </button>
  );
}

function ConnectorConnectButton({ flags, disabled, agentHandle, onActivate }: ConnectorCardActionButtonProps) {
  const t = useT();
  const { isAuthorizationPending } = flags;
  const isBusy = flags.isConnecting || isAuthorizationPending;
  return (
    <button
      type="button"
      className={`icon-only connector-action is-connect${isBusy ? ' is-loading' : ''}`}
      disabled={!flags.canConnect}
      aria-busy={isBusy || undefined}
      aria-label={isAuthorizationPending ? t('Authorization pending') : t('Connect')}
      title={isAuthorizationPending ? t('Authorization in progress') : t('Connect')}
      tabIndex={disabled ? -1 : undefined}
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
      onClick={stopThen(onActivate)}
      {...agentHandleProps({}, { base: agentHandle, action: 'connect', role: 'button', label: t('Connect') })}
    >
      <Icon name={isBusy ? 'spinner' : 'plus'} size={12} />
    </button>
  );
}

function ConnectorCancelAuthorizationButton({ onActivate }: { onActivate: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="icon-only connector-action is-cancel-authorization"
      aria-label={t('Cancel authorization')}
      title={t('Cancel authorization')}
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
      onClick={stopThen(onActivate)}
    >
      <Icon name="close" size={12} />
    </button>
  );
}

function ConnectorStatusPill({ status }: { status: ConnectorStatusValue }) {
  const t = useT();
  if (status !== 'error' && status !== 'disabled') return null;
  return <span className={`connector-status-pill status-${status}`}>{t(statusLabel(status))}</span>;
}

interface ConnectorCardHintsProps {
  authorizationCancelFailed: boolean;
  redirectUrl: string | undefined;
  cancelFailedMessage: string | undefined;
  continueInBrowserLabel: string | undefined;
  onOpenExternalUrl: ((url: string) => void) | undefined;
}

/** The cancel-failed alert and the continue-in-browser link under the card body. */
function ConnectorCardHints({
  authorizationCancelFailed,
  redirectUrl,
  cancelFailedMessage,
  continueInBrowserLabel,
  onOpenExternalUrl,
}: ConnectorCardHintsProps) {
  const t = useT();

  function continueAuthorization(event: SyntheticEvent) {
    stopPropagation(event);
    // `continueAuthorization`'s only call site (the "continue in browser"
    // button below) only ever renders while
    // `isAuthorizationPending && authorizationPending.redirectUrl` already
    // holds in that same render, and React re-binds this closure fresh on
    // every render — so a re-check here was dead code for every real
    // click, removed rather than tested around (see
    // packages/ui/source-map.md's 2026-07-22 dated entry).
    onOpenExternalUrl?.(redirectUrl!);
  }

  return (
    <>
      {authorizationCancelFailed ? (
        <p className="connector-authorization-hint connector-authorization-error" role="alert">
          {cancelFailedMessage ?? t("Couldn't cancel authorization. Try again.")}
        </p>
      ) : null}
      {redirectUrl ? (
        <button type="button" className="connector-authorization-link" title={t('Authorization in progress')} onClick={continueAuthorization}>
          {continueInBrowserLabel ?? t('Continue in browser')}
        </button>
      ) : null}
    </>
  );
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
  agentHandle,
}: ConnectorCardProps) {
  const t = useT();
  const flags = connectorActionFlags({ connector, pendingAction, authorizationPending, disabled });
  const categoryLabel = getCategoryLabel(connector.category);
  const actionProps = { flags, disabled, agentHandle };

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
      {...agentHandleProps({}, { base: agentHandle, role: 'button', label: connector.name })}
    >
      <div className="connector-card-top">
        <ConnectorLogo connectorId={connector.id} connectorName={connector.name} logoUrl={connector.logoUrl} size="sm" />
        <div className="connector-card-head">
          <h3 className="connector-card-title">
            <span className="connector-card-title-name">{connector.name}</span>
            <ConnectorCardTitleDot status={connector.status} isAuthorizationPending={flags.isAuthorizationPending} />
          </h3>
          <div className="connector-meta">
            <span className="connector-meta-item connector-meta-category" title={categoryLabel}>
              {categoryLabel}
            </span>
            <ConnectorCardToolsBadge connector={connector} toolsLoaded={toolsLoaded} />
          </div>
        </div>
        <div className="connector-card-actions">
          {flags.isConnected ? (
            <ConnectorDisconnectButton {...actionProps} onActivate={() => onDisconnect(connector.id)} />
          ) : (
            <ConnectorConnectButton {...actionProps} onActivate={() => onConnect(connector.id)} />
          )}
          {flags.isAuthorizationPending ? (
            <ConnectorCancelAuthorizationButton onActivate={() => onCancelAuthorization(connector.id)} />
          ) : null}
          <ConnectorStatusPill status={connector.status} />
        </div>
      </div>
      <ConnectorCardHints
        authorizationCancelFailed={authorizationCancelFailed}
        redirectUrl={flags.redirectUrl}
        cancelFailedMessage={cancelFailedMessage}
        continueInBrowserLabel={continueInBrowserLabel}
        onOpenExternalUrl={onOpenExternalUrl}
      />
    </article>
  );
}
