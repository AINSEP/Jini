import { agentHandleProps } from '@jini-ai/agentic';
import { useAgentHandle, type AgentControlProps } from '../../../../react/hooks/useAgentHandle.js';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useT } from '../../../i18n/index.js';
import { TAB_STRIP_ITEM_ID_ATTRIBUTE } from '../../constants.js';
import { isTabClosable } from '../../rules.js';
import type { TabStripDropEdge, TabStripTab } from '../../types.js';
import type { TabStripItemDragProps } from '../hooks/useTabStripDragReorder.js';

export interface TabStripItemProps extends AgentControlProps {
  tab: TabStripTab;
  active: boolean;
  dragging: boolean;
  dragOverEdge: TabStripDropEdge | null;
  dragProps: TabStripItemDragProps;
  onActivate: (tabId: string) => void;
  onClose?: ((tabId: string) => void) | undefined;
  /** Overrides the default `t('Close tab')` label/tooltip/aria-label. */
  closeLabel?: string | undefined;
  /** Overrides the default `×` close-button glyph. */
  closeIcon?: ReactNode | undefined;
}

/**
 * One draggable/reorderable tab-strip item — the primitive both
 * `WorkspaceTabsBar.tsx`'s `workspace-tab` div and `FileWorkspace.tsx`'s
 * `Tab` component independently reimplemented. `content` (icon, label, meta,
 * badges — whatever the host needs) is entirely host-injected; this
 * component only owns the shared shell: active/pinned/dragging/drag-over
 * state classes, the close button, drag wiring, and click/Enter/Space
 * activation (the ARIA `tab` role pattern `FileWorkspace.tsx`'s `Tab`
 * already used — `WorkspaceTabsBar.tsx`'s nested `<button>` for the same
 * purpose is redundant once the outer element itself is focusable/
 * keyboard-activatable, so this follows the simpler of the two shapes).
 */
export function TabStripItem({
  tab,
  active,
  dragging,
  dragOverEdge,
  dragProps,
  onActivate,
  onClose,
  closeLabel,
  closeIcon,
  ...agentProps
}: TabStripItemProps) {
  const base = useAgentHandle(agentProps);
  const t = useT();
  const resolvedCloseLabel = closeLabel ?? t('Close tab');
  const showClose = isTabClosable(tab, Boolean(onClose));

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    dragProps.onClickCapture(event);
    if (event.defaultPrevented) return;
    onActivate(tab.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(tab.id);
    }
  };

  const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose?.(tab.id);
  };

  const className = [
    'jini-tab-strip-item',
    active ? 'is-active' : '',
    tab.pinned ? 'is-pinned' : '',
    dragging ? 'is-dragging' : '',
    dragOverEdge ? `is-drag-over-${dragOverEdge}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      {...agentHandleProps({}, { base, role: 'button', ...(tab.title === undefined ? {} : { label: tab.title }) })}
      data-agent-private={agentProps['data-agent-private']} data-agent-page={agentProps['data-agent-page']}
      {...{ [TAB_STRIP_ITEM_ID_ATTRIBUTE]: tab.id }}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={tab.title}
      draggable={dragProps.draggable}
      onDragStart={dragProps.onDragStart}
      onDragEnd={dragProps.onDragEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="jini-tab-strip-item__content">{tab.content}</div>
      {showClose ? (
        <button
          {...agentHandleProps({}, { base, action: 'close', role: 'button', label: resolvedCloseLabel })}
          type="button"
          className="jini-tab-strip-item__close"
          aria-label={resolvedCloseLabel}
          title={resolvedCloseLabel}
          onClick={handleClose}
        >
          {closeIcon ?? '×'}
        </button>
      ) : null}
    </div>
  );
}
