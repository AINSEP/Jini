import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';

// Counts how often each reply's text is rendered, so a streaming update can prove old rows stay put.
const markdownRenders = vi.hoisted(() => new Map<string, number>());
vi.mock('../Markdown.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Markdown.js')>();
  return { ...actual, Markdown: (props: Parameters<typeof actual.Markdown>[0]) => {
    const text = String(props.children);
    markdownRenders.set(text, (markdownRenders.get(text) ?? 0) + 1);
    return actual.Markdown(props);
  } };
});
const { MessageList } = await import('../MessageList.js');

const oldReply: ChatMessage = { id: 'a1', role: 'assistant', content: 'old reply', runStatus: 'succeeded', events: [
  { kind: 'text', text: 'old reply' },
  { kind: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
] };
const streaming = (text: string): ChatMessage => ({ id: 'a2', role: 'assistant', content: text, runStatus: 'running', events: [{ kind: 'text', text }] });

describe('MessageList while a run streams', () => {
  it('does not re-render an unchanged older reply when the newest reply grows', () => {
    const before: ChatMessage[] = [{ id: 'u1', role: 'user', content: 'q1' }, oldReply, { id: 'u2', role: 'user', content: 'q2' }, streaming('new')];
    const { rerender } = render(<MessageList messages={before} isStreaming />);
    const oldRenders = markdownRenders.get('old reply');
    rerender(<MessageList messages={[...before.slice(0, 3), streaming('new text')]} isStreaming />);
    expect(markdownRenders.get('new text')).toBe(1);
    expect(markdownRenders.get('old reply')).toBe(oldRenders);
  });
});
