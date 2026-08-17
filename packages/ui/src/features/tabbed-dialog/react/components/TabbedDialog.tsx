import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { findActiveTab } from '../../rules.js';
import type { TabbedDialogChromeLabels, TabbedDialogTabMeta } from '../../types.js';
import { useTabbedDialog } from '../hooks/useTabbedDialog.js';

/** One sidebar-nav entry + its rendered panel. Extends the pure
 *  `TabbedDialogTabMeta` shape with the render-specific fields
 *  (`icon`/`panel`) that only make sense in the React layer. */
export interface TabbedDialogTab<TId extends string = string> extends TabbedDialogTabMeta<TId> {
  icon?: ReactNode;
  panel: ReactNode;
}

export interface TabbedDialogProps<T extends TabbedDialogTab = TabbedDialogTab> {
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
  labels?: TabbedDialogChromeLabels;
  /** Extra chrome rendered in the top-right strip, alongside the fullscreen
   *  toggle and close button — e.g. a host's own autosave-status indicator.
   *  Fully host-owned; the shell renders it as-is. */
  chromeExtra?: ReactNode;
  dialogAriaLabelledBy?: string;
  className?: string;
}

/**
 * Generic tabbed-dialog chrome: modal backdrop + sidebar nav + active-panel
 * switching + fullscreen/collapse/close affordances. Carries no opinion
 * about what any tab contains, or about which product mounts it — a host
 * supplies `tabs`, each with its own `panel` (any `ReactNode`).
 *
 * Extracted (2026-08-13) out of `SettingsDialogShell` (`../../settings/dialog/`), which
 * had accreted five non-Settings hosts in Tovu (`AgentPlugins.tsx`, `AiAssistant.tsx`,
 * `Authentication.tsx`, `PlaceholderTabs.tsx`, plus the original `SettingsUi.tsx`) while
 * still being named — and CSS-classed — after only one of them. `SettingsDialogShell` is
 * now a thin wrapper that renders this component with its own settings-flavoured label
 * defaults (`t('Settings')` kicker, `t('Settings sections')` sidebar aria-label, …); treat
 * it as the reference host, not a special case this component needs to know about.
 *
 * Proof this is separable from any one tab's content: in the origin `SettingsDialog.tsx`
 * (the 8,538-line vendored OD reference — see `packages/ui/source-map.md`), 8 of its 17
 * real tabs were already separate files the original component merely mounted — the shell
 * itself never reached into a tab's internals.
 */
