import type { ReactNode } from 'react';
import { useT } from '../../../../i18n/index.js';
import { Icon } from '../../../../../react/components/Icon.js';
import type { SettingsDialogChromeLabels, SettingsDialogTabMeta } from '@jini-ai/ui-core';
import { findActiveTab } from '@jini-ai/ui-core';
import { useSettingsDialogShell } from '../hooks/useSettingsDialogShell.js';

/** One sidebar-nav entry + its rendered panel. Extends the pure
 *  `SettingsDialogTabMeta` shape with the render-specific fields
 *  (`icon`/`panel`) that only make sense in the React layer. */
export interface SettingsDialogTab<TId extends string = string> extends SettingsDialogTabMeta<TId> {
  icon?: ReactNode;
  panel: ReactNode;
}

export interface SettingsDialogShellProps<T extends SettingsDialogTab = SettingsDialogTab> {
  tabs: readonly T[];
  initialActiveTabId?: string;
  activeTabId?: string;
  onActiveTabIdChange?: (tabId: string) => void;
  /** Closes the dialog (backdrop click, close button, Escape). Omit to
   *  render the shell without a close affordance — e.g. embedded inline
   *  rather than as a modal overlay. */
  onClose?: () => void;
  /**
   * Whether to render as a floating modal (backdrop, `aria-modal`,
   * click-outside-to-close) or inline in the host's own layout.
   *
   * Defaults to `'modal'` when `onClose` is supplied and `'inline'` when it is
   * not, so the common cases need no prop. Set it explicitly for the ones that
   * don't follow that rule — a modal whose only dismissal is Escape (`'modal'`
   * with no `onClose`), or an embedded panel that still offers a close/hide
   * button (`'inline'` with an `onClose`).
   *
   * Inline is not cosmetic: a fixed-position backdrop over an embedded panel
   * covers the host's own navigation, and `aria-modal` on a non-modal region
   * hides the rest of the page from assistive tech.
   */
  presentation?: 'modal' | 'inline';
  /** Renders the tall centered hero (kicker/title/subtitle) instead of the
   *  normal per-tab header — e.g. a first-run "Welcome" variant. */
  welcome?: boolean;
  defaultSidebarCollapsed?: boolean;
  /** Shows the fullscreen toggle button and applies its expanded state as a
   *  modifier class. Defaults to `true`; a host with no use for fullscreen
   *  can turn it off. */
  fullscreenEnabled?: boolean;
  defaultFullscreen?: boolean;
  labels?: SettingsDialogChromeLabels;
  /** Extra chrome rendered in the top-right strip, alongside the fullscreen
   *  toggle and close button — e.g. a host's own autosave-status indicator.
   *  Fully host-owned; the shell renders it as-is. */
  chromeExtra?: ReactNode;
  dialogAriaLabelledBy?: string;
  className?: string;
}

/**
 * Generic tabbed-settings-dialog chrome: modal backdrop + sidebar nav +
 * active-panel switching + fullscreen/collapse/close affordances. Carries no
 * opinion about what any tab contains — a host supplies `tabs`, each with
 * its own `panel` (any `ReactNode`, including one of this package's own
 * `tabs/*` components or a fully product-specific one).
 *
 * Proof this is separable from any one tab's content: in the origin
 * `SettingsDialog.tsx`, 8 of its 17 real tabs were already separate files
 * the original component merely mounted — the shell itself never reached
 * into a tab's internals.
 */
