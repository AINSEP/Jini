// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ChatCleanupDialog } from '../ChatCleanupDialog.js';

it('dialog shows the server count before deleting', async () => {
  const apply = vi.fn(async () => ({ complete: true })), onDone = vi.fn();
  const useChatCleanup = () => ({ state: 'confirm' as const, previewToken: 'opaque', count: 42, bytes: 100, kept: [], preview: vi.fn(), apply, choose: vi.fn() });
  const copy = { preview: 'Preview', confirm: 'Delete', expired: 'Expired', choose: 'Choose', partial: 'Partial', count: ({ count }: { count: number; bytes: number }) => `${count} chats` };
  render(<ChatCleanupDialog useChatCleanup={useChatCleanup} kit={{ Button: 'button' }} copy={copy} onDone={onDone} />);
  expect(screen.getByText('42 chats')).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(apply).toHaveBeenCalledWith({ previewToken: 'opaque', confirm: true });
  expect(onDone).toHaveBeenCalledOnce();
});
it('kept items are named', () => {
  const useChatCleanup = () => ({ state: 'partial' as const, previewToken: 'next', count: 1, bytes: 2, kept: [{ id: 'p', title: 'Pinned notes', reason: 'pinned' }], preview: vi.fn(), apply: vi.fn(), choose: vi.fn() });
  render(<ChatCleanupDialog useChatCleanup={useChatCleanup} kit={{ Button: 'button' }} copy={{ preview: 'Preview', confirm: 'Delete', expired: 'Expired', choose: 'Choose', partial: 'Partial', count: ({ count }) => String(count) }} onDone={vi.fn()} />);
  expect(screen.getByText('Pinned notes: pinned')).toBeTruthy();
});
