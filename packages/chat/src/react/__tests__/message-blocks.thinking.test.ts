import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../core/index.js';
import { assistantContentFromEvents } from '../../core/index.js';
import { interleaveMessageBlocks } from '../message-blocks.js';

/**
 * @file `includeThinking` (2026-10-11): reasoning appears where it happened, only when asked for, and
 * never changes the lossless-text check or the default layout.
 */

const text = (t: string): AgentEvent => ({ kind: 'text', text: t });
const thinking = (t: string): AgentEvent => ({ kind: 'thinking', text: t });
const toolUse = (id: string): AgentEvent => ({ kind: 'tool_use', id, name: 'tool', input: {} });
const toolResult = (toolUseId: string): AgentEvent => ({ kind: 'tool_result', toolUseId, content: 'ok', isError: false });

const contentOf = (events: AgentEvent[]) => assistantContentFromEvents({ events });

describe('interleaveMessageBlocks includeThinking', () => {
  const events = [thinking('Plan: '), thinking('look it up.'), text('Checking. '), toolUse('t1'), toolResult('t1'), thinking('Got it.'), text('Done.')];

  it('emits thinking blocks in place, joining back-to-back thinking events', () => {
    const blocks = interleaveMessageBlocks({ events, content: contentOf(events), rows: [{ id: 't1' }] }, { includeThinking: true });
    expect(blocks?.map((b) => (b.kind === 'thinking' || b.kind === 'text' ? `${b.kind}:${b.text.trim()}` : b.kind))).toEqual([
      'thinking:Plan: look it up.', 'text:Checking.', 'tools', 'thinking:Got it.', 'text:Done.',
    ]);
  });

  it('skips thinking by default, exactly as before the option existed', () => {
    const blocks = interleaveMessageBlocks({ events, content: contentOf(events), rows: [{ id: 't1' }] });
    expect(blocks?.some((b) => b.kind === 'thinking')).toBe(false);
  });

  it('interleaves a tool-less message that has thinking, but only when asked', () => {
    const plain = [thinking('Hmm.'), text('Answer.')];
    expect(interleaveMessageBlocks({ events: plain, content: contentOf(plain), rows: [] })).toBeNull();
    expect(interleaveMessageBlocks({ events: plain, content: contentOf(plain), rows: [] }, { includeThinking: true })?.map((b) => b.kind)).toEqual(['thinking', 'text']);
  });

  it('still refuses blank-only thinking with nothing else to interleave', () => {
    const blank = [thinking('  '), text('Answer.')];
    expect(interleaveMessageBlocks({ events: blank, content: contentOf(blank), rows: [] }, { includeThinking: true })).toBeNull();
  });
  it('does not join thinking across a tool group, and starts a new tools group after thinking', () => {
    const evs = [toolUse('t1'), thinking('a'), toolUse('t2'), thinking('b')];
    const blocks = interleaveMessageBlocks({ events: evs, content: '', rows: [{ id: 't1' }, { id: 't2' }] }, { includeThinking: true });
    expect(blocks).toEqual([
      { kind: 'tools', rows: [{ id: 't1' }], key: 'tools-0' },
      { kind: 'thinking', text: 'a', key: 'thinking-1' },
      { kind: 'tools', rows: [{ id: 't2' }], key: 'tools-2' },
      { kind: 'thinking', text: 'b', key: 'thinking-3' },
    ]);
  });

  it('emits blank thinking as a block once something else makes the message interleavable', () => {
    const evs = [thinking('  '), toolUse('t1')];
    const blocks = interleaveMessageBlocks({ events: evs, content: '', rows: [{ id: 't1' }] }, { includeThinking: true });
    expect(blocks?.map((b) => b.kind)).toEqual(['thinking', 'tools']);
  });
});
