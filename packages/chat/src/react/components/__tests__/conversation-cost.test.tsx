import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import { MessageList } from '../MessageList.js';

afterEach(cleanup);

it('renders per-turn costs and running totals identically after a saved-chat reload', () => {
  const messages: ChatMessage[] = [
    { id: 'a', role: 'assistant', agentId: 'claude', content: 'first', runStatus: 'succeeded',
      events: [{ kind: 'usage', cumulativeCostUsd: 2.05, costSessionId: 's' }] },
    { id: 'b', role: 'assistant', agentId: 'claude', content: 'second', runStatus: 'succeeded',
      events: [{ kind: 'usage', cumulativeCostUsd: 2.5, costSessionId: 's', outputTokens: 999 }] },
    { id: 'c', role: 'assistant', agentId: 'pi', content: 'third', runStatus: 'succeeded',
      events: [{ kind: 'usage', costUsd: 0.25 }] },
  ];
  const expected = ['●Done · $2.05 (Total: $2.05)', '●Done · $0.45 (Total: $2.50)', '●Done · $0.25 (Total: $2.75)'];
  const view = render(<MessageList messages={messages} />);
  expect([...view.container.querySelectorAll('.jini-message-usage')].map(row => row.textContent)).toEqual(expected);
  expect(view.container.querySelector('[data-message-id="b"] .jini-message-usage')).toHaveAttribute('title', '999 out');
  view.unmount();
  const reloaded = render(<MessageList messages={JSON.parse(JSON.stringify(messages))} />);
  expect([...reloaded.container.querySelectorAll('.jini-message-usage')].map(row => row.textContent)).toEqual(expected);
});

it('adds unrounded charges before rounding the displayed conversation total', () => {
  const messages: ChatMessage[] = ['a', 'b'].map(id => ({ id, role: 'assistant', content: id,
    events: [{ kind: 'usage', costUsd: 0.004 }] }));
  const view = render(<MessageList messages={messages} />);
  expect([...view.container.querySelectorAll('.jini-message-usage')].map(row => row.textContent)).toEqual([
    '●Done · $0.01 (Total: $0.01)', '●Done · $0.01 (Total: $0.01)',
  ]);
});
