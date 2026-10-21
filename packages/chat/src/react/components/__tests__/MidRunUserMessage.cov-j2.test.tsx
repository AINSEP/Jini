import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { MessageRow } from '../MessageRow.js';
import { MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, MidRunUserMessage, midRunUserMessageSlotKey, registerMidRunUserMessageRenderer } from '../MidRunUserMessage.js';

afterEach(() => clearExtEventRenderers());

it('renders nothing for a payload that is not an object', () => {
  const { container: nullData } = render(<MidRunUserMessage events={[null]} />);
  expect(nullData).toBeEmptyDOMElement();
  const { container: stringData } = render(<MidRunUserMessage events={['just text']} />);
  expect(stringData).toBeEmptyDOMElement();
  expect(midRunUserMessageSlotKey({ data: null })).toBeUndefined();
});

it('keys slots by a non-empty message id only', () => {
  expect(midRunUserMessageSlotKey({ data: { id: 'm1' } })).toBe('m1');
  expect(midRunUserMessageSlotKey({ data: { id: '' } })).toBeUndefined();
});

it('renders a text-only payload with no id as one bubble', () => {
  render(<MidRunUserMessage events={[{ text: 'no id here' }]} />);
  expect(screen.getByText('no id here').closest('.jini-message-user--mid-run')).not.toBeNull();
});

it('opens a mid-run message attachment in the preview modal and closes it', async () => {
  registerMidRunUserMessageRenderer();
  const message: ChatMessage = { id: 'a1', role: 'assistant', content: '', runStatus: 'running', events: [
    { kind: 'ext', name: MID_RUN_USER_MESSAGE_EXT_EVENT_NAME,
      data: { id: 'm1', text: 'look at this',
        inputs: [{ id: 'm1', text: 'look at this', attachments: [{ path: 'attachment:spec', name: 'spec.pdf', kind: 'file' }] }] } },
  ] };
  render(<MessageRow message={message} runStreaming />);
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Open spec.pdf' }));
  expect(screen.getByRole('dialog', { name: 'spec.pdf preview' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
