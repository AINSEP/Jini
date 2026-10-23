import { describe, expect, it } from 'vitest';
import type { ToolStatus } from '../../core/index.js';
import type { MessageBlock } from '../message-blocks.js';
import {
  applyToolCallDisplay,
  isFailedToolRow,
  summarizeToolGroup,
  toolGroupLabel,
  toolRowsForDisplay,
  type ToolDisplayRow,
} from '../tool-call-display.js';

/**
 * @file The three tool-call display modes over real block shapes. The load-bearing invariants:
 * collapsed folds a turn into exactly one tools block (never across a reply boundary), and hidden
 * never drops an unrecovered failure or mistakes a later reply for recovery.
 */

const row = (id: string, status: ToolStatus = 'complete', name = 'Bash'): ToolDisplayRow => ({ id, name, status, use: { input: {} } });
const text = (key: string): MessageBlock<ToolDisplayRow> => ({ kind: 'text', text: key, key });
const tools = (key: string, ...rows: ToolDisplayRow[]): MessageBlock<ToolDisplayRow> => ({ kind: 'tools', rows, key });
const replyEnd = (index: number): MessageBlock<ToolDisplayRow> => ({ kind: 'reply-end', index, key: `reply-end-${index}` });

/** Readable shape: text keys, tools as `key:[ids]`, reply ends as `|`. */
function shape(blocks: readonly MessageBlock<ToolDisplayRow>[]): string[] {
  return blocks.map((block) => {
    if (block.kind === 'tools') return `${block.key}:[${block.rows.map((r) => r.id).join(',')}]`;
    if (block.kind === 'reply-end') return '|';
    return block.key;
  });
}

const t = (key: string, vars?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars?.[name] ?? `{${name}}`));

describe('applyToolCallDisplay', () => {
  const blocks = [text('a'), tools('tools-1', row('t1')), text('b'), tools('tools-3', row('t2', 'error'), row('t3')), replyEnd(0), text('c'), tools('tools-6', row('t4'))];

  it('show returns the blocks untouched', () => {
    expect(applyToolCallDisplay({ blocks, mode: 'show' })).toBe(blocks);
  });

  it('collapsed merges a turn\'s tools blocks into its first one, and starts over after a reply ends', () => {
    expect(shape(applyToolCallDisplay({ blocks, mode: 'collapsed' }))).toEqual([
      'a', 'tools-1:[t1,t2,t3]', 'b', '|', 'c', 'tools-6:[t4]',
    ]);
  });

  it('collapsed keeps a single-block turn as it was', () => {
    expect(shape(applyToolCallDisplay({ blocks: [text('a'), tools('tools-1', row('t1'))], mode: 'collapsed' }))).toEqual(['a', 'tools-1:[t1]']);
  });

  it('hidden drops failures followed by a successful row in the same reply', () => {
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }))).toEqual(['a', 'b', '|', 'c']);
  });

  it('never mutates its input', () => {
    const before = JSON.stringify(blocks);
    applyToolCallDisplay({ blocks, mode: 'collapsed' });
    applyToolCallDisplay({ blocks, mode: 'hidden' });
    expect(JSON.stringify(blocks)).toBe(before);
  });
});

describe('applyToolCallDisplay boundaries', () => {
  const ext: MessageBlock<ToolDisplayRow> = { kind: 'ext', name: 'form', slot: 'form', key: 'ext-form' };

  it('collapsed folds across non-tool blocks of the same turn and passes them through in place', () => {
    const blocks = [tools('tools-0', row('t1')), ext, text('a'), tools('tools-3', row('t2'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'collapsed' }))).toEqual(['tools-0:[t1,t2]', 'ext-form', 'a']);
  });

  it('collapsed handles a reply-end before any tools, then opens a fresh group', () => {
    const blocks = [replyEnd(0), tools('tools-1', row('t1')), replyEnd(1), tools('tools-3', row('t2')), tools('tools-4', row('t3'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'collapsed' }))).toEqual(['|', 'tools-1:[t1]', '|', 'tools-3:[t2,t3]']);
  });

  it('hidden keeps a fully failed block under its own key', () => {
    const blocks = [ext, tools('tools-1', row('t1', 'error'), row('t2', 'error'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }))).toEqual(['ext-form', 'tools-1:[t1,t2]']);
  });
});

