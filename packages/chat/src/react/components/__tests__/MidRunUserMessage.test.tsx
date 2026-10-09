import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { MessageRow } from '../MessageRow.js';
import { MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, registerMidRunUserMessageRenderer } from '../MidRunUserMessage.js';

describe('registerMidRunUserMessageRenderer', () => {
  afterEach(() => clearExtEventRenderers());

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

    const bubbles = document.querySelectorAll('.jini-message-user--mid-run');
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
    expect(document.querySelector('.jini-message-user--mid-run')).toBeNull();
  });
});
