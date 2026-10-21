import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpUiHostProps } from '@jini-ai/ui/mcp-ui';
import { MCP_UI_MIME_TYPE } from '@jini-ai/ui/mcp-ui';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { acceptedInputUserEvent } from '../../../core/accepted-input.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { MessageList } from '../MessageList.js';
import { MessageRow } from '../MessageRow.js';
import { registerMcpUiSurfaceRenderer } from '../McpUiSurfaceCard.js';

// The sandbox owns real form controls. Exercise its existing props boundary, with no DOM/HTML access.
vi.mock('@jini-ai/ui/mcp-ui', async original => ({
  ...await original<typeof import('@jini-ai/ui/mcp-ui')>(),
  McpUiHost: ({ onToolCall }: McpUiHostProps) => <div>
    <button onClick={() => { void onToolCall?.({ name: 'answer', arguments: { choice: 'ucla' } }); }}>Choose A26</button>
    <button onClick={() => { void onToolCall?.({ name: 'answer', arguments: { __dismissed: true } }); }}>Decline question</button>
  </div>,
}));

const question = {
  title: 'Which theme should this local site show?',
  singleSelect: { label: 'Theme', options: [{ value: 'ucla', label: 'A26 UCLA' }] },
};
function openEvents(id = 'question'): AgentEvent[] {
  return [
    { kind: 'tool_use', id, name: 'assistant_ask_choice', input: question },
    { kind: 'ext', name: 'mcp-ui', data: {
      type: 'resource', resource: { uri: `ui://questions/${id}`, mimeType: MCP_UI_MIME_TYPE, text: '<form>Theme</form>' },
    } },
  ];
}
function result(answer: unknown, id = 'question'): AgentEvent {
  return { kind: 'tool_result', toolUseId: id, content: JSON.stringify(answer), isError: false };
}
function message(events: AgentEvent[], running = false): ChatMessage {
  return { id: 'assistant', role: 'assistant', content: '', runId: 'run', runStatus: running ? 'running' : 'succeeded', events };
}
function register(onToolCall = vi.fn().mockResolvedValue({ delivered: true })) {
  registerMcpUiSurfaceRenderer({ sandboxProxyUrl: new URL('https://sandbox.example.test/proxy.html'), onToolCall });
  return onToolCall;
}
function bubbles(container: HTMLElement) {
  return [...container.querySelectorAll('.jini-message-user .jini-message-content')].map(node => node.textContent);
}
afterEach(() => clearExtEventRenderers());

