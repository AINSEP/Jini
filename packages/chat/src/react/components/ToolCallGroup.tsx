import type { ReactNode } from 'react';
import type { ToolDisplayRow } from '../tool-call-display.js';
import { useToolCallGroup } from './ToolCallGroup.hooks.js';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';

/** Hooks ToolCallGroup calls; defaults to the real ones, a test hands in fakes. */
export const defaultToolCallGroupHooks = { useToolCallGroup, useT };
export type ToolCallGroupHooks = typeof defaultToolCallGroupHooks;

/**
 * One turn's tool cards folded into a single line ("Used 3 tools ▸") that opens on click — the
 * `toolCallDisplay: 'collapsed'` layout, or the compact failure notice in 'hidden'. The disclosure
 * state lives in `useToolCallGroup`; copy uses the host's translator.
 */
export function ToolCallGroup<Row extends ToolDisplayRow>({ rows, renderRow, failureOnly = false, hooks = defaultToolCallGroupHooks }: {
  rows: readonly Row[];
  failureOnly?: boolean;
  renderRow: (row: Row) => ReactNode;
} & { hooks?: ToolCallGroupHooks | undefined }) {
  const group = hooks.useToolCallGroup({ rows });
  const t = hooks.useT();
  return (
    <div className="jini-tool-group" data-failed={group.failed ? 'true' : undefined}>
      {failureOnly ? <span className="jini-tool-group__label">{t('A step failed')} </span> : null}
      <ToolGroupToggle group={group} failureOnly={failureOnly} t={t} />
      {group.open ? <div className="jini-message-tools">{rows.map(renderRow)}</div> : null}
    </div>
  );
}

/** The one-line disclosure button: the tool summary, or a bare "Show" under the failure-only layout. */
function ToolGroupToggle({ group, failureOnly, t }: {
  group: ReturnType<typeof useToolCallGroup>;
  failureOnly: boolean;
  t: ReturnType<typeof useT>;
}) {
  return (
    <button type="button" className="jini-tool-group__toggle" aria-expanded={group.open} onClick={group.toggle}>
      <span className={`jini-tool-group__label${group.running ? ' shimmer-text' : ''}`}>{failureOnly ? t('Show') : group.label}</span>
      {!failureOnly && group.failureLabel ? <span className="jini-tool-group__failed"> · {group.failureLabel}</span> : null}
      <Icon name={group.open ? 'chevron-down' : 'chevron-right'} size={12} />
    </button>
  );
}
