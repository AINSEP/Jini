import type { KeyboardEvent, MouseEvent } from 'react';
import { isTabClosable } from '../../rules.js';
import type { TabStripItemProps } from './TabStripItem.js';

/** Coordinate drag capture, keyboard activation, and close for one tab. */
export function useTabStripItem({ tab, active, dragging, dragOverEdge, dragProps, onActivate, onClose }: Pick<TabStripItemProps, 'tab' | 'active' | 'dragging' | 'dragOverEdge' | 'dragProps' | 'onActivate' | 'onClose'>, _options = {}) {
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
  ].filter(Boolean).join(' ');
  return { showClose, handleClick, handleKeyDown, handleClose, className };
}
