import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { assistantContentFromEvents } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';
import { MessageRow } from '../MessageRow.js';

/**
 * @file MessageRow's display props (2026-10-11): `toolCallDisplay`, `showUsageLine`, `showThinking`.
 * Real components and real tool cards; the only inputs are messages.
 */

const use = (id: string, name: string): AgentEvent => ({ kind: 'tool_use', id, name, input: {} });
const result = (toolUseId: string, isError = false): AgentEvent => ({ kind: 'tool_result', toolUseId, content: isError ? 'boom' : 'ok', isError });

function assistant(id: string, events: AgentEvent[], runStatus: NonNullable<ChatMessage['runStatus']> = 'succeeded'): ChatMessage {
  return { id, role: 'assistant', content: assistantContentFromEvents({ events }), runStatus, events };
}

const turn = assistant('turn', [
  { kind: 'text', text: 'Looking. ' },
  use('t1', 'alpha'), result('t1'),
  { kind: 'text', text: 'Now writing. ' },
  use('t2', 'beta'), result('t2', true),
  use('t3', 'gamma'), result('t3'),
  { kind: 'text', text: 'Done.' },
  { kind: 'usage', costUsd: 0.25, durationMs: 2_000 },
]);

/** Tool card titles currently in the DOM, in order. */
function cardTitles(): string[] {
  return [...document.querySelectorAll('.jini-message-tools .op-card')].map((card) => card.textContent ?? '');
}

describe('MessageRow toolCallDisplay', () => {
  it('show (default) renders every card where it happened', () => {
    render(<MessageRow message={turn} runSucceeded />);
    expect(cardTitles()).toHaveLength(3);
    expect(document.querySelector('.jini-tool-group')).toBeNull();
  });

  it('collapsed folds the turn into one line that opens and closes on click', async () => {
    const user = userEvent.setup();
    render(<MessageRow message={turn} runSucceeded toolCallDisplay="collapsed" />);
    const toggles = screen.getAllByRole('button', { name: /Used 3 tools/ });
    expect(toggles).toHaveLength(1);
    expect(toggles[0]).toHaveTextContent('Used 3 tools · 1 failed');
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(cardTitles()).toHaveLength(0);
    // The text on both sides of the folded calls still reads in order.
    expect(screen.getByText('Now writing.')).toBeInTheDocument();

    await user.click(toggles[0]!);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    expect(cardTitles()).toHaveLength(3);

    await user.click(toggles[0]!);
    expect(cardTitles()).toHaveLength(0);
  });

  it('collapsed names the running tool live instead of a count', () => {
    const running = assistant('running', [{ kind: 'text', text: 'Working. ' }, use('t1', 'alpha'), result('t1'), use('t2', 'gamma_check')], 'running');
    render(<MessageRow message={running} runStreaming toolCallDisplay="collapsed" />);
    expect(screen.getByRole('button', { name: 'Running Gamma Check…' })).toBeInTheDocument();
  });

  it('hidden shows no cards except the failed one', () => {
    render(<MessageRow message={turn} runSucceeded toolCallDisplay="hidden" />);
    const cards = cardTitles();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toContain('beta');
    expect(document.querySelector('.jini-tool-group')).toBeNull();
  });

  it('hidden keeps a failed tool in the flat layout too', () => {
    // Content that does not match the events forces the flat fallback.
    const flat: ChatMessage = { ...turn, id: 'flat', content: 'Rewritten by the host.' };
    render(<MessageRow message={flat} runSucceeded toolCallDisplay="hidden" />);
    expect(cardTitles()).toHaveLength(1);
  });
});

describe('MessageRow showUsageLine', () => {
  it('shows the Done line by default and hides it when off', () => {
    const view = render(<MessageRow message={turn} runSucceeded />);
    expect(document.querySelector('.jini-message-usage')).not.toBeNull();
    view.rerender(<MessageRow message={turn} runSucceeded showUsageLine={false} />);
    expect(document.querySelector('.jini-message-usage')).toBeNull();
  });
});

describe('MessageRow showThinking', () => {
  const thoughtful = assistant('thought', [{ kind: 'thinking', text: 'Weighing the options.' }, { kind: 'text', text: 'Here is the answer.' }]);

  it('hides reasoning by default and shows it folded when on', () => {
    const view = render(<MessageRow message={thoughtful} />);
    expect(screen.queryByText('Weighing the options.')).toBeNull();
    view.rerender(<MessageRow message={thoughtful} showThinking />);
    const details = document.querySelector('details.jini-message-thinking');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent('Thinking');
    expect(details).toHaveTextContent('Weighing the options.');
    expect(screen.getByText('Here is the answer.')).toBeInTheDocument();
  });
});

describe('MessageList display props', () => {
  it('passes every display prop to its rows', () => {
    render(<MessageList messages={[turn]} toolCallDisplay="hidden" showUsageLine={false} showThinking />);
    expect(cardTitles()).toHaveLength(1);
    expect(document.querySelector('.jini-message-usage')).toBeNull();
  });
});
