import type { SyntheticEvent } from 'react';
import { agentHandleProps } from '@jini-ai/core/agent-handles';
import { useT } from '../../i18n/index.js';
import { connectorActionFlags, getConnectorDisplayToolCount, statusLabel, toolsBadgeTranslation } from '../rules.js';
import type { Connector, ConnectorAction, ConnectorActionFlags, ConnectorAuthorizationPending } from '../types.js';
import { Icon } from '../../../react/components/Icon.js';
import { ConnectorLogo } from './ConnectorLogo.js';
import { createContinueAuthorization, useConnectorCard } from './ConnectorCard.hooks.js';

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
  useTHook?: typeof useT;
  useConnectorCardHook?: typeof useConnectorCard;
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

function ConnectorCardTitleDot({ status, isAuthorizationPending, useTHook = useT }: { status: ConnectorStatusValue; isAuthorizationPending: boolean; useTHook?: typeof useT; }) {
  const t = useTHook();
  if (status === 'connected') {
    return (
      <span
        className={`connector-status-dot connector-card-title-dot status-${status}`}
        aria-label={t(statusLabel({ status }))}
        title={t(statusLabel({ status }))}
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

function ConnectorCardToolsBadge({ connector, toolsLoaded, useTHook = useT }: { connector: Connector; toolsLoaded: boolean; useTHook?: typeof useT; }) {
  const t = useTHook();
  const showToolsBadge = connector.toolCount !== undefined || connector.tools.length > 0 || toolsLoaded;
  const toolsBadge = toolsBadgeTranslation({ count: getConnectorDisplayToolCount(connector) });
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
  useTHook?: typeof useT;
}

function ConnectorDisconnectButton({ flags, disabled, agentHandle, onActivate, useTHook = useT }: ConnectorCardActionButtonProps) {
  const t = useTHook();
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

function ConnectorConnectButton({ flags, disabled, agentHandle, onActivate, useTHook = useT }: ConnectorCardActionButtonProps) {
  const t = useTHook();
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

function ConnectorCancelAuthorizationButton({ onActivate, useTHook = useT }: { onActivate: () => void; useTHook?: typeof useT; }) {
  const t = useTHook();
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

function ConnectorStatusPill({ status, useTHook = useT }: { status: ConnectorStatusValue; useTHook?: typeof useT; }) {
  const t = useTHook();
  if (status !== 'error' && status !== 'disabled') return null;
  return <span className={`connector-status-pill status-${status}`}>{t(statusLabel({ status }))}</span>;
}

interface ConnectorCardHintsProps {
  authorizationCancelFailed: boolean;
  redirectUrl: string | undefined;
  cancelFailedMessage: string | undefined;
  continueInBrowserLabel: string | undefined;
  onOpenExternalUrl: ((url: string) => void) | undefined;
  useTHook?: typeof useT;
}

/** The cancel-failed alert and the continue-in-browser link under the card body. */
function ConnectorCardHints({
  authorizationCancelFailed,
  redirectUrl,
  cancelFailedMessage,
  continueInBrowserLabel,
  onOpenExternalUrl,
  useTHook = useT,
}: ConnectorCardHintsProps) {
  const t = useTHook();

  const continueAuthorization = redirectUrl ? createContinueAuthorization({ redirectUrl, onOpenExternalUrl }) : undefined;

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
  useTHook = useT,
  useConnectorCardHook = useConnectorCard,
}: ConnectorCardProps) {
  const t = useTHook();
  const flags = connectorActionFlags({ connector, pendingAction, authorizationPending, disabled });
  const categoryLabel = getCategoryLabel(connector.category);
  const actionProps = { flags, disabled, agentHandle };

  const { openDetails, onKeyActivate } = useConnectorCardHook({ connector, disabled, onOpenDetails });

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
