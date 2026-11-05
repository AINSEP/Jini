import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { acceptedInputUserEvent } from '../../../core/accepted-input.js';
import { translateRunAgentPayload } from '../../../core/run-events/entry.js';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { registerMidRunUserMessageRenderer } from '../MidRunUserMessage.js';
import { MessageRow } from '../MessageRow.js';
import { MessageList } from '../MessageList.js';
import { ChatPane } from '../../features/chat-pane/components/ChatPane.js';
import { createFakeChatTransport } from '../../hooks/testing/fake-transport.js';

afterEach(() => clearExtEventRenderers());
const receipt = (deliveryState: 'queued' | 'consumed') => translateRunAgentPayload({
  payload: { type: 'user_message', id: 'wire', text: 'Check the footer', deliveryState },
})!;

it('keeps the emitted queued state visible until the reading step consumes it, including a stream disconnect', () => {
  const queued = receipt('queued');
  const message: ChatMessage = { id: 'run', role: 'assistant', content: '', events: [queued], runStatus: 'running' };
  const view = render(<MessageRow message={message} runStreaming />);
  expect(screen.getByText('Queued — read after the current step')).toBeInTheDocument();
  view.rerender(<MessageRow message={message} runStreaming={false} />);
  expect(screen.getByText('Queued — read after the current step')).toBeInTheDocument();
  view.rerender(<MessageRow message={{ ...message, events: [queued, receipt('consumed'), { kind: 'text', text: 'Checking it.' }], content: 'Checking it.' }} runStreaming />);
  expect(screen.queryByText('Queued — read after the current step')).toBeNull();
  expect(view.container.querySelectorAll('.jini-message-user')).toHaveLength(1);
});

it.each([false, true])('keeps a late receipt at send time as an ordinary transcript row (registered renderer: %s)', registered => {
  if (registered) registerMidRunUserMessageRenderer();
  const optimistic = acceptedInputUserEvent({ input: { id: 'local', text: 'Check the footer', deliveryState: 'queued' } });
  const events: AgentEvent[] = [
    { kind: 'text', text: 'Initial work.' }, optimistic,
    { kind: 'text', text: 'Footer checked.' }, receipt('queued'), receipt('consumed'),
  ];
  const view = render(<div className="jini-message-list"><MessageRow message={{
    id: 'run', role: 'assistant', content: 'Initial work.\n\nFooter checked.', events, runStatus: 'succeeded',
  }} /></div>);
  const rows = [...view.container.querySelector('.jini-message-list')!.children];
  expect(rows.map(row => row.classList.contains('jini-message-user'))).toEqual([false, true, false]);
  expect(rows[0]).toHaveTextContent('Initial work.');
  expect(rows[1]).toHaveTextContent('Check the footer');
  expect(rows[2]).toHaveTextContent('Footer checked.');
  expect(rows[1]).not.toHaveClass('jini-message-user--mid-run');
  expect(rows[1]!.closest('.jini-message-ext-events')).toBeNull();
  expect(rows[1]!.closest('.jini-message-assistant')).toBeNull();
});

it('does not leave an empty assistant row below a final mid-run bubble after completion', () => {
  const events: AgentEvent[] = [{ kind: 'text', text: 'Earlier work.' }, receipt('queued')];
  const view = render(<div className="jini-message-list"><MessageRow message={{
    id: 'run', role: 'assistant', content: 'Earlier work.', events, runStatus: 'succeeded',
  }} /></div>);
  const list = view.container.querySelector('.jini-message-list')!;
  expect(list.children).toHaveLength(2);
  expect(list.lastElementChild).toHaveClass('jini-message-user');
});

// The server checkpoint and queued fallback carry the same accepted input, with different row ids.
it.each(['queued', 'consumed'] as const)('renders one mid-run bubble across event and user rows, live and after reload (%s)', deliveryState => {
  const input = { id: 'wire', text: 'Check the footer', deliveryState, aliases: ['local'] };
  const messages: ChatMessage[] = [
    { id: 'original', role: 'user', content: 'Start' },
    { id: 'old-run', role: 'assistant', content: 'Initial work.', runStatus: 'canceled', events: [
      { kind: 'text', text: 'Initial work.' }, receipt('queued'), receipt(deliveryState),
    ] },
    { id: 'fallback-row', role: 'user', content: input.text, events: [acceptedInputUserEvent({ input }, { receipt: 'accepted' })] },
    { id: 'new-run', role: 'assistant', content: '', runStatus: 'running', runId: 'run-2' },
  ];
  const view = render(<MessageList messages={messages} isStreaming />);
  expect(screen.getAllByText(input.text)).toHaveLength(1);
  expect(view.container.querySelectorAll('.jini-message-user')).toHaveLength(2);
  view.unmount();
  const restored = render(<MessageList messages={JSON.parse(JSON.stringify(messages))} isStreaming />);
  expect(screen.getAllByText(input.text)).toHaveLength(1);
  expect(restored.container.querySelectorAll('.jini-message-user')).toHaveLength(2);
});

it.each(['button', 'shortcut'] as const)('one %s send is one bubble during a capable run and after reload, without a stop or fallback run', async method => {
  const transport = createFakeChatTransport();
  let saved: ChatMessage[] = [];
  const agents = [{ id: 'assistant', name: 'Assistant', available: true }];
  const view = render(<ChatPane transport={transport} agents={agents}
    deliverMidRunMessage={async () => ({ delivery: 'delivered', id: 'publish-input' })}
    onMessagesChange={messages => { saved = messages; }} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Start the work' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  act(() => transport.emit({ kind: 'text', text: 'Working on it.' }));
  const text = 'can you publish this first?';
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => {
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    else fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter', metaKey: true });
  });
  expect(screen.getAllByText(text)).toHaveLength(1);
  expect(screen.getByText('Queued — read after the current step')).toBeVisible();
  expect(transport.stoppedRunIds).toEqual([]);
  expect(transport.calls).toHaveLength(1);
  act(() => transport.emit({ kind: 'ext', name: 'user_message', data: {
    id: 'publish-input', text, deliveryState: 'consumed',
  } }));
  expect(screen.queryByText('Queued — read after the current step')).toBeNull();
  expect(screen.getAllByText(text)).toHaveLength(1);
  view.unmount();
  render(<ChatPane transport={transport} agents={agents} initialMessages={JSON.parse(JSON.stringify(saved))} />);
  await waitFor(() => expect(transport.reattachCalls).toHaveLength(1));
  expect(screen.getAllByText(text)).toHaveLength(1);
  expect(screen.queryByText('Sending…')).toBeNull();
  expect(transport.calls).toHaveLength(1);
  expect(transport.stoppedRunIds).toEqual([]);
});
