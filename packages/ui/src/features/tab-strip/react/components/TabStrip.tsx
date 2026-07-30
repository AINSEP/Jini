import type { ReactNode } from 'react';
import { noopTabStripHaptics } from '../../ports.js';
import type { TabStripHapticsPort } from '../../ports.js';
import type { TabStripDropEdge, TabStripReorderTiming, TabStripTab } from '../../types.js';
import { useTabStripDragReorder } from '../hooks/useTabStripDragReorder.js';
import { TabStripItem } from './TabStripItem.js';

export interface TabStripProps {
  tabs: TabStripTab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose?: ((tabId: string) => void) | undefined;
  onReorder: (sourceId: string, targetId: string, edge: TabStripDropEdge) => void;
  /** See `useTabStripDragReorder`'s `reorderTiming` option. Defaults to `'onDrop'`. */
  reorderTiming?: TabStripReorderTiming | undefined;
  /** Defaults to a no-op; pass `createBrowserTabStripHaptics()` to opt in. */
  haptics?: TabStripHapticsPort | undefined;
  closeLabel?: string | undefined;
  closeIcon?: ReactNode | undefined;
  /** Host-injected trailing content — e.g. a "new tab" button, rendered
   *  after the last tab inside the strip container. */
  trailing?: ReactNode | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
  /** Custom hook override for dependency injection / testing. */
  useTabStripDragReorder?: typeof useTabStripDragReorder;
}

/**
 * The consolidated tab-strip primitive: composes `useTabStripDragReorder`
 * with `TabStripItem` into the reorderable `role="tablist"` shell both
 * `WorkspaceTabsBar.tsx` (the app's top-level workspace tabs) and
 * `FileWorkspace.tsx` (a project's file/terminal/browser tab strip)
 * independently hand-rolled. Tab content, order (`tabs`), and active id are
 * fully host-owned; this component only supplies the shared drag/reorder/
 * active/close-button chrome. See `packages/ui/source-map.md`'s
 * `features/tab-strip/` section for what each source shape contributed and
 * what stayed host-specific (hover-preview popover, search-tabs popover,
 * global keyboard shortcuts, and localStorage/route-sync persistence are
 * all `WorkspaceTabsBar.tsx`-only chrome that remain host-composed, not
 * part of this primitive).
 */
export function TabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onReorder,
  reorderTiming,
  haptics = noopTabStripHaptics,
  closeLabel,
  closeIcon,
  trailing,
  ariaLabel,
  className,
  useTabStripDragReorder: useTabStripDragReorderHook = useTabStripDragReorder,
}: TabStripProps) {
  const { draggingTabId, dragOverTarget, stripRef, stripDragProps, getItemDragProps } = useTabStripDragReorderHook({
    tabs,
    onReorder,
    reorderTiming,
    haptics,
  });

  return (
    <div
      className={['jini-tab-strip', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
      ref={stripRef}
      onDragOver={stripDragProps.onDragOver}
      onDrop={stripDragProps.onDrop}
      onDragLeave={stripDragProps.onDragLeave}
    >
      {tabs.map((tab) => (
        <TabStripItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          dragging={draggingTabId === tab.id}
          dragOverEdge={
            dragOverTarget?.tabId === tab.id && draggingTabId !== tab.id ? dragOverTarget.edge : null
          }
          dragProps={getItemDragProps(tab.id)}
          onActivate={onActivate}
          onClose={onClose}
          closeLabel={closeLabel}
          closeIcon={closeIcon}
        />
      ))}
      {trailing}
    </div>
  );
}
