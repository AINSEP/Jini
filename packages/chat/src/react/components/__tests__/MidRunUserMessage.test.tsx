import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { MessageRow } from '../MessageRow.js';
import { MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, registerMidRunUserMessageRenderer } from '../MidRunUserMessage.js';

describe('registerMidRunUserMessageRenderer', () => {
  afterEach(() => clearExtEventRenderers());

  it.each([false, true])('labels queued relay inputs until their consumption receipt, with renderer registered: %s', registered => {
    if (registered) registerMidRunUserMessageRenderer();
    const message: ChatMessage = { id: 'a', role: 'assistant', content: '', runStatus: 'running', events: [
      { kind: 'ext', name: 'user_message', data: { id: 'relay', text: 'follow up', deliveryState: 'queued',
        inputs: [{ id: 'local', text: 'follow up' }] } },
    ] };
    const { rerender, container } = render(<MessageRow message={message} runStreaming />);
    expect(screen.getByText('Queued — read after the current step')).toBeInTheDocument();
    rerender(<MessageRow message={{ ...message, events: [...message.events!,
      { kind: 'ext', name: 'user_message', data: { id: 'relay', text: 'follow up', deliveryState: 'consumed' } },
    ] }} runStreaming />);
    expect(screen.queryByText('Queued — read after the current step')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.jini-message-user')).toHaveLength(1);
    expect(screen.getByText('follow up')).toBeInTheDocument();
  });

  it('drops the queued label once the run ends without reading the message', () => {
    const message: ChatMessage = { id: 'a', role: 'assistant', content: 'done', runStatus: 'succeeded', events: [
      { kind: 'ext', name: 'user_message', data: { id: 'relay', text: 'follow up', deliveryState: 'queued' } },
    ] };
    render(<MessageRow message={message} />);
    expect(screen.getByText('follow up')).toBeInTheDocument();
    expect(screen.queryByText('Queued — read after the current step')).not.toBeInTheDocument();
  });

  it('renders each message sent mid-run as a user bubble where it arrived inside the running turn', () => {
    registerMidRunUserMessageRenderer();
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runId: 'run-1',
      events: [
        { kind: 'text', text: 'Working on the header.' },
        { kind: 'ext', name: MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, data: { type: 'user_message', id: 'm1', text: 'also fix the footer' } },
        { kind: 'text', text: 'Sure, the footer too.' },
        { kind: 'ext', name: MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, data: { type: 'user_message', id: 'm2', text: 'and the nav' } },
      ],
      runStatus: 'running',
    };
    render(<MessageRow message={message} runStreaming />);

    const bubbles = document.querySelectorAll('.jini-message-user');
    expect([...bubbles].map((bubble) => bubble.textContent)).toEqual(['also fix the footer', 'and the nav']);
    expect(screen.getByText('also fix the footer').closest('.jini-message-user')).not.toBeNull();
  });

  it('renders nothing for an event with no text', () => {
    registerMidRunUserMessageRenderer();
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      runId: 'run-1',
      events: [{ kind: 'ext', name: MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, data: { type: 'user_message', id: 'm1' } }],
      runStatus: 'running',
    };
    render(<MessageRow message={message} runStreaming />);
    expect(document.querySelector('.jini-message-user')).toBeNull();
  });
});

it('displays the separate queued receipts and their own files after one merged live delivery is reconciled', () => {
  const inputs = [
    { id: 'queued-1', text: 'first queued input', attachments: [] },
    { id: 'queued-2', text: 'second queued input', attachments: [{ path: 'attachment:footer', name: 'footer.png', kind: 'image' as const }] },
  ];
  const message: ChatMessage = { id: 'a1', role: 'assistant', content: '', runStatus: 'running', events: [
    { kind: 'ext', name: MID_RUN_USER_MESSAGE_EXT_EVENT_NAME,
      data: { id: 'queued-1', text: 'first queued input\n\nsecond queued input', optimistic: true, inputs } },
    { kind: 'ext', name: MID_RUN_USER_MESSAGE_EXT_EVENT_NAME,
      data: { id: 'wire-receipt', text: 'first queued input\n\nsecond queued input' } },
  ] };
  render(<MessageRow message={message} runStreaming />);
  const bubbles = document.querySelectorAll('.jini-message-user');
  expect(bubbles).toHaveLength(2);
  expect(bubbles[0]).toHaveTextContent('first queued input');
  expect(bubbles[0]!.querySelector('.jini-message-attachment-chip')).toBeNull();
  expect(bubbles[1]).toHaveTextContent('second queued input');
  expect(bubbles[1]!.querySelector('[aria-label="Open footer.png"]')).toBeInTheDocument();
});
