import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';

const messages: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
const report = { path: 'attachment:report', name: 'report.pdf', kind: 'file' as const };

it('opens a queued turn\'s attachment in the preview modal and closes it again', async () => {
  render(<MessageList messages={messages} pendingPrompts={[{ id: 'q1', text: 'see attached', attachments: [report], onCancel: () => {} }]} />);
  const queued = screen.getByTestId('chat-pane-queued');
  expect(queued.querySelector('[aria-label="Open report.pdf"]')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Open report.pdf' }));
  expect(screen.getByRole('dialog', { name: 'report.pdf preview' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('renders no attachment strip for a queued turn without files', () => {
  render(<MessageList messages={messages} pendingPrompts={[{ id: 'q1', text: 'plain', onCancel: () => {} }]} />);
  expect(screen.getByTestId('chat-pane-queued').querySelector('.jini-message-attachments')).toBeNull();
});
