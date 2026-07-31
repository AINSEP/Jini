import { useEffect, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import { useT } from '../../i18n/index.js';
import type { Connector, ConnectorAction, ConnectorAuthorizationPending } from '@jini-ai/ui-core';
import { getConnectorDisplayToolCount, getDisplayableConnectorAccountLabel, statusLabel, toolsBadgeTranslation } from '@jini-ai/ui-core';
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
}: ConnectorDetailDrawerProps) {
  const t = useT();
  const resolvedCancelFailedMessage = cancelFailedMessage ?? t("Couldn't cancel authorization. Try again.");
  const resolvedContinueInBrowserLabel = continueInBrowserLabel ?? t('Continue in browser');
  const isConnected = connector.status === 'connected';
  const isConnecting = pendingAction === 'connect';
  const isDisconnecting = pendingAction === 'disconnect';
  const isAuthorizationPending = !isConnected && authorizationPending !== undefined;
  const isPending = pendingAction !== null || isAuthorizationPending;
  const canConnect = !disabled && !isPending && connector.status === 'available';
  const canDisconnect = !disabled && !isPending && isConnected;
  const accountLabel = getDisplayableAccountLabel(connector);
  const actualToolCount = connector.tools.length;
  const toolCount = getConnectorDisplayToolCount(connector);
  const isLoadingTools = toolsPreviewLoading || !toolsLoaded;
  const toolDetailsUnavailable = toolsLoaded && actualToolCount === 0 && toolCount > 0;
  const showToolsBadge = connector.toolCount !== undefined || actualToolCount > 0 || toolsLoaded;
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const categoryLabel = getCategoryLabel(connector.category);
  const toolsBadge = toolsBadgeTranslation(toolCount);
  const toolsBadgeLabel = t(toolsBadge.key, toolsBadge.vars);

  function continueAuthorization(event: SyntheticEvent) {
    event.stopPropagation();
    // `continueAuthorization`'s only call site (the "continue in browser"
    // button below) only ever renders while `authorizationPending &&
    // authorizationPending.redirectUrl` already holds in that same render,
    // and React re-binds this closure fresh on every render — so a
    // re-check here was dead code for every real click, removed rather
    // than tested around (same pattern as this package's `ConnectorCard.tsx`
    // precedent; see packages/ui/source-map.md's 2026-07-22 dated entry).
    onOpenExternalUrl?.(authorizationPending!.redirectUrl!);
  }

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

  const statusTone = isAuthorizationPending ? 'pending' : connector.status;

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
      >
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
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="connector-drawer-body">
          {connector.description ? (
            <section className="connector-drawer-section">
              <h3 className="connector-drawer-section-title">{t('About')}</h3>
              <p className="connector-drawer-description">{connector.description}</p>
              {isAuthorizationPending ? (
                <div className="connector-authorization-block" role="status">
                  <p className="connector-authorization-hint">{t('Authorization in progress. It should finish shortly.')}</p>
                  {authorizationPending.redirectUrl ? (
                    <button type="button" className="connector-authorization-link" onClick={continueAuthorization}>
                      {resolvedContinueInBrowserLabel}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
          {authorizationError ? (
            <p className="connector-authorization-hint connector-authorization-error" role="alert">
              {authorizationError}
            </p>
          ) : null}
          {authorizationCancelFailed ? (
            <p className="connector-authorization-hint connector-authorization-error" role="alert">
              {resolvedCancelFailedMessage}
            </p>
          ) : null}

          <section className="connector-drawer-section">
            <div className="connector-drawer-section-head">
              <h3 className="connector-drawer-section-title">{t('Details')}</h3>
              {isConnected ? (
                <button
                  type="button"
                  className={`ghost connector-drawer-inline-action connector-action is-disconnect${isDisconnecting ? ' is-loading' : ''}`}
                  disabled={!canDisconnect}
                  aria-busy={isDisconnecting || undefined}
                  onClick={() => onDisconnect(connector.id)}
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

          <section className="connector-drawer-section">
            <h3 className="connector-drawer-section-title">
              {t('Tools')} <span className="connector-drawer-count">{toolCount}</span>
            </h3>
            {isLoadingTools ? (
              <p className="connector-drawer-empty">
                <Icon name="spinner" size={12} /> {t('Loading tools…')}
              </p>
            ) : toolDetailsUnavailable ? (
              <p className="connector-drawer-empty">{t('Tool details unavailable ({count})', { count: toolCount })}</p>
            ) : actualToolCount === 0 ? (
              <p className="connector-drawer-empty">{t('No tools available')}</p>
            ) : (
              <>
                <ul className="connector-drawer-tools">
                  {connector.tools.map((tool) => (
                    <li key={tool.name} className="connector-drawer-tool">
                      <div className="connector-drawer-tool-head">
                        <span className="connector-drawer-tool-title">{tool.title || tool.name}</span>
                        <span className={`connector-drawer-tool-badge side-${tool.safety.sideEffect}`} title={tool.safety.reason}>
                          {tool.safety.sideEffect}
                        </span>
                      </div>
                      {tool.description ? <p className="connector-drawer-tool-desc">{tool.description}</p> : null}
                      <code className="connector-drawer-tool-name">{tool.name}</code>
                    </li>
                  ))}
                </ul>
                {connector.toolsNextCursor ? (
                  <button
                    type="button"
                    className="ghost connector-drawer-load-more"
                    disabled={toolsPreviewLoading}
                    onClick={() => onLoadMoreTools(connector.id, connector.toolsNextCursor!)}
                  >
                    {/* This button only ever renders while `!isLoadingTools`
                        (`isLoadingTools = toolsPreviewLoading || !toolsLoaded`),
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
            )}
          </section>
        </div>

        {!isConnected ? (
          <footer className="connector-drawer-foot">
            <button
              type="button"
              className={`primary connector-action is-connect${isConnecting || isAuthorizationPending ? ' is-loading' : ''}`}
              disabled={!canConnect}
              aria-busy={isConnecting || isAuthorizationPending || undefined}
              onClick={() => onConnect(connector.id)}
            >
              {isConnecting || isAuthorizationPending ? <Icon name="spinner" size={12} /> : null}
              <span>{isAuthorizationPending ? t('Authorization pending') : t('Connect')}</span>
            </button>
            {isAuthorizationPending ? (
              <button type="button" className="ghost connector-action is-cancel-authorization" onClick={() => onCancelAuthorization(connector.id)}>
                <span>{t('Cancel authorization')}</span>
              </button>
            ) : null}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
