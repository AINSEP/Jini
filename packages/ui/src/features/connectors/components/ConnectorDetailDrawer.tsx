import { useEffect, useRef } from 'react';
import type { RefObject, SyntheticEvent } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import { useT } from '../../i18n/index.js';
import {
  connectorActionFlags,
  getConnectorDisplayToolCount,
  getDisplayableConnectorAccountLabel,
  statusLabel,
  toolsBadgeTranslation,
} from '../rules.js';
import type { Connector, ConnectorAction, ConnectorActionFlags, ConnectorAuthorizationPending } from '../types.js';
import { Icon } from '../../../react/components/Icon.js';
import { ConnectorLogo } from './ConnectorLogo.js';

export interface ConnectorDetailDrawerProps {
  connector: Connector;
  disabled: boolean;
  pendingAction: ConnectorAction | null;
  authorizationPending?: ConnectorAuthorizationPending | undefined;
  authorizationCancelFailed: boolean;
  authorizationError: string | null;
  toolsPreviewLoading: boolean;
  toolsLoaded: boolean;
  onClose: () => void;
  onConnect: (connectorId: string) => void;
  onDisconnect: (connectorId: string) => void;
  onCancelAuthorization: (connectorId: string) => void;
  onLoadMoreTools: (connectorId: string, cursor: string) => void;
  onOpenExternalUrl?: (url: string) => void;
  getCategoryLabel?: (category: string) => string;
  getDisplayableAccountLabel?: (connector: Connector) => string | undefined;
  cancelFailedMessage?: string;
  continueInBrowserLabel?: string;
  /** This drawer's own agent handle — see `ConnectorsBrowser`'s `agentHandle` doc. */
  agentHandle?: string;
}

interface ConnectorDrawerHeadProps {
  connector: Connector;
  categoryLabel: string;
  isAuthorizationPending: boolean;
  toolsLoaded: boolean;
  closeBtnRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  agentHandle: string | undefined;
}

function ConnectorDrawerHead({
  connector,
  categoryLabel,
  isAuthorizationPending,
  toolsLoaded,
  closeBtnRef,
  onClose,
  agentHandle,
}: ConnectorDrawerHeadProps) {
  const t = useT();
  const showToolsBadge = connector.toolCount !== undefined || connector.tools.length > 0 || toolsLoaded;
  const toolsBadge = toolsBadgeTranslation(getConnectorDisplayToolCount(connector));
  const toolsBadgeLabel = t(toolsBadge.key, toolsBadge.vars);
  const statusTone = isAuthorizationPending ? 'pending' : connector.status;
  return (
    <header className="connector-drawer-head">
      <ConnectorLogo connectorId={connector.id} connectorName={connector.name} logoUrl={connector.logoUrl} size="lg" />
      <div className="connector-drawer-titles">
        <div className="connector-drawer-eyebrow">
          <span>{categoryLabel}</span>
          <span className="connector-meta-dot" aria-hidden>
            ·
          </span>
          <span>{connector.provider}</span>
        </div>
        <h2 id="connector-drawer-title">{connector.name}</h2>
        <div className="connector-drawer-status">
          <span className={`connector-status-pill status-${statusTone}`}>
            <span className="connector-status-dot" aria-hidden />
            {isAuthorizationPending ? t('Authorization pending') : t(statusLabel(connector.status))}
          </span>
          {showToolsBadge ? (
            <span className="connector-drawer-tool-count-chip" title={toolsBadgeLabel}>
              <span>{toolsBadgeLabel}</span>
            </span>
          ) : null}
        </div>
      </div>
      <button
        ref={closeBtnRef}
        type="button"
        className="ghost connector-drawer-close"
        onClick={onClose}
        aria-label={t('Close')}
        data-testid="connector-drawer-close"
        {...agentHandleProps({}, { base: agentHandle, action: 'close', role: 'button', label: t('Close') })}
      >
        <Icon name="close" size={14} />
      </button>
    </header>
  );
}