describe('answered questions in the transcript', () => {
  it.each([
    { button: 'Choose A26', answer: { submitted: true, choice: 'ucla' }, expected: 'A26 UCLA' },
    { button: 'Decline question', answer: { submitted: false, reason: 'cancelled' }, expected: 'Declined' },
  ])('shows the delivered $button answer, settles once, and survives reload', async ({ button, answer, expected }) => {
    const execute = register();
    const view = render(<MessageRow message={message(openEvents(), true)} runStreaming />);
    await userEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(bubbles(view.container)).toEqual([expected]));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: button })).toBeNull();
    expect(view.container.querySelector('.mcpui-surface-card-closed')).toBeNull();
    expect(view.container.textContent).not.toContain('Waiting for your answer');
    const persisted: AgentEvent[] = JSON.parse(JSON.stringify([...openEvents(), result(answer)]));
    view.rerender(<MessageRow message={message(persisted)} />);
    expect(bubbles(view.container)).toEqual([expected]);
    view.unmount();
    const reloaded = render(<MessageRow message={message(persisted)} />);
    expect(bubbles(reloaded.container)).toEqual([expected]);
    expect(reloaded.container.querySelector('.mcpui-surface-card-closed')).toBeNull();
  });

  it('shows typed answers once during acceptance, receipt replay, completion and reload', () => {
    register();
    const optimistic = acceptedInputUserEvent({ input: { id: 'client', text: 'My custom theme' }, toolUseId: 'question' });
    const view = render(<MessageRow message={message([...openEvents(), optimistic], true)} runStreaming />);
    expect(bubbles(view.container)).toEqual(['My custom theme']);
    expect(screen.queryByRole('button', { name: 'Choose A26' })).toBeNull();
    const receipt = acceptedInputUserEvent({ input: { id: 'server', text: 'My custom theme' }, toolUseId: 'question' }, { receipt: 'accepted' });
    const persisted = [...openEvents(), receipt, result({ submitted: true, freeText: 'My custom theme' })];
    view.rerender(<MessageRow message={message([optimistic, ...persisted])} />);
    expect(bubbles(view.container)).toEqual(['My custom theme']);
    view.unmount();
    const reloaded = render(<MessageRow message={message(JSON.parse(JSON.stringify(persisted)))} />);
    expect(bubbles(reloaded.container)).toEqual(['My custom theme']);
    expect(reloaded.container.querySelector('.mcpui-surface-card-closed')).toBeNull();
  });

  it('replays older typed results without a separately journaled receipt', () => {
    register();
    const view = render(<MessageRow message={message([...openEvents(), result({ submitted: true, freeText: '<b>Keep this literal</b>' })])} />);
    expect(bubbles(view.container)).toEqual(['<b>Keep this literal</b>']);
    expect(view.container.querySelector('.jini-message-user b')).toBeNull();
    expect(view.container.querySelector('.mcpui-surface-card-closed')).toBeNull();
  });

  it('keeps the question interactive after failed delivery', async () => {
    register(vi.fn().mockResolvedValue({ delivered: false }));
    const view = render(<MessageRow message={message(openEvents(), true)} runStreaming />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose A26' }));
    expect(bubbles(view.container)).toEqual([]);
    expect(screen.getByRole('button', { name: 'Choose A26' })).toBeInTheDocument();
  });

  it('keeps a second question open when an earlier question has a receipt', () => {
    register();
    const first = acceptedInputUserEvent({ input: { id: 'answer-1', text: 'A26 UCLA' }, toolUseId: 'first' }, { receipt: 'accepted' });
    const view = render(<MessageRow runStreaming message={message([
      ...openEvents('first'), first, result({ submitted: true, choice: 'ucla' }, 'first'), ...openEvents('second'),
    ], true)} />);
    expect(bubbles(view.container)).toEqual(['A26 UCLA']);
    expect(screen.getAllByRole('button', { name: 'Choose A26' })).toHaveLength(1);
    expect(view.container.textContent).toContain('Waiting for your answer');
  });

  it.each(['succeeded', 'failed', 'canceled'] as const)('closes an unanswered %s run on reload even with a stale streaming prop', (runStatus) => {
    register();
    const persisted = { ...message(openEvents()), runStatus };
    const view = render(<MessageRow message={persisted} runStreaming />);
    expect(screen.queryByRole('button', { name: 'Choose A26' })).toBeNull();
    // MOVE: Terminal failures also announce a run status; the expired-question notice remains unique.
    expect(screen.getByText(`${question.title}: This question expired`)).toHaveAttribute('role', 'status');
    expect(bubbles(view.container)).toEqual([]);
    view.unmount();
    render(<MessageRow message={JSON.parse(JSON.stringify(persisted))} />);
    expect(screen.queryByRole('button', { name: 'Choose A26' })).toBeNull();
    expect(screen.getByText(`${question.title}: This question expired`)).toHaveAttribute('role', 'status');
  });

  it('does not reopen a question without evidence of an active run', () => {
    register();
    const unknownRun: ChatMessage = { id: 'unknown', role: 'assistant', content: '', events: openEvents() };
    render(<MessageRow message={unknownRun} runStreaming />);
    expect(screen.queryByRole('button', { name: 'Choose A26' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('This question expired');
  });

  it('keeps an unanswered question closed when its surface was replayed more than once', () => {
    register();
    const events = openEvents();
    render(<MessageRow message={message([...events, events[1]!])} />);
    expect(screen.queryByRole('button', { name: 'Choose A26' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('This question expired');
  });

  it('closes a question superseded by a later turn while that next turn is streaming', () => {
    register();
    render(<MessageList isStreaming messages={[
      message(openEvents(), true),
      { id: 'next-user', role: 'user', content: 'Continue' },
      { id: 'next-assistant', role: 'assistant', content: 'Continuing', runStatus: 'running' },
    ]} />);
    expect(screen.queryByRole('button', { name: 'Choose A26' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('This question expired');
  });

  it('does not interpret expiry as a user decline', () => {
    register();
    const view = render(<MessageRow message={message([...openEvents(), result({ submitted: false, reason: 'expired' })])} />);
    expect(bubbles(view.container)).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('This question expired');
  });
});
