import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { assistantContentFromEvents } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';
import { I18nContext } from '../../hooks/context.js';
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
  it('separates the failure suffix from the tool count for independent styling', () => {
    const { container } = render(<MessageRow message={turn} runSucceeded toolCallDisplay="collapsed" />);
    expect(container.querySelector('.jini-tool-group__label')).toHaveTextContent(/^Used 3 tools$/);
    expect(container.querySelector('.jini-tool-group__failed')).toHaveTextContent('· 1 failed');
    expect(screen.getByRole('button', { name: 'Used 3 tools · 1 failed' })).toHaveAttribute('aria-expanded', 'false');
  });

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

  it('hidden hides the recovered failure along with successful calls', () => {
    render(<MessageRow message={turn} runSucceeded toolCallDisplay="hidden" />);
    expect(cardTitles()).toHaveLength(0);
    expect(screen.queryByText('A step failed')).toBeNull();
    expect(screen.getByText('Done.')).toBeInTheDocument();
  });

  it('hidden shows one compact terminal failure with a working disclosure of the existing cards', async () => {
    const user = userEvent.setup();
    const terminal = assistant('terminal', [use('t1', 'alpha'), result('t1', true), use('t2', 'beta'), result('t2', true)]);
    render(<MessageRow message={terminal} runSucceeded toolCallDisplay="hidden" />);
    expect(screen.getAllByText('A step failed')).toHaveLength(1);
    const show = screen.getByRole('button', { name: 'Show' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(cardTitles()).toHaveLength(0);
    await user.click(show);
    expect(show).toHaveAttribute('aria-expanded', 'true');
    expect(cardTitles()).toHaveLength(2);
    expect(cardTitles()[0]).toContain('alpha');
    expect(cardTitles()[1]).toContain('beta');
    // Show reveals the existing cards; each card's own disclosure opens its result.
    for (const name of ['alpha', 'beta']) {
      const card = screen.getByRole('button', { name: new RegExp(name) });
      expect(card).toHaveAttribute('aria-expanded', 'false');
      await user.click(card);
      expect(card).toHaveAttribute('aria-expanded', 'true');
    }
    expect(screen.getAllByText('boom')).toHaveLength(2);
    for (const error of screen.getAllByText('boom')) expect(error).toBeVisible();
    await user.click(show);
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(cardTitles()).toHaveLength(0);
  });

  it.each(['text', 'tool'] as const)('hidden keeps a streaming failure until later %s proves recovery', (recovery) => {
    const events = [use('t1', 'alpha'), result('t1', true)];
    const view = render(<MessageRow message={assistant('stream', events, 'running')} runStreaming toolCallDisplay="hidden" />);
    expect(screen.getByText('A step failed')).toBeInTheDocument();
    const later: AgentEvent[] = recovery === 'text' ? [{ kind: 'text', text: 'Recovered.' }] : [use('t2', 'beta'), result('t2')];
    view.rerender(<MessageRow message={assistant('stream', [...events, ...later], 'running')} runStreaming toolCallDisplay="hidden" />);
    expect(screen.queryByText('A step failed')).toBeNull();
    expect(cardTitles()).toHaveLength(0);
  });

  it('hidden preserves an errored run failure despite partial assistant text', () => {
    const failed = assistant('failed', [use('t1', 'alpha'), result('t1', true), { kind: 'text', text: 'Partial answer.' }], 'failed');
    render(<MessageRow message={failed} toolCallDisplay="hidden" />);
    expect(screen.getByText('A step failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('hidden suppresses a failure followed by a successful tool in the flat layout too', () => {
    const flat: ChatMessage = { ...turn, id: 'flat', content: 'Rewritten by the host.' };
    render(<MessageRow message={flat} runSucceeded toolCallDisplay="hidden" />);
    expect(cardTitles()).toHaveLength(0);
    expect(screen.queryByText('A step failed')).toBeNull();
  });

  it('hidden keeps an unrecovered failure compact when text ordering is unavailable', async () => {
    const user = userEvent.setup();
    const flat = { ...assistant('flat', [use('t1', 'alpha'), result('t1', true)]), content: 'Host text.' };
    render(<MessageRow message={flat} runSucceeded toolCallDisplay="hidden" />);
    expect(screen.getByText('A step failed')).toBeInTheDocument();
    expect(cardTitles()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(cardTitles()).toHaveLength(1);
    const card = screen.getByRole('button', { name: /alpha/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    await user.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('boom')).toBeVisible();
  });

  it.each([false, true])('hidden respects reply boundaries even with host-rewritten text (%s)', async (rewrite) => {
    const user = userEvent.setup();
    const replies = assistant('replies', [
      use('t1', 'alpha'), result('t1', true),
      { kind: 'ext', name: 'user_message', data: { id: 'm1', text: 'Continue.' } },
      use('t2', 'beta'), result('t2'), { kind: 'text', text: 'Second reply recovered.' },
      { kind: 'ext', name: 'user_message', data: { id: 'm2', text: 'Again.' } },
      use('t3', 'gamma'), result('t3', true),
    ]);
    render(<MessageRow message={rewrite ? { ...replies, content: 'Host text.' } : replies} runSucceeded toolCallDisplay="hidden" />);
    expect(screen.getAllByText('A step failed')).toHaveLength(2);
    const shows = screen.getAllByRole('button', { name: 'Show' });
    expect(cardTitles()).toHaveLength(0);
    await user.click(shows[0]!);
    expect(cardTitles()).toHaveLength(1);
    expect(cardTitles()[0]).toContain('alpha');
    await user.click(shows[1]!);
    expect(cardTitles()).toHaveLength(2);
    expect(cardTitles()[1]).toContain('gamma');
  });

  it('hidden uses later event text to prove recovery when the host rewrites content', () => {
    const message = { ...assistant('rewritten', [use('t1', 'alpha'), result('t1', true), { kind: 'text', text: 'Recovered.' }]), content: 'Host text.' };
    render(<MessageRow message={message} runSucceeded toolCallDisplay="hidden" />);
    expect(screen.queryByText('A step failed')).toBeNull();
    expect(cardTitles()).toHaveLength(0);
    expect(screen.getByText('Host text.')).toBeInTheDocument();
  });

  it('hidden localizes the failure label and disclosure with the host adapter', () => {
    const dictionary: Record<string, string> = { 'A step failed': 'Une étape a échoué', Show: 'Afficher' };
    render(<I18nContext.Provider value={{ locale: 'fr', t: (key) => dictionary[key] ?? key }}>
      <MessageRow message={assistant('translated', [use('t1', 'alpha'), result('t1', true)])} toolCallDisplay="hidden" />
    </I18nContext.Provider>);
    expect(screen.getByText('Une étape a échoué')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Afficher' })).toHaveAttribute('aria-expanded', 'false');
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
    expect(cardTitles()).toHaveLength(0);
    expect(screen.queryByText('A step failed')).toBeNull();
    expect(document.querySelector('.jini-message-usage')).toBeNull();
  });
});
