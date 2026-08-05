import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../core/index.js';
import { interleaveMessageBlocks } from '../message-blocks.js';

/**
 * @file Ordering is the visible feature; the refusal paths are the safety net, so they get the
 * heavier coverage. A wrong `null` costs the interleaved layout. A wrong reconstruction silently
 * drops or duplicates the assistant's actual words.
 */

interface Row {
  id: string;
}

const text = (t: string): AgentEvent => ({ kind: 'text', text: t });
const toolUse = (id: string, name = 'tool'): AgentEvent => ({ kind: 'tool_use', id, name, input: {} });
const toolResult = (toolUseId: string): AgentEvent => ({ kind: 'tool_result', toolUseId, content: 'ok', isError: false });

/** `content` as `useConversation` builds it: every text event concatenated, nothing else. */
function contentOf(events: readonly AgentEvent[]): string {
  return events.reduce((acc, ev) => (ev.kind === 'text' ? acc + ev.text : acc), '');
}

describe('interleaveMessageBlocks', () => {
  it('places tool cards where they occurred, splitting the text around them', () => {
    const events = [text('Looking for a tool. '), toolUse('t1'), toolResult('t1'), text('Done — it is English now.')];
    const rows: Row[] = [{ id: 't1' }];

    const blocks = interleaveMessageBlocks(events, contentOf(events), rows);

    expect(blocks).not.toBeNull();
    expect(blocks!.map((b) => b.kind)).toEqual(['text', 'tools', 'text']);
    expect(blocks![0]).toMatchObject({ kind: 'text', text: 'Looking for a tool. ' });
    expect(blocks![2]).toMatchObject({ kind: 'text', text: 'Done — it is English now.' });
  });

  it('coalesces consecutive tool calls into ONE group so a run of calls stays one visual block', () => {
    const events = [
      text('Working.'),
      toolUse('t1'),
      toolResult('t1'),
      toolUse('t2'),
      toolResult('t2'),
      toolUse('t3'),
      toolResult('t3'),
      text('Finished.'),
    ];
    const rows: Row[] = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];

    const blocks = interleaveMessageBlocks(events, contentOf(events), rows)!;

    expect(blocks.map((b) => b.kind)).toEqual(['text', 'tools', 'text']);
    const tools = blocks[1] as { kind: 'tools'; rows: readonly Row[] };
    expect(tools.rows.map((r) => r.id)).toEqual(['t1', 't2', 't3']);
  });

  it('separates tool groups that have text between them', () => {
    const events = [toolUse('t1'), toolResult('t1'), text('Interim thought.'), toolUse('t2'), toolResult('t2')];
    const rows: Row[] = [{ id: 't1' }, { id: 't2' }];

    const blocks = interleaveMessageBlocks(events, contentOf(events), rows)!;

    expect(blocks.map((b) => b.kind)).toEqual(['tools', 'text', 'tools']);
  });

  it('handles a message that opens with a tool call and has no leading text', () => {
    const events = [toolUse('t1'), toolResult('t1'), text('Result explained.')];
    const blocks = interleaveMessageBlocks(events, contentOf(events), [{ id: 't1' }])!;

    expect(blocks.map((b) => b.kind)).toEqual(['tools', 'text']);
  });

  it('preserves every character of the original content across the split', () => {
    const events = [text('alpha '), toolUse('t1'), text('beta '), toolUse('t2'), text('gamma')];
    const content = contentOf(events);

    const blocks = interleaveMessageBlocks(events, content, [{ id: 't1' }, { id: 't2' }])!;
    const rejoined = blocks
      .filter((b): b is { kind: 'text'; text: string; key: string } => b.kind === 'text')
      .map((b) => b.text)
      .join('');

    expect(rejoined).toBe(content);
  });

  // --- refusal paths ---------------------------------------------------------

  it('refuses when the text events do not reproduce content byte for byte', () => {
    const events = [text('from events'), toolUse('t1')];
    // A message whose content was assembled some other way, or persisted before events existed.
    expect(interleaveMessageBlocks(events, 'a completely different stored content', [{ id: 't1' }])).toBeNull();
  });

  it('refuses on a whitespace-only difference rather than accepting a close-enough match', () => {
    const events = [text('hello '), toolUse('t1')];
    expect(interleaveMessageBlocks(events, 'hello', [{ id: 't1' }])).toBeNull();
  });

  it('refuses when a row never gets placed, rather than rendering a message missing its card', () => {
    // `t2` is in the timeline but has no `tool_use` in the event stream.
    const events = [text('hi'), toolUse('t1'), toolResult('t1')];
    expect(interleaveMessageBlocks(events, contentOf(events), [{ id: 't1' }, { id: 't2' }])).toBeNull();
  });

  it('skips a tool_use the timeline deduped away, and still succeeds when all rows are placed', () => {
    // `t1` appears twice on the wire; `useToolTimeline` dedupes to one row.
    const events = [text('a'), toolUse('t1'), toolUse('t1'), text('b')];
    const blocks = interleaveMessageBlocks(events, contentOf(events), [{ id: 't1' }])!;

    expect(blocks.map((b) => b.kind)).toEqual(['text', 'tools', 'text']);
    expect((blocks[1] as { rows: readonly Row[] }).rows).toHaveLength(1);
  });

  it('returns null when there is nothing to interleave, so the caller keeps its flat path', () => {
    expect(interleaveMessageBlocks(undefined, 'text', [{ id: 't1' }])).toBeNull();
    expect(interleaveMessageBlocks([], '', [{ id: 't1' }])).toBeNull();
    expect(interleaveMessageBlocks([text('just prose')], 'just prose', [])).toBeNull();
  });

  it('ignores non-text, non-tool events when reconstructing', () => {
    const events: AgentEvent[] = [
      { kind: 'status', label: 'starting' },
      text('a'),
      { kind: 'thinking', text: 'hmm' },
      toolUse('t1'),
      { kind: 'usage', inputTokens: 1, outputTokens: 2 },
      text('b'),
    ];

    const blocks = interleaveMessageBlocks(events, 'ab', [{ id: 't1' }])!;

    expect(blocks.map((b) => b.kind)).toEqual(['text', 'tools', 'text']);
    expect(blocks[0]).toMatchObject({ text: 'a' });
    expect(blocks[2]).toMatchObject({ text: 'b' });
  });
});