interface ConnectorDrawerAboutProps {
  description: string;
  isAuthorizationPending: boolean;
  redirectUrl: string | undefined;
  continueInBrowserLabel: string | undefined;
  onOpenExternalUrl: ((url: string) => void) | undefined;
}

function ConnectorDrawerAbout({
  description,
  isAuthorizationPending,
  redirectUrl,
  continueInBrowserLabel,
  onOpenExternalUrl,
}: ConnectorDrawerAboutProps) {
  const t = useT();

  function continueAuthorization(event: SyntheticEvent) {
    event.stopPropagation();
    // `continueAuthorization`'s only call site (the "continue in browser"
    // button below) only ever renders while `authorizationPending &&
    // authorizationPending.redirectUrl` already holds in that same render,
    // and React re-binds this closure fresh on every render — so a
    // re-check here was dead code for every real click, removed rather
    // than tested around (same pattern as this package's `ConnectorCard.tsx`
    // precedent; see packages/ui/source-map.md's 2026-07-22 dated entry).
    onOpenExternalUrl?.(redirectUrl!);
  }

  return (
    <section className="connector-drawer-section">
      <h3 className="connector-drawer-section-title">{t('About')}</h3>
      <p className="connector-drawer-description">{description}</p>
      {isAuthorizationPending ? (
        <div className="connector-authorization-block" role="status">
          <p className="connector-authorization-hint">{t('Authorization in progress. It should finish shortly.')}</p>
          {redirectUrl ? (
            <button type="button" className="connector-authorization-link" onClick={continueAuthorization}>
              {continueInBrowserLabel ?? t('Continue in browser')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ConnectorDrawerAlert({ message }: { message: string }) {
  return (
    <p className="connector-authorization-hint connector-authorization-error" role="alert">
      {message}
    </p>
  );
}

interface ConnectorDrawerDetailsProps {
  connector: Connector;
  categoryLabel: string;
  accountLabel: string | undefined;
  flags: ConnectorActionFlags;
  onDisconnect: (connectorId: string) => void;
  agentHandle: string | undefined;
}

function ConnectorDrawerDetails({ connector, categoryLabel, accountLabel, flags, onDisconnect, agentHandle }: ConnectorDrawerDetailsProps) {
  const t = useT();
  const { isDisconnecting } = flags;
  return (
    <section className="connector-drawer-section">
      <div className="connector-drawer-section-head">
        <h3 className="connector-drawer-section-title">{t('Details')}</h3>
        {flags.isConnected ? (
          <button
            type="button"
            className={`ghost connector-drawer-inline-action connector-action is-disconnect${isDisconnecting ? ' is-loading' : ''}`}
            disabled={!flags.canDisconnect}
            aria-busy={isDisconnecting || undefined}
            onClick={() => onDisconnect(connector.id)}
            {...agentHandleProps({}, { base: agentHandle, action: 'disconnect', role: 'button', label: t('Disconnect') })}
          >
            {isDisconnecting ? <Icon name="spinner" size={12} /> : null}
            <span>{t('Disconnect')}</span>
          </button>
        ) : null}
      </div>
      <dl className="connector-drawer-details">
        <div>
          <dt>{t('Status')}</dt>
          <dd>{t(statusLabel(connector.status))}</dd>
        </div>
        <div>
          <dt>{t('Category')}</dt>
          <dd>{categoryLabel}</dd>
        </div>
        <div>
          <dt>{t('Provider')}</dt>
          <dd>{connector.provider}</dd>
        </div>
        {accountLabel ? (
          <div>
            <dt>{t('Account')}</dt>
            <dd>{accountLabel}</dd>
          </div>
        ) : null}
        {connector.lastError ? (
          <div className="connector-drawer-details-error">
            <dt>{t('Error')}</dt>
            <dd>{connector.lastError}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function ConnectorDrawerTool({ tool }: { tool: Connector['tools'][number] }) {
  return (
    <li className="connector-drawer-tool">
      <div className="connector-drawer-tool-head">
        <span className="connector-drawer-tool-title">{tool.title || tool.name}</span>
        <span className={`connector-drawer-tool-badge side-${tool.safety.sideEffect}`} title={tool.safety.reason}>
          {tool.safety.sideEffect}
        </span>
      </div>
      {tool.description ? <p className="connector-drawer-tool-desc">{tool.description}</p> : null}
      <code className="connector-drawer-tool-name">{tool.name}</code>
    </li>
  );
}

interface ConnectorDrawerToolsProps {
  connector: Connector;
  toolsPreviewLoading: boolean;
  toolsLoaded: boolean;
  onLoadMoreTools: (connectorId: string, cursor: string) => void;
}

/** The tools section body: loading, unavailable, empty, or the list with an optional load-more. */
function ConnectorDrawerToolsBody({ connector, toolsPreviewLoading, toolsLoaded, onLoadMoreTools }: ConnectorDrawerToolsProps) {
  const t = useT();
  const actualToolCount = connector.tools.length;
  const toolCount = getConnectorDisplayToolCount(connector);
  if (toolsPreviewLoading || !toolsLoaded) {
    return (
      <p className="connector-drawer-empty">
        <Icon name="spinner" size={12} /> {t('Loading tools…')}
      </p>
    );
  }
  if (actualToolCount === 0 && toolCount > 0) {
    return <p className="connector-drawer-empty">{t('Tool details unavailable ({count})', { count: toolCount })}</p>;
  }
  if (actualToolCount === 0) return <p className="connector-drawer-empty">{t('No tools available')}</p>;
  return (
    <>
      <ul className="connector-drawer-tools">
        {connector.tools.map((tool) => (
          <ConnectorDrawerTool key={tool.name} tool={tool} />
        ))}
      </ul>
      {connector.toolsNextCursor ? (
        <button
          type="button"
          className="ghost connector-drawer-load-more"
          disabled={toolsPreviewLoading}
          onClick={() => onLoadMoreTools(connector.id, connector.toolsNextCursor!)}
        >
          {/* This button only ever renders past the
              `toolsPreviewLoading || !toolsLoaded` early return above,
              which requires `toolsPreviewLoading` to already be
              `false` in this same render — a load-more-in-flight
              spinner here was structurally dead code (the whole
              section instead swaps to the "Loading tools…" message
              above the moment `toolsPreviewLoading` flips true), so
              it was removed rather than tested around. See
              packages/ui/source-map.md's 2026-07-22 dated entry. */}
          <span>{t('Load more tools')}</span>
        </button>
      ) : null}
    </>
  );
}

interface ConnectorDrawerFootProps {
  connectorId: string;
  flags: ConnectorActionFlags;
  onConnect: (connectorId: string) => void;
  onCancelAuthorization: (connectorId: string) => void;
  agentHandle: string | undefined;
}

function ConnectorDrawerFoot({ connectorId, flags, onConnect, onCancelAuthorization, agentHandle }: ConnectorDrawerFootProps) {
  const t = useT();
  const { isAuthorizationPending } = flags;
  const isBusy = flags.isConnecting || isAuthorizationPending;
  return (
    <footer className="connector-drawer-foot">
      <button
        type="button"
        className={`primary connector-action is-connect${isBusy ? ' is-loading' : ''}`}
        disabled={!flags.canConnect}
        aria-busy={isBusy || undefined}
        onClick={() => onConnect(connectorId)}
        {...agentHandleProps({}, { base: agentHandle, action: 'connect', role: 'button', label: t('Connect') })}
      >
        {isBusy ? <Icon name="spinner" size={12} /> : null}
        <span>{isAuthorizationPending ? t('Authorization pending') : t('Connect')}</span>
      </button>
      {isAuthorizationPending ? (
        <button
          type="button"
          className="ghost connector-action is-cancel-authorization"
          onClick={() => onCancelAuthorization(connectorId)}
          {...agentHandleProps({}, { base: agentHandle, action: 'cancel-authorization', role: 'button', label: t('Cancel authorization') })}
        >
          <span>{t('Cancel authorization')}</span>
        </button>
      ) : null}
    </footer>
  );
}

/** Escape-to-close, initial focus on the close button, and body-scroll lock for the drawer's lifetime. */
function useDrawerModalBehavior({
  onClose,
  closeBtnRef,
}: {
  onClose: () => void;
  closeBtnRef: RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    closeBtnRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
}

/**
 * Modal detail drawer with a paginated tool list. Keeps its own
 * escape-key-to-close and body-scroll-lock behavior inline (standard modal
 * a11y idioms, not business/transport logic) — see
 * `packages/ui/source-map.md`'s purity-check note for why these two
 * `document`/`window` touches were kept here rather than routed through
 * `dependencies.ts`.
 */
export function ConnectorDetailDrawer({
  connector,
  disabled,
  pendingAction,
  authorizationPending,
  authorizationCancelFailed,
  authorizationError,
  toolsPreviewLoading,
  toolsLoaded,
  onClose,
  onConnect,
  onDisconnect,
  onCancelAuthorization,
  onLoadMoreTools,
  onOpenExternalUrl,
  getCategoryLabel = (category) => category,
  getDisplayableAccountLabel = getDisplayableConnectorAccountLabel,
  cancelFailedMessage,
  continueInBrowserLabel,
  agentHandle,
}: ConnectorDetailDrawerProps) {
  const t = useT();
  const flags = connectorActionFlags({ connector, pendingAction, authorizationPending, disabled });
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const categoryLabel = getCategoryLabel(connector.category);
  useDrawerModalBehavior({ onClose, closeBtnRef });

  return (
    <div
      className="connector-drawer-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="connector-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-drawer-title"
        data-testid="connector-drawer"
        onClick={(e) => e.stopPropagation()}
        {...agentHandleProps({}, { base: agentHandle, role: 'region', label: connector.name })}
      >
        <ConnectorDrawerHead
          connector={connector}
          categoryLabel={categoryLabel}
          isAuthorizationPending={flags.isAuthorizationPending}
          toolsLoaded={toolsLoaded}
          closeBtnRef={closeBtnRef}
          onClose={onClose}
          agentHandle={agentHandle}
        />

        <div className="connector-drawer-body">
          {connector.description ? (
            <ConnectorDrawerAbout
              description={connector.description}
              isAuthorizationPending={flags.isAuthorizationPending}
              redirectUrl={flags.redirectUrl}
              continueInBrowserLabel={continueInBrowserLabel}
              onOpenExternalUrl={onOpenExternalUrl}
            />
          ) : null}
          {authorizationError ? <ConnectorDrawerAlert message={authorizationError} /> : null}
          {authorizationCancelFailed ? (
            <ConnectorDrawerAlert message={cancelFailedMessage ?? t("Couldn't cancel authorization. Try again.")} />
          ) : null}

          <ConnectorDrawerDetails
            connector={connector}
            categoryLabel={categoryLabel}
            accountLabel={getDisplayableAccountLabel(connector)}
            flags={flags}
            onDisconnect={onDisconnect}
            agentHandle={agentHandle}
          />

          <section className="connector-drawer-section">
            <h3 className="connector-drawer-section-title">
              {t('Tools')} <span className="connector-drawer-count">{getConnectorDisplayToolCount(connector)}</span>
            </h3>
            <ConnectorDrawerToolsBody
              connector={connector}
              toolsPreviewLoading={toolsPreviewLoading}
              toolsLoaded={toolsLoaded}
              onLoadMoreTools={onLoadMoreTools}
            />
          </section>
        </div>

        {!flags.isConnected ? (
          <ConnectorDrawerFoot
            connectorId={connector.id}
            flags={flags}
            onConnect={onConnect}
            onCancelAuthorization={onCancelAuthorization}
            agentHandle={agentHandle}
          />
        ) : null}
      </aside>
    </div>
  );
}
