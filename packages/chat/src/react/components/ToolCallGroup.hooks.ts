import { useCallback, useState } from 'react';
import { useT } from '../hooks/context.js';
import { summarizeToolGroup, toolGroupLabel, type ToolDisplayRow } from '../tool-call-display.js';

export interface ToolCallGroupState {
  /** Whether the turn's tool cards are showing under the line. Starts closed. */
  open: boolean;
  toggle: () => void;
  /** "Used 3 tools", or "Running Bash…" while a tool runs. */
  label: string;
  /** The failure suffix, styled independently of the tool count. */
  failureLabel: string | undefined;
  running: boolean;
  failed: boolean;
}

/**
 * State and copy for one collapsed tool line (`toolCallDisplay: 'collapsed'`). The open flag lives
 * in the line's own component, so it lasts as long as the message stays in the transcript — the
 * whole time its conversation is open — and resets when the pane remounts.
 * @complexity O(n) in rows, for the summary.
 */
export function useToolCallGroup({ rows }: { rows: readonly ToolDisplayRow[] }, _optional = {}): ToolCallGroupState {
  const t = useT();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const summary = summarizeToolGroup({ rows });
  return {
    open,
    toggle,
    label: toolGroupLabel({ summary: summary.kind === 'done' ? { ...summary, failed: 0 } : summary, t }),
    failureLabel: summary.kind === 'done' && summary.failed > 0 ? t('{count} failed', { count: summary.failed }) : undefined,
    running: summary.kind === 'running',
    failed: summary.kind === 'done' && summary.failed > 0,
  };
}
