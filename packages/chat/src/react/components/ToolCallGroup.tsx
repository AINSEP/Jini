import type { ReactNode } from 'react';
import type { ToolDisplayRow } from '../tool-call-display.js';
import { useToolCallGroup } from './ToolCallGroup.hooks.js';
import { Icon } from './Icon.js';

/**
 * One turn's tool cards folded into a single line ("Used 3 tools ▸") that opens on click — the
 * `toolCallDisplay: 'collapsed'` layout. Props in, JSX out; state and copy are in
 * `useToolCallGroup`.
 */
export function ToolCallGroup<Row extends ToolDisplayRow>({ rows, renderRow }: {
  rows: readonly Row[];
  renderRow: (row: Row) => ReactNode;
}) {
  const group = useToolCallGroup({ rows });
  return (
    <div className="jini-tool-group" data-failed={group.failed ? 'true' : undefined}>
      <button type="button" className="jini-tool-group__toggle" aria-expanded={group.open} onClick={group.toggle}>
        <span className={`jini-tool-group__label${group.running ? ' shimmer-text' : ''}`}>{group.label}</span>
        <Icon name={group.open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {group.open ? <div className="jini-message-tools">{rows.map(renderRow)}</div> : null}
    </div>
  );
}
