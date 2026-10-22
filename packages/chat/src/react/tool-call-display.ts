/**
 * @module tool-call-display
 *
 * How a transcript shows tool calls (owner, 2026-10-11 — Chat settings → Display):
 *
 * - `'show'`      — every tool card, where it happened. The layout every host had before this.
 * - `'collapsed'` — each turn's tool cards fold into ONE line ("Used 3 tools") that expands on
 *   click; while a tool runs the line names it instead ("Running Bash…").
 * - `'hidden'`    — no tool cards at all, EXCEPT a failed one: an error must never vanish from the
 *   transcript just because the reader asked for a quieter view.
 *
 * Pure rules over `interleaveMessageBlocks`' output (or the flat row list when that refused), kept
 * out of `MessageRow.tsx` so every mode is testable without rendering.
 */
import type { ToolStatus } from '../core/index.js';
import { humanizeToolName } from '../core/index.js';
import type { MessageBlock } from './message-blocks.js';

export type ToolCallDisplay = 'show' | 'collapsed' | 'hidden';

/** The fields of a tool row these rules read — `ToolTimelineRow` satisfies it. */
export interface ToolDisplayRow {
  readonly id: string;
  readonly name: string;
  readonly status: ToolStatus;
  readonly use?: { readonly input: unknown };
}

/**
 * Whether a row is a failure the reader must always see: the tool returned an error, or the run
 * ended without the tool ever answering (`deriveToolStatus` maps both to `'error'`).
 * @complexity O(1).
 */
export function isFailedToolRow({ row }: { row: Pick<ToolDisplayRow, 'status'> }): boolean {
  return row.status === 'error';
}

/** Running = no result yet while the run streams (`'executing'`), or not started (`'inProgress'`). */
function isRunningToolRow(row: Pick<ToolDisplayRow, 'status'>): boolean {
  return row.status === 'executing' || row.status === 'inProgress';
}

/**
 * Applies a display mode to an interleaved message.
 *
 * `'collapsed'` merges every `tools` block of one turn into the turn's FIRST `tools` block (its
 * position and key), so the turn shows a single fold-up line. A turn ends at a `reply-end` block —
 * the mid-run user message that starts the next reply — so a message holding several replies keeps
 * one line per reply. Keeping the first block's key keeps the line's open/closed state across
 * streaming updates, since later blocks append after it.
 *
 * `'hidden'` keeps only failed rows and drops `tools` blocks left empty.
 *
 * @param input.blocks - `interleaveMessageBlocks` output.
 * @param input.mode - The display mode.
 * @returns New blocks; the input is never mutated. `'show'` returns `blocks` itself.
 * @complexity O(n) in blocks + rows.
 */
export function applyToolCallDisplay<Row extends ToolDisplayRow>(
  { blocks, mode }: { blocks: readonly MessageBlock<Row>[]; mode: ToolCallDisplay },
): readonly MessageBlock<Row>[] {
  if (mode === 'show') return blocks;
  return mode === 'hidden' ? hideToolCalls({ blocks }) : collapseToolCalls({ blocks });
}

/** `'hidden'`: keeps only failed rows and drops `tools` blocks left empty. */
function hideToolCalls<Row extends ToolDisplayRow>({ blocks }: { blocks: readonly MessageBlock<Row>[] }): MessageBlock<Row>[] {
  const out: MessageBlock<Row>[] = [];
  for (const block of blocks) {
    if (block.kind !== 'tools') {
      out.push(block);
      continue;
    }
    const failed = block.rows.filter((row) => isFailedToolRow({ row }));
    if (failed.length > 0) out.push({ kind: 'tools', rows: failed, key: block.key });
  }
  return out;
}

/** `'collapsed'`: merges every `tools` block of a turn into the turn's first one (see above). */
function collapseToolCalls<Row extends ToolDisplayRow>({ blocks }: { blocks: readonly MessageBlock<Row>[] }): MessageBlock<Row>[] {
  const out: MessageBlock<Row>[] = [];
  let turnToolsIndex = -1;
  for (const block of blocks) {
    if (block.kind === 'reply-end') turnToolsIndex = -1;
    const first = turnToolsIndex === -1 ? undefined : out[turnToolsIndex];
    if (block.kind === 'tools' && first?.kind === 'tools') {
      out[turnToolsIndex] = { kind: 'tools', rows: [...first.rows, ...block.rows], key: first.key };
      continue;
    }
    if (block.kind === 'tools') turnToolsIndex = out.length;
    out.push(block);
  }
  return out;
}

/**
 * The flat layout's counterpart (used when `interleaveMessageBlocks` refused): `'hidden'` keeps only
 * failed rows; the other modes keep every row (`'collapsed'` folds them into one line at render).
 * @complexity O(n) in rows.
 */
export function toolRowsForDisplay<Row extends ToolDisplayRow>(
  { rows, mode }: { rows: readonly Row[]; mode: ToolCallDisplay },
): readonly Row[] {
  return mode === 'hidden' ? rows.filter((row) => isFailedToolRow({ row })) : rows;
}

/** What a collapsed tool line says: the tool running now, or how many ran (and how many failed). */
export type ToolGroupSummary =
  | { readonly kind: 'running'; readonly name: string }
  | { readonly kind: 'done'; readonly count: number; readonly failed: number };

/**
 * Summarises one turn's tool rows. The LAST running row wins, so a line over several in-flight calls
 * names the newest one, matching what the run is doing now.
 * @complexity O(n) in rows.
 */
export function summarizeToolGroup({ rows }: { rows: readonly ToolDisplayRow[] }): ToolGroupSummary {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (isRunningToolRow(row)) return { kind: 'running', name: humanizeToolName({ name: row.name }, { input: row.use?.input }) };
  }
  return { kind: 'done', count: rows.length, failed: rows.filter((row) => isFailedToolRow({ row })).length };
}

/**
 * The collapsed line's text. Each phrase is its own translation key (the English string is the key,
 * see `slots.ts`), with `{count}`/`{name}` filled by the translator.
 * @complexity O(1).
 */
export function toolGroupLabel(
  { summary, t }: { summary: ToolGroupSummary; t: (key: string, vars?: Record<string, string | number>) => string },
): string {
  if (summary.kind === 'running') return t('Running {name}…', { name: summary.name });
  const used = summary.count === 1 ? t('Used 1 tool') : t('Used {count} tools', { count: summary.count });
  return summary.failed > 0 ? `${used} · ${t('{count} failed', { count: summary.failed })}` : used;
}