export function SettingsDialogShell<T extends SettingsDialogTab>({
  tabs,
  initialActiveTabId,
  activeTabId: controlledActiveTabId,
  onActiveTabIdChange,
  onClose,
  presentation,
  welcome = false,
  defaultSidebarCollapsed = false,
  fullscreenEnabled = true,
  defaultFullscreen = false,
  labels,
  chromeExtra,
  dialogAriaLabelledBy = 'settings-dialog-title',
  className,
}: SettingsDialogShellProps<T>) {
  const isModal = (presentation ?? (onClose ? 'modal' : 'inline')) === 'modal';
  const t = useT();
  const shell = useSettingsDialogShell({
    tabs,
    initialActiveTabId,
    activeTabId: controlledActiveTabId,
    onActiveTabIdChange,
    onClose,
    defaultSidebarCollapsed,
    defaultFullscreen,
  });

  const activeTab = findActiveTab(tabs, shell.activeTabId);

  const kicker = labels?.kicker ?? t('Settings');
  const welcomeKicker = labels?.welcomeKicker ?? t('Welcome');
  const welcomeTitle = labels?.welcomeTitle ?? t('Get started');
  const welcomeSubtitle = labels?.welcomeSubtitle ?? t('Set up your preferences before you begin.');
  const closeLabel = labels?.closeLabel ?? t('Close');
  const fullscreenLabel = labels?.fullscreenLabel ?? t('Fullscreen');
  const exitFullscreenLabel = labels?.exitFullscreenLabel ?? t('Exit fullscreen');
  const collapseSidebarLabel = labels?.collapseSidebarLabel ?? t('Collapse settings sidebar');
  const expandSidebarLabel = labels?.expandSidebarLabel ?? t('Expand settings sidebar');
  const sidebarAriaLabel = labels?.sidebarAriaLabel ?? t('Settings sections');

  const sidebarToggleLabel = shell.sidebarCollapsed ? expandSidebarLabel : collapseSidebarLabel;
  const fullscreenToggleLabel = shell.fullscreen ? exitFullscreenLabel : fullscreenLabel;

  const dialogClassName = [
    'jini-settings-dialog',
    shell.sidebarCollapsed ? 'jini-settings-dialog-sidebar-collapsed' : '',
    shell.fullscreen ? 'jini-settings-dialog-fullscreen' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <div
      className={dialogClassName}
      role={isModal ? 'dialog' : 'region'}
      aria-modal={isModal ? true : undefined}
      aria-labelledby={dialogAriaLabelledBy}
      onClick={isModal ? (event) => event.stopPropagation() : undefined}
    >
        <div className="jini-settings-dialog-chrome">
          {chromeExtra}
          {fullscreenEnabled ? (
            <button
              type="button"
              className="jini-settings-dialog-chrome-btn jini-settings-dialog-fullscreen-toggle"
              onClick={shell.toggleFullscreen}
              aria-label={fullscreenToggleLabel}
              aria-pressed={shell.fullscreen}
              title={fullscreenToggleLabel}
            >
              <Icon name={shell.fullscreen ? 'minimize' : 'maximize'} size={15} strokeWidth={2} />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="jini-settings-dialog-chrome-btn jini-settings-dialog-close"
              onClick={onClose}
              aria-label={closeLabel}
              title={closeLabel}
            >
              <Icon name="close" size={16} strokeWidth={2} />
            </button>
          ) : null}
        </div>

        <header className="jini-settings-dialog-head" id={dialogAriaLabelledBy}>
          {welcome ? (
            <>
              <span className="jini-settings-dialog-kicker">{welcomeKicker}</span>
              <h2>{welcomeTitle}</h2>
              <p className="jini-settings-dialog-subtitle">{welcomeSubtitle}</p>
            </>
          ) : (
            <>
              <span className="jini-settings-dialog-kicker">{kicker}</span>
              <div className="jini-settings-dialog-head-line">
                <h2>{activeTab?.title ?? activeTab?.label ?? ''}</h2>
                {activeTab?.subtitle ? (
                  <p className="jini-settings-dialog-subtitle">{activeTab.subtitle}</p>
                ) : null}
              </div>
            </>
          )}
        </header>

        <div className="jini-settings-dialog-body">
          <button
            type="button"
            className="jini-settings-dialog-sidebar-toggle"
            onClick={shell.toggleSidebarCollapsed}
            aria-label={sidebarToggleLabel}
            aria-pressed={shell.sidebarCollapsed}
            aria-controls="jini-settings-dialog-sidebar"
            title={sidebarToggleLabel}
          >
            <Icon name={shell.sidebarCollapsed ? 'chevron-right' : 'chevron-left'} size={15} strokeWidth={2} />
          </button>

          <aside
            id="jini-settings-dialog-sidebar"
            className="jini-settings-dialog-sidebar"
            aria-label={sidebarAriaLabel}
            aria-hidden={shell.sidebarCollapsed ? true : undefined}
          >
            {tabs.map((tab) => {
              const active = tab.id === shell.activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`jini-settings-dialog-nav-item${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => shell.setActiveTabId(tab.id)}
                  data-testid={`settings-dialog-nav-${tab.id}`}
                >
                  {/* The icon cell always renders, even when a tab has no icon.
                      This row is a 2-column grid (icon | label); an omitted icon
                      used to leave the label as the *first* child, dropping it
                      into the narrow icon track and wrapping it one character
                      per line. */}
                  <span className="jini-settings-dialog-nav-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span className="jini-settings-dialog-nav-text">
                    <strong>{tab.label}</strong>
                    {tab.navHint ? <small>{tab.navHint}</small> : null}
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="jini-settings-dialog-content" ref={shell.contentRef}>
            {activeTab?.panel}
          </div>
        </div>
    </div>
  );

  // Inline presentation returns the panel bare: no fixed-position backdrop, no
  // `aria-modal`, no click-outside handler. Wrapping it anyway is what made an
  // embedded shell paint a full-viewport overlay over its own host's chrome.
  if (!isModal) return body;

  return (
    <div
      className="jini-settings-dialog-backdrop"
      onClick={onClose}
      data-testid="settings-dialog-backdrop"
    >
      {body}
    </div>
  );
}
