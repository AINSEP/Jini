import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import { conversationUsage } from '../../../core/turn-usage.js';
import { MessageList } from '../MessageList.js';
import { MessageRow } from '../MessageRow.js';

afterEach(cleanup);

it('renders each turn\'s own cost and the running total as of that turn, identically after a saved-chat reload', () => {
  const messages: ChatMessage[] = [
    { id: 'a', role: 'assistant', agentId: 'claude', content: 'first', runStatus: 'succeeded',
      events: [{ kind: 'usage', cumulativeCostUsd: 2.05, costSessionId: 's' }] },
    { id: 'b', role: 'assistant', agentId: 'claude', content: 'second', runStatus: 'succeeded',
      events: [{ kind: 'usage', cumulativeCostUsd: 2.5, costSessionId: 's', outputTokens: 999 }] },
    { id: 'c', role: 'assistant', agentId: 'pi', content: 'third', runStatus: 'succeeded',
      events: [{ kind: 'usage', costUsd: 0.25 }] },
  ];
  const expected = ['●Done · $2.05 · total $2.05', '●Done · $0.45 · total $2.50', '●Done · $0.25 · total $2.75'];
  const view = render(<MessageList messages={messages} />);
  expect([...view.container.querySelectorAll('.jini-message-usage')].map(row => row.textContent)).toEqual(expected);
  expect(view.container.querySelector('[data-message-id="b"] .jini-message-usage')).toHaveAttribute('title', '999 output tokens');
  view.unmount();
  const reloaded = render(<MessageList messages={JSON.parse(JSON.stringify(messages))} />);
  expect([...reloaded.container.querySelectorAll('.jini-message-usage')].map(row => row.textContent)).toEqual(expected);
});

it('adds unrounded charges before rounding the displayed conversation total', () => {
  const messages: ChatMessage[] = ['a', 'b'].map(id => ({ id, role: 'assistant', content: id,
    events: [{ kind: 'usage', costUsd: 0.004 }] }));
  const usage = conversationUsage({ messages });
  const view = render(<>{messages.map(message => <MessageRow key={message.id} message={message} usageSummary={usage.get(message.id)!} />)}</>);
  expect([...view.container.querySelectorAll('.jini-message-usage')].map(row => row.textContent)).toEqual([
    '●Done · $0.01 · total $0.01', '●Done · $0.01 · total $0.01',
  ]);
});

it('keeps each finished turn\'s Done line under its own reply while the next turn runs its tools, with frozen per-turn totals', () => {
  const running: ChatMessage = { id: 'a3', role: 'assistant', content: 'Looking.', runStatus: 'running', events: [
    { kind: 'usage', costUsd: 0.1 }, { kind: 'text', text: 'Looking.' }, { kind: 'tool_use', id: 'live', name: 'Bash', input: { command: 'ls' } },
  ] };
  const messages: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'first' },
    { id: 'a1', role: 'assistant', content: 'one', runStatus: 'succeeded', events: [{ kind: 'text', text: 'one' }, { kind: 'usage', costUsd: 0.39, durationMs: 16_000 }] },
    { id: 'u2', role: 'user', content: 'second' },
    { id: 'a2', role: 'assistant', content: 'two', runStatus: 'succeeded', events: [{ kind: 'text', text: 'two' }, { kind: 'usage', costUsd: 3.56, durationMs: 3_000 }] },
    { id: 'u3', role: 'user', content: 'third' },
    running,
  ];
  const view = render(<MessageList messages={messages} isStreaming />);
  const line = (id: string) => view.container.querySelector(`[data-message-id="${id}"] .jini-message-usage`);
  expect(line('a1')?.textContent).toBe('●Done · 16s · $0.39 · total $0.39');
  expect(line('a2')?.textContent).toBe('●Done · 3s · $3.56 · total $3.95');
  expect(line('a3')).toBeNull();
  const liveTools = view.container.querySelector('[data-message-id="a3"] .jini-message-tools')!;
  expect(liveTools.textContent).toContain('Bash');
  // Every Done line sits under its own reply, above the next user prompt, never after the live tool rows.
  for (const [id, next] of [['a1', 'u2'], ['a2', 'u3']] as const) {
    const own = line(id)!;
    expect(view.container.querySelector(`[data-message-id="${id}"] .jini-message-content`)!.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(own.compareDocumentPosition(view.container.querySelector(`[data-message-id="${next}"]`)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(own.compareDocumentPosition(liveTools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  view.rerender(<MessageList messages={[...messages.slice(0, -1), { ...running, runStatus: 'succeeded' }]} />);
  expect(line('a1')?.textContent).toBe('●Done · 16s · $0.39 · total $0.39');
  expect(line('a2')?.textContent).toBe('●Done · 3s · $3.56 · total $3.95');
  expect(line('a3')?.textContent).toBe('●Done · $0.10 · total $4.05');
});

it('leaves the running total off when the list switches it off', () => {
  const messages: ChatMessage[] = [{ id: 'a', role: 'assistant', content: 'a', runStatus: 'succeeded', events: [{ kind: 'usage', costUsd: 0.25 }] }];
  const view = render(<MessageList messages={messages} showUsageTotal={false} />);
  expect(view.container.querySelector('.jini-message-usage')?.textContent).toBe('●Done · $0.25');
});

it('renders tokens-only turns with elapsed time and the known total, keeping the actions class in sync', () => {
  const messages: ChatMessage[] = [
    { id: 'paid', role: 'assistant', content: 'First', events: [{ kind: 'usage', costUsd: 0.93 }] },
    { id: 'timed', role: 'assistant', content: 'Finished', runStatus: 'succeeded', startedAt: 1_000, endedAt: 32_525,
      events: [{ kind: 'usage', inputTokens: 17_035, outputTokens: 93 }] },
    { id: 'untimed', role: 'assistant', content: 'Finished', runStatus: 'succeeded',
      events: [{ kind: 'usage', outputTokens: 93 }] },
  ];
  const view = render(<MessageList messages={messages} />);
  const timed = view.container.querySelector('[data-message-id="timed"]')!;
  const untimed = view.container.querySelector('[data-message-id="untimed"]')!;
  expect(timed.querySelector('.jini-message-usage')?.textContent).toBe('●Done · 32s · total $0.93');
  expect(untimed.querySelector('.jini-message-usage')?.textContent).toBe('●Done · total $0.93');
  expect(untimed).toHaveClass('jini-message-assistant--usage-actions');

  view.rerender(<MessageList messages={messages} showUsageTotal={false} />);
  expect(timed.querySelector('.jini-message-usage')?.textContent).toBe('●Done · 32s');
  expect(timed).toHaveClass('jini-message-assistant--usage-actions');
  expect(untimed.querySelector('.jini-message-usage')).toBeNull();
  expect(untimed).not.toHaveClass('jini-message-assistant--usage-actions');
});
