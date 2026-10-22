import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';

const messages: ChatMessage[] = [
  { id: 'a', role: 'assistant', content: 'first', runStatus: 'succeeded', events: [{ kind: 'usage', costUsd: 0.25 }] },
  { id: 'b', role: 'assistant', content: 'second', runStatus: 'succeeded', events: [{ kind: 'usage', costUsd: 0.5 }] },
];

it('keeps default usage and per-message prefix totals, and respects explicit display switches', () => {
  const { container, rerender } = render(<MessageList messages={messages} />);
  expect([...container.querySelectorAll('.jini-message-usage')].map(node => node.textContent)).toEqual(['●Done · $0.25 · total $0.25', '●Done · $0.50 · total $0.75']);
  rerender(<MessageList messages={messages} showUsageTotal={false} />);
  expect([...container.querySelectorAll('.jini-message-usage')].map(node => node.textContent)).toEqual(['●Done · $0.25', '●Done · $0.50']);
  rerender(<MessageList messages={messages} showUsageLine={false} />);
  expect(container.querySelector('.jini-message-usage')).toBeNull();
});

it.each(['succeeded', 'failed', 'canceled'] as const)('never streams the last terminal %s run', runStatus => {
  const { container } = render(<MessageList messages={[{ id: 'a', role: 'assistant', content: '', runStatus, events: [{ kind: 'tool_use', id: 'tool', name: 'Bash', input: {} }] }]} isStreaming />);
  expect(screen.queryByTitle('Running')).toBeNull();
  expect(container.querySelector('[data-message-id="a"]')).not.toBeNull();
});

it('defaults an empty list to no queued row, then puts a cancellable queued message last without mutating messages', () => {
  const initial: ChatMessage[] = [];
  const onCancel = vi.fn<() => void>();
  const onScrolled = vi.fn<() => void>();
  const { container, rerender } = render(<MessageList messages={initial} onScrolled={onScrolled} />);
  expect(container.querySelector('.jini-message-list')?.children).toHaveLength(0);
  expect(onScrolled).not.toHaveBeenCalled();
  rerender(<MessageList messages={initial} pendingPrompt={{ text: 'Next', onCancel }} scrollIntent onScrolled={onScrolled} />);
  expect(screen.getByRole('status')).toHaveTextContent('Next');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledWith();
  expect(onScrolled).toHaveBeenCalledTimes(1);
  expect(onScrolled).toHaveBeenCalledWith();
  expect(initial).toEqual([]);
  expect(screen.getByRole('status')).not.toHaveAttribute('data-message-id');
});
