import type { ReactNode } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import type { TabbedDialogTabMeta } from '../../types.js';
import type { ResolvedTabbedDialogLabels } from './tabbedDialogView.js';

/** The slice of a tab the sidebar nav renders (no `panel`). */
export type TabbedDialogNavTab = TabbedDialogTabMeta & { icon?: ReactNode };

export interface TabbedDialogNavItemProps {
  tab: TabbedDialogNavTab;
  active: boolean;
  isModal: boolean;
  onSelect: (tabId: string) => void;
}

/** One sidebar nav button. */
export function TabbedDialogNavItem({ tab, active, isModal, onSelect }: TabbedDialogNavItemProps) {
  return (
    <button
      type="button"
      className={`jini-tabbed-dialog-nav-item${active ? ' active' : ''}`}
      aria-pressed={active}
      onClick={() => onSelect(tab.id)}
      /*
       * `settings-dialog-nav-${tab.id}`, not `tabbed-dialog-nav-${tab.id}`: this
       * testid predates this component's extraction and several of a downstream
       * consumer's Playwright e2e specs (development/e2e/byok-*.spec.ts,
       * placeholder-tabs-card-parity.spec.ts) hard-code the old prefix. Renaming
       * it here would silently break those specs with no local way to catch it —
       * this package's own test suite can't see that consumer's e2e tree. Left unchanged
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
}

export interface TabbedDialogSidebarProps {
  tabs: readonly TabbedDialogNavTab[];
  activeTabId: string | null;
  isModal: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (tabId: string) => void;
  labels: ResolvedTabbedDialogLabels;
}

/** The collapse toggle plus the sidebar nav it controls. */
export function TabbedDialogSidebar({
  tabs,
  activeTabId,
  isModal,
  collapsed,
  onToggleCollapsed,
  onSelect,
  labels,
}: TabbedDialogSidebarProps) {
  const sidebarToggleLabel = collapsed ? labels.expandSidebarLabel : labels.collapseSidebarLabel;
  return (
    <>
      <button
        type="button"
        className="jini-tabbed-dialog-sidebar-toggle"
        onClick={onToggleCollapsed}
        aria-label={sidebarToggleLabel}
        aria-pressed={collapsed}
        aria-controls="jini-tabbed-dialog-sidebar"
        title={sidebarToggleLabel}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={15} strokeWidth={2} />
      </button>

      <aside
        id="jini-tabbed-dialog-sidebar"
        className="jini-tabbed-dialog-sidebar"
        aria-label={labels.sidebarAriaLabel}
        aria-hidden={collapsed ? true : undefined}
      >
        {tabs.map((tab) => (
          <TabbedDialogNavItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            isModal={isModal}
            onSelect={onSelect}
          />
        ))}
      </aside>
    </>
  );
}
