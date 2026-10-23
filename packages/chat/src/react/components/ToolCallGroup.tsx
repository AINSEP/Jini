import type { ReactNode } from 'react';
import type { ToolDisplayRow } from '../tool-call-display.js';
import { useToolCallGroup } from './ToolCallGroup.hooks.js';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';

/**
 * One turn's tool cards folded into a single line ("Used 3 tools ▸") that opens on click — the
 * `toolCallDisplay: 'collapsed'` layout, or the compact failure notice in 'hidden'. The disclosure
 * state lives in `useToolCallGroup`; copy uses the host's translator.
 */
export function ToolCallGroup<Row extends ToolDisplayRow>({ rows, renderRow, failureOnly = false }: {
  rows: readonly Row[];
  failureOnly?: boolean;
  renderRow: (row: Row) => ReactNode;
}) {
  const group = useToolCallGroup({ rows });
  const t = useT();
  return (
    <div className="jini-tool-group" data-failed={group.failed ? 'true' : undefined}>
      {failureOnly ? <span className="jini-tool-group__label">{t('A step failed')} </span> : null}
      <button type="button" className="jini-tool-group__toggle" aria-expanded={group.open} onClick={group.toggle}>
        <span className={`jini-tool-group__label${group.running ? ' shimmer-text' : ''}`}>{failureOnly ? t('Show') : group.label}</span>
        {!failureOnly && group.failureLabel ? <span className="jini-tool-group__failed"> · {group.failureLabel}</span> : null}
        <Icon name={group.open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {group.open ? <div className="jini-message-tools">{rows.map(renderRow)}</div> : null}
    </div>
  );
}
