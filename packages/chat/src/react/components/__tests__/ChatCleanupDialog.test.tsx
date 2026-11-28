// @vitest-environment jsdom
import type { ButtonHTMLAttributes } from 'react';
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
it('an expired preview explains itself and offers only a fresh choice, never the delete action', async () => {
  const choose = vi.fn(), preview = vi.fn(), apply = vi.fn();
  const useChatCleanup = () => ({ state: 'expired' as const, count: 3, bytes: 9, kept: [], preview, apply, choose });
  render(<ChatCleanupDialog useChatCleanup={useChatCleanup} kit={{ Button: 'button' }} copy={{ preview: 'Preview', confirm: 'Delete', expired: 'That preview expired', choose: 'Choose again', partial: 'Partial', count: ({ count }) => `${count} chats` }} onDone={vi.fn()} />);
  expect(screen.getByText('That preview expired')).toBeTruthy();
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Choose again']);
  expect(screen.queryByText('3 chats')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Choose again' }));
  expect(choose).toHaveBeenCalledOnce();
  expect(preview).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});
it('a kit button that stays clickable while disabled (aria-disabled) still cannot delete without a preview token', async () => {
  // Accessible design kits often keep a disabled button focusable and clickable, marking it with
  // aria-disabled instead of the native attribute; the dialog itself must refuse the delete then.
  const AriaDisabledButton = ({ disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...rest} aria-disabled={disabled} />;
  const apply = vi.fn(async () => ({ complete: true })), onDone = vi.fn();
  const useChatCleanup = () => ({ state: 'confirm' as const, count: 5, bytes: 10, kept: [], preview: vi.fn(), apply, choose: vi.fn() });
  render(<ChatCleanupDialog useChatCleanup={useChatCleanup} kit={{ Button: AriaDisabledButton }} copy={{ preview: 'Preview', confirm: 'Delete', expired: 'Expired', choose: 'Choose', partial: 'Partial', count: ({ count }) => `${count} chats` }} onDone={onDone} />);
  const del = screen.getByRole('button', { name: 'Delete' });
  expect(del.getAttribute('aria-disabled')).toBe('true');
  await userEvent.click(del);
  expect(apply).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});
