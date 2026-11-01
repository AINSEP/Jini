import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ChatPane } from '../../components/ChatPane.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { SECRET_REDACTED_NOTICE } from '../../../../../core/user-text-redaction.js';

const agents = [{ id: 'a', name: 'Agent', available: true }];

/** The redaction notice sat pinned above the composer, unstyled, for every later turn (UI check 2026-10-31). */
function noticeEl(): HTMLElement | null {
  return screen.queryByText(SECRET_REDACTED_NOTICE)?.closest<HTMLElement>('[role="status"]') ?? null;
}

async function sendDraft(text: string): Promise<void> {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
}

it('styles the notice like the pane\'s other status notices', async () => {
  const transport = createFakeChatTransport();
  render(<ChatPane transport={transport} agents={agents} initialSelection={{ agentId: 'a' }} initialDraft="api_key=x" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(noticeEl()?.classList.contains('jini-chat-pane__status')).toBe(true);
});

it('clears the notice when the next message has no key in it', async () => {
  const transport = createFakeChatTransport();
  render(<ChatPane transport={transport} agents={agents} initialSelection={{ agentId: 'a' }} initialDraft="api_key=x" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(noticeEl()).not.toBeNull();
  await act(async () => transport.finish());
  await sendDraft('Now publish the page');
  expect(noticeEl()).toBeNull();
});

it('keeps the notice when the next message also had a key removed', async () => {
  const transport = createFakeChatTransport();
  render(<ChatPane transport={transport} agents={agents} initialSelection={{ agentId: 'a' }} initialDraft="api_key=x" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await act(async () => transport.finish());
  await sendDraft('password=hunter22');
  expect(noticeEl()).not.toBeNull();
});

it('can be dismissed', async () => {
  const transport = createFakeChatTransport();
  render(<ChatPane transport={transport} agents={agents} initialSelection={{ agentId: 'a' }} initialDraft="api_key=x" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(noticeEl()).toBeNull();
});
