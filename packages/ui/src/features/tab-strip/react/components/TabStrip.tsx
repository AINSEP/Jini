import { agentHandleSegment } from '@jini-ai/core/agent-handles';
import { useAgentHandle, type AgentControlProps } from '../../../../react/hooks/useAgentHandle.js';
import type { ReactNode } from 'react';
import { noopTabStripHaptics } from '../../ports.js';
import type { TabStripHapticsPort } from '../../ports.js';
import type { TabStripDropEdge, TabStripReorderTiming, TabStripTab } from '../../types.js';
import { useTabStripDragReorder } from '../hooks/useTabStripDragReorder.js';
import { TabStripItem } from './TabStripItem.js';
import { TabStripFrame } from './TabStripFrame.js';

export interface TabStripProps extends AgentControlProps {
  useAgentHandleHook?: typeof useAgentHandle;
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
 * active/close-button chrome. See `archived UI source map`'s
 * `features/tab-strip/` section for what each source shape contributed and
 * what stayed host-specific (hover-preview popover, search-tabs popover,
 * global keyboard shortcuts, and localStorage/route-sync persistence are
 * all `WorkspaceTabsBar.tsx`-only chrome that remain host-composed, not
 * part of this primitive).
 */
export function TabStrip({
  useAgentHandleHook = useAgentHandle,
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
  ...agentProps
}: TabStripProps) {
  const base = useAgentHandleHook(agentProps);
  const { draggingTabId, dragOverTarget, stripRef, stripDragProps, getItemDragProps } = useTabStripDragReorderHook({
    tabs,
    onReorder,
    reorderTiming,
    haptics,
  });

  return (
    <TabStripFrame
      className={['jini-tab-strip', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
      ref={stripRef}
      onDragOver={stripDragProps.onDragOver}
      onDrop={stripDragProps.onDrop}
      onDragLeave={stripDragProps.onDragLeave}
    >
      <TabStripItems tabs={tabs} activeTabId={activeTabId} onActivate={onActivate} onClose={onClose} closeLabel={closeLabel} closeIcon={closeIcon}
        base={base} page={agentProps['data-agent-page']} draggingTabId={draggingTabId} dragOverTarget={dragOverTarget} getItemDragProps={getItemDragProps} />
      {trailing}
    </TabStripFrame>
  );
}

function TabStripItems({ tabs, activeTabId, onActivate, onClose, closeLabel, closeIcon, base, page, draggingTabId, dragOverTarget, getItemDragProps }: {
  tabs: TabStripTab[]; activeTabId: string | null; onActivate: TabStripProps['onActivate']; onClose: TabStripProps['onClose'];
  closeLabel: string | undefined; closeIcon: ReactNode; base: string | undefined; page: string | undefined;
} & Pick<ReturnType<typeof useTabStripDragReorder>, 'draggingTabId' | 'dragOverTarget' | 'getItemDragProps'>) {
  return <>
      {tabs.map((tab) => (
        <TabStripItem
          key={tab.id}
          agentHandle={base ? `${base}-tab-${agentHandleSegment({ value: tab.id })}` : false}
          data-agent-page={page}
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
  </>;
}
