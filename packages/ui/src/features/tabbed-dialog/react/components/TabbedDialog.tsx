import type { ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { findActiveTab } from '../../rules.js';
import type { TabbedDialogChromeLabels, TabbedDialogTabMeta } from '../../types.js';
import { useTabbedDialog } from '../hooks/useTabbedDialog.js';
import { TabbedDialogChrome } from './TabbedDialogChrome.js';
import { TabbedDialogHeader } from './TabbedDialogHeader.js';
import { TabbedDialogSidebar } from './TabbedDialogSidebar.js';
import {
  buildTabbedDialogClassName,
  dialogRootRoleProps,
  resolveIsModal,
  resolveTabbedDialogLabels,
} from './tabbedDialogView.js';

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
 * had accreted five non-Settings hosts in a downstream consumer (`AgentPlugins.tsx`, `AiAssistant.tsx`,
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
  const isModal = resolveIsModal({ hasOnClose: Boolean(onClose) }, { presentation });
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
  const resolvedLabels = resolveTabbedDialogLabels({ t }, { labels });

  const body = (
    <div
      className={buildTabbedDialogClassName(shell, { className })}
      {...dialogRootRoleProps({ isModal })}
      aria-labelledby={dialogAriaLabelledBy}
    >
      <TabbedDialogChrome
        chromeExtra={chromeExtra}
        fullscreenEnabled={fullscreenEnabled}
        fullscreen={shell.fullscreen}
        onToggleFullscreen={shell.toggleFullscreen}
        onClose={onClose}
        labels={resolvedLabels}
      />

      <TabbedDialogHeader id={dialogAriaLabelledBy} welcome={welcome} activeTab={activeTab} labels={resolvedLabels} />

      <div className="jini-tabbed-dialog-body">
        <TabbedDialogSidebar
          tabs={tabs}
          activeTabId={shell.activeTabId}
          isModal={isModal}
          collapsed={shell.sidebarCollapsed}
          onToggleCollapsed={shell.toggleSidebarCollapsed}
          onSelect={shell.setActiveTabId}
          labels={resolvedLabels}
        />

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
      // nav-item testid in `TabbedDialogSidebar.tsx`: kept unchanged so a downstream consumer's existing Playwright specs and unit
      // tests keep matching it.
      data-testid="settings-dialog-backdrop"
    >
      {body}
    </div>
  );
}