export function TabbedDialog<T extends TabbedDialogTab>({
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
  dialogAriaLabelledBy = 'tabbed-dialog-title',
  className,
}: TabbedDialogProps<T>) {
  const isModal = (presentation ?? (onClose ? 'modal' : 'inline')) === 'modal';
  const t = useT();
  const shell = useTabbedDialog({
    tabs,
    initialActiveTabId,
    activeTabId: controlledActiveTabId,
    onActiveTabIdChange,
    onClose,
    defaultSidebarCollapsed,
    defaultFullscreen,
  });

  const activeTab = findActiveTab(tabs, shell.activeTabId);

  // No brand/product word defaults to a bare `''` here on purpose — this component has no
  // opinion about what it's a dialog FOR. A host that wants a kicker (as `SettingsDialogShell`
  // does, with `t('Settings')`) supplies one via `labels.kicker`.
  const kicker = labels?.kicker ?? '';
  const welcomeKicker = labels?.welcomeKicker ?? t('Welcome');
  const welcomeTitle = labels?.welcomeTitle ?? t('Get started');
  const welcomeSubtitle = labels?.welcomeSubtitle ?? t('Set up your preferences before you begin.');
  const closeLabel = labels?.closeLabel ?? t('Close');
  const fullscreenLabel = labels?.fullscreenLabel ?? t('Fullscreen');
  const exitFullscreenLabel = labels?.exitFullscreenLabel ?? t('Exit fullscreen');
  const collapseSidebarLabel = labels?.collapseSidebarLabel ?? t('Collapse sidebar');
  const expandSidebarLabel = labels?.expandSidebarLabel ?? t('Expand sidebar');
  const sidebarAriaLabel = labels?.sidebarAriaLabel ?? t('Sections');

  const sidebarToggleLabel = shell.sidebarCollapsed ? expandSidebarLabel : collapseSidebarLabel;
  const fullscreenToggleLabel = shell.fullscreen ? exitFullscreenLabel : fullscreenLabel;

  const dialogClassName = [
    'jini-tabbed-dialog',
    shell.sidebarCollapsed ? 'jini-tabbed-dialog-sidebar-collapsed' : '',
    shell.fullscreen ? 'jini-tabbed-dialog-fullscreen' : '',
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
        <div className="jini-tabbed-dialog-chrome">
          {chromeExtra}
          {fullscreenEnabled ? (
            <button
              type="button"
              className="jini-tabbed-dialog-chrome-btn jini-tabbed-dialog-fullscreen-toggle"
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
              className="jini-tabbed-dialog-chrome-btn jini-tabbed-dialog-close"
              onClick={onClose}
              aria-label={closeLabel}
              title={closeLabel}
            >
              <Icon name="close" size={16} strokeWidth={2} />
            </button>
          ) : null}
        </div>

        <header className="jini-tabbed-dialog-head" id={dialogAriaLabelledBy}>
          {welcome ? (
            <>
              <span className="jini-tabbed-dialog-kicker">{welcomeKicker}</span>
              <h2>{welcomeTitle}</h2>
              <p className="jini-tabbed-dialog-subtitle">{welcomeSubtitle}</p>
            </>
          ) : (
            <>
              <span className="jini-tabbed-dialog-kicker">{kicker}</span>
              <div className="jini-tabbed-dialog-head-line">
                <h2>{activeTab?.title ?? activeTab?.label ?? ''}</h2>
                {activeTab?.subtitle ? (
                  <p className="jini-tabbed-dialog-subtitle">{activeTab.subtitle}</p>
                ) : null}
              </div>
            </>
          )}
        </header>

        <div className="jini-tabbed-dialog-body">
          <button
            type="button"
            className="jini-tabbed-dialog-sidebar-toggle"
            onClick={shell.toggleSidebarCollapsed}
            aria-label={sidebarToggleLabel}
            aria-pressed={shell.sidebarCollapsed}
            aria-controls="jini-tabbed-dialog-sidebar"
            title={sidebarToggleLabel}
          >
            <Icon name={shell.sidebarCollapsed ? 'chevron-right' : 'chevron-left'} size={15} strokeWidth={2} />
          </button>

          <aside
            id="jini-tabbed-dialog-sidebar"
            className="jini-tabbed-dialog-sidebar"
            aria-label={sidebarAriaLabel}
            aria-hidden={shell.sidebarCollapsed ? true : undefined}
          >
            {tabs.map((tab) => {
              const active = tab.id === shell.activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`jini-tabbed-dialog-nav-item${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => shell.setActiveTabId(tab.id)}
                  /*
                   * `settings-dialog-nav-${tab.id}`, not `tabbed-dialog-nav-${tab.id}`: this
                   * testid predates this component's extraction and several Tovu Playwright
                   * e2e specs (development/e2e/byok-*.spec.ts,
                   * placeholder-tabs-card-parity.spec.ts) hard-code the old prefix. Renaming
                   * it here would silently break those specs with no local way to catch it —
                   * this package's own test suite can't see Tovu's e2e tree. Left unchanged
                   * on purpose; see the extraction handoff for the full consumer list.
                   */
                  data-testid={`settings-dialog-nav-${tab.id}`}
                  /*
                   * Not tagged in modal presentation. This shell can be mounted twice on the same
                   * page at once — an inline instance plus a modal preview of the identical tab
                   * set — and `data-agent-element` handles must be unique within whatever root the
                   * host's page driver scans; two buttons both publishing `tab-execution` would
                   * make that handle ambiguous and refuse to click (`dom-page-driver.ts`'s
                   * `ambiguousHandleError`). The inline instance is always the primary,
                   * always-present surface, so it keeps the handle; the modal is a secondary,
                   * user-opened preview no host publishes as agent-reachable on its own, so
                   * leaving it untagged here costs nothing.
                   *
                   * `tab-${tab.id}`, not e.g. `settings-tab-${tab.id}`: this shell is generic —
                   * hosts mount it for all kinds of tabbed sections, not only Settings — so a
                   * handle naming any one host would misdescribe every other one.
                   */
                  data-agent-element={isModal ? undefined : `tab-${tab.id}`}
                  data-agent-role={isModal ? undefined : 'button'}
                  data-agent-label={isModal ? undefined : tab.label}
                >
                  {/* The icon cell always renders, even when a tab has no icon.
                      This row is a 2-column grid (icon | label); an omitted icon
                      used to leave the label as the *first* child, dropping it
                      into the narrow icon track and wrapping it one character
                      per line. */}
                  <span className="jini-tabbed-dialog-nav-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span className="jini-tabbed-dialog-nav-text">
                    <strong>{tab.label}</strong>
                    {tab.navHint ? <small>{tab.navHint}</small> : null}
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="jini-tabbed-dialog-content" ref={shell.contentRef}>
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
      className="jini-tabbed-dialog-backdrop"
      onClick={onClose}
      // `settings-dialog-backdrop`, not `tabbed-dialog-backdrop` — same reasoning as the
      // nav-item testid above: kept unchanged so Tovu's existing Playwright specs and unit
      // tests keep matching it.
      data-testid="settings-dialog-backdrop"
    >
      {body}
    </div>
  );
}
