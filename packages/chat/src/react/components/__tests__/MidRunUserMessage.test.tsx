import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { assistantContentFromEvents } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { MessageRow } from '../MessageRow.js';
import { MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, registerMidRunUserMessageRenderer } from '../MidRunUserMessage.js';

describe('registerMidRunUserMessageRenderer', () => {
  afterEach(() => clearExtEventRenderers());

  it.each([false, true])('keeps mid-run inputs outside assistant rows, in order, with exact copy on live and replay (registered: %s)', async registered => {
    if (registered) registerMidRunUserMessageRenderer();
    const message: ChatMessage = { id: 'turn', role: 'assistant', content: '', runStatus: 'running', events: [
      { kind: 'text', text: 'First reply.' },
      { kind: 'usage', inputTokens: 1, outputTokens: 2, costUsd: 0.1 },
      { kind: 'ext', name: 'user_message', data: { id: 'first', text: 'Keep **this**\nexactly.' } },
      { kind: 'text', text: 'Second reply.' },
      { kind: 'usage', inputTokens: 3, outputTokens: 4, costUsd: 0.2 },
      { kind: 'ext', name: 'user_message', data: { id: 'second', text: 'Also update the footer.' } },
    ] };
    message.content = assistantContentFromEvents({ events: message.events! });
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { copied.push(text); },
    } });
    try {
      for (const live of [true, false]) {
        const view = render(<MessageRow message={{ ...message, runStatus: live ? 'running' : 'succeeded' }} runStreaming={live} />);
        const bubbles = [...view.container.querySelectorAll<HTMLElement>('.jini-message-user')];
        expect(bubbles).toHaveLength(2);
        for (const bubble of bubbles) {
          expect(bubble.parentElement?.closest('.jini-message-assistant')).toBeNull();
          expect(bubble).not.toHaveClass('jini-message-user--mid-run');
          expect(bubble.querySelector('.jini-message-usage')).toBeNull();
          fireEvent.click(within(bubble).getByRole('button', { name: 'Copy message' }));
        }
        expect([...view.container.querySelectorAll('.jini-message-content')].map(node => node.textContent)).toEqual([
          'First reply.', 'Keep **this**\nexactly.', 'Second reply.', 'Also update the footer.',
        ]);
        const footers = [...view.container.querySelectorAll('.jini-message-usage')];
        expect(footers).toHaveLength(2);
        for (const [index, footer] of footers.entries()) {
          expect(footer.closest('.jini-message-assistant')).not.toBeNull();
          expect(footer.compareDocumentPosition(bubbles[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        await screen.findAllByRole('button', { name: 'Copied' });
        view.unmount();
      }
      expect(copied).toEqual(['Keep **this**\nexactly.', 'Also update the footer.', 'Keep **this**\nexactly.', 'Also update the footer.']);
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps legacy flat-layout inputs outside the assistant footer and in receipt order', () => {
    const message: ChatMessage = { id: 'legacy', role: 'assistant', content: 'Host-preserved reply.', runStatus: 'succeeded', events: [
      { kind: 'usage', costUsd: 0.1 },
      { kind: 'ext', name: 'user_message', data: { id: 'first', text: 'First input.' } },
      { kind: 'ext', name: 'user_message', data: { id: 'second', text: 'Second input.' } },
    ] };
    const { container } = render(<MessageRow message={message} />);
    const bubbles = [...container.querySelectorAll<HTMLElement>('.jini-message-user')];
    expect(bubbles).toHaveLength(2);
    expect(bubbles.map(bubble => bubble.querySelector('.jini-message-content')?.textContent)).toEqual(['First input.', 'Second input.']);
    expect(screen.getByText('Host-preserved reply.')).toBeInTheDocument();
    const footer = container.querySelector('.jini-message-usage');
    expect(footer).not.toBeNull();
    expect(footer!.compareDocumentPosition(bubbles[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const bubble of bubbles) {
      expect(bubble.parentElement?.closest('.jini-message-assistant')).toBeNull();
      expect(within(bubble).getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    }
  });

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
