import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { SettingsDialogTabMeta } from '@jini-ai/ui-core';
import { resolveInitialActiveTabId } from '@jini-ai/ui-core';
import { useDismissOnOutsideOrEscape } from '../../../../../browser/useDismissOnOutsideOrEscape.js';

export interface UseSettingsDialogShellParams<T extends SettingsDialogTabMeta> {
  tabs: readonly T[];
  /** Uncontrolled initial active tab id. Ignored once `activeTabId` (the
   *  controlled prop) is supplied. */
  initialActiveTabId?: string | undefined;
  /** Controlled active tab id. Supply together with `onActiveTabIdChange` to
   *  drive the active tab from host state (e.g. a route param); omit both
   *  for uncontrolled internal state. */
  activeTabId?: string | undefined;
  onActiveTabIdChange?: ((tabId: string) => void) | undefined;
  /** Closes the dialog. Wired to the backdrop click, the close button, and
   *  the global Escape key — all three are standard modal affordances, not
   *  settings-specific behavior. Omit to disable Escape-to-close and render
   *  the shell without a close button (a host embedding the shell inline,
   *  not as a modal). */
  onClose?: (() => void) | undefined;
  defaultSidebarCollapsed?: boolean | undefined;
  defaultFullscreen?: boolean | undefined;
}

export interface SettingsDialogShellController {
  activeTabId: string | null;
  setActiveTabId: (tabId: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  contentRef: RefObject<HTMLDivElement | null>;
}

/**
 * Owns the shell's own UI state: which tab is active, whether the sidebar is
 * collapsed, whether the dialog is fullscreen, and the "scroll the content
 * pane back to the top when the active tab changes" + "Escape closes the
 * dialog" behaviors. None of this reads or writes any tab's own data — a
 * tab's internal state (e.g. a draft config) stays owned by that tab.
 */
export function useSettingsDialogShell<T extends SettingsDialogTabMeta>({
  tabs,
  initialActiveTabId,
  activeTabId: controlledActiveTabId,
  onActiveTabIdChange,
  onClose,
  defaultSidebarCollapsed = false,
  defaultFullscreen = false,
}: UseSettingsDialogShellParams<T>): SettingsDialogShellController {
  const [uncontrolledActiveTabId, setUncontrolledActiveTabId] = useState<string | null>(() =>
    resolveInitialActiveTabId(tabs, initialActiveTabId),
  );
  const isControlled = controlledActiveTabId !== undefined;
  const activeTabId = isControlled ? controlledActiveTabId : uncontrolledActiveTabId;

  const setActiveTabId = (tabId: string) => {
    if (!isControlled) setUncontrolledActiveTabId(tabId);
    onActiveTabIdChange?.(tabId);
  };

  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed);
  const toggleSidebarCollapsed = () => setSidebarCollapsed((current) => !current);

  const [fullscreen, setFullscreen] = useState(defaultFullscreen);
  const toggleFullscreen = () => setFullscreen((current) => !current);

  const contentRef = useRef<HTMLDivElement | null>(null);

  // Scroll the content pane back to the top whenever the active tab
  // changes — without this, switching from a long tab the user had
  // scrolled into a short one leaves the new tab's header out of view.
  useEffect(() => {
    const el = contentRef.current;
    if (el) el.scrollTop = 0;
  }, [activeTabId]);

  // Global Escape closes the dialog — standard modal affordance alongside
  // the backdrop click and the close button. Routed through the shared
  // `useDismissOnOutsideOrEscape` toolbox hook (packages/ui/src/browser/)
  // in its Escape-only shape (no `containerRef` — the backdrop click is
  // already handled separately by the host), matching the call site that
  // hook's own doc comment names for this exact hook.
  useDismissOnOutsideOrEscape(() => onClose?.(), { enabled: Boolean(onClose) });

  return {
    activeTabId,
    setActiveTabId,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    fullscreen,
    toggleFullscreen,
    contentRef,
  };
}