describe('hidden recovery', () => {
  const failure = tools('failed', row('bad', 'error'));

  it('hides a failure followed by assistant text, but not text before it', () => {
    expect(shape(applyToolCallDisplay({ blocks: [failure, text('answer')], mode: 'hidden' }))).toEqual(['answer']);
    expect(shape(applyToolCallDisplay({ blocks: [text('before'), failure], mode: 'hidden' }))).toEqual(['before', 'failed:[bad]']);
  });

  it('hides a failure followed by a successful tool in a later block', () => {
    expect(shape(applyToolCallDisplay({ blocks: [failure, tools('success', row('ok'))], mode: 'hidden' }))).toEqual([]);
  });

  it('keeps the last failure after an earlier recovery', () => {
    const blocks = [failure, text('recovered'), tools('last', row('bad2', 'error'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }))).toEqual(['recovered', 'last:[bad2]']);
  });

  it('does not count whitespace, reasoning, or a running tool as recovery', () => {
    const blocks: MessageBlock<ToolDisplayRow>[] = [failure, { kind: 'text', text: '  ', key: 'space' },
      { kind: 'thinking', text: 'Trying again', key: 'thought' }, tools('pending', row('pending', 'executing'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }))).toEqual(['failed:[bad]', 'space', 'thought']);
  });

  it('groups multiple unrecovered failure blocks into one disclosure per reply', () => {
    const blocks: MessageBlock<ToolDisplayRow>[] = [failure, { kind: 'ext', name: 'notice', slot: 'notice', key: 'notice' }, tools('last', row('bad2', 'error'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }))).toEqual(['failed:[bad,bad2]', 'notice']);
  });

  it('does not let later replies recover a terminal failure', () => {
    const blocks = [failure, replyEnd(0), text('next reply'), tools('success', row('ok'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }))).toEqual(['failed:[bad]', '|', 'next reply']);
  });

  it('preserves failures in an errored final reply even after text or success', () => {
    const blocks = [failure, text('partial'), tools('success', row('ok'))];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }, { runFailed: true }))).toEqual(['failed:[bad]', 'partial']);
  });

  it('an errored final reply does not change recovered failures in earlier replies', () => {
    const blocks = [failure, text('recovered'), replyEnd(0), tools('last', row('bad2', 'error')), text('partial')];
    expect(shape(applyToolCallDisplay({ blocks, mode: 'hidden' }, { runFailed: true }))).toEqual(['recovered', '|', 'last:[bad2]', 'partial']);
  });
});

describe('toolRowsForDisplay', () => {
  const rows = [row('t1'), row('t2', 'error'), row('t3', 'executing')];

  it('hidden keeps only failed rows; show and collapsed keep all', () => {
    expect(toolRowsForDisplay({ rows, mode: 'hidden' }).map((r) => r.id)).toEqual(['t2']);
    expect(toolRowsForDisplay({ rows, mode: 'collapsed' })).toBe(rows);
    expect(toolRowsForDisplay({ rows, mode: 'show' })).toBe(rows);
  });
});

describe('isFailedToolRow', () => {
  it('is true only for an error status', () => {
    expect(isFailedToolRow({ row: { status: 'error' } })).toBe(true);
    for (const status of ['complete', 'executing', 'inProgress'] as const) expect(isFailedToolRow({ row: { status } })).toBe(false);
  });
});

describe('summarizeToolGroup + toolGroupLabel', () => {
  it('names the newest running tool, humanized', () => {
    const summary = summarizeToolGroup({ rows: [row('t1', 'executing', 'Read'), row('t2'), row('t3', 'executing', 'mcp__jini__search_tools')] });
    expect(summary).toEqual({ kind: 'running', name: 'Search Tools' });
    expect(toolGroupLabel({ summary, t })).toBe('Running Search Tools…');
  });

  it('counts finished tools, singular and plural, and adds the failed count', () => {
    expect(toolGroupLabel({ summary: summarizeToolGroup({ rows: [row('t1')] }), t })).toBe('Used 1 tool');
    expect(toolGroupLabel({ summary: summarizeToolGroup({ rows: [row('t1'), row('t2')] }), t })).toBe('Used 2 tools');
    const failed = summarizeToolGroup({ rows: [row('t1'), row('t2', 'error'), row('t3', 'error')] });
    expect(failed).toEqual({ kind: 'done', count: 3, failed: 2 });
    expect(toolGroupLabel({ summary: failed, t })).toBe('Used 3 tools · 2 failed');
  });
});
