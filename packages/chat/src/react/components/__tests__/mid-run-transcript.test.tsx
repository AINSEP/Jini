import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { acceptedInputUserEvent } from '../../../core/accepted-input.js';
import { translateRunAgentPayload } from '../../../core/run-events/entry.js';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { registerMidRunUserMessageRenderer } from '../MidRunUserMessage.js';
import { MessageRow } from '../MessageRow.js';

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
