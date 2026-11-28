// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ConversationList, defaultConversationListHooks } from '../ConversationList.js';

it('pin toggles through props', async () => {
  const onTogglePin = vi.fn();
  render(<ConversationList hooks={defaultConversationListHooks} conversations={[{ id: 'a', title: 'A' }, { id: 'b', title: 'B', pinned: true }]} activeConversationId={null} onSelect={vi.fn()} onCreate={vi.fn()} onTogglePin={onTogglePin} />);
  await userEvent.click(screen.getByTestId('conversation-trigger'));
  expect(screen.getAllByTestId(/conversation-item-/).map(row => row.dataset.testid)).toEqual(['conversation-item-b', 'conversation-item-a']);
  await userEvent.click(screen.getByRole('button', { name: 'Unpin B' }));
  expect(onTogglePin).toHaveBeenCalledWith({ id: 'b', pinned: false });
  expect(screen.getByRole('button', { name: 'Unpin B' })).toBeTruthy();
});
it('selection emits ids', async () => {
  const onSelectionChange = vi.fn();
  render(<ConversationList hooks={defaultConversationListHooks} conversations={[{ id: 'a', title: 'A' }, { id: 'b', title: 'B', pinned: true }, { id: 'c', title: 'C' }]} activeConversationId={null} onSelect={vi.fn()} onCreate={vi.fn()} selectable selectedIds={['b']} onSelectionChange={onSelectionChange} />);
  await userEvent.click(screen.getByTestId('conversation-trigger'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select B' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select C' }), { shiftKey: true });
  expect(onSelectionChange).toHaveBeenLastCalledWith({ ids: ['b', 'a', 'c'] });
});
it('selection is keyboard reachable', async () => {
  const onSelectionChange = vi.fn(), user = userEvent.setup();
  render(<ConversationList hooks={defaultConversationListHooks} conversations={[{ id: 'a', title: 'A' }]} activeConversationId={null} onSelect={vi.fn()} onCreate={vi.fn()} selectable selectedIds={[]} onSelectionChange={onSelectionChange} />);
  await user.click(screen.getByTestId('conversation-trigger'));
  const checkbox = screen.getByRole('checkbox', { name: 'Select A' });
  checkbox.focus();
  expect(document.activeElement).toBe(checkbox);
  await user.keyboard(' ');
  expect(onSelectionChange).toHaveBeenCalledWith({ ids: ['a'] });
});
it('uses injected hooks', async () => {
  const useT = vi.fn(() => (text: string) => text);
  const useConversationListView = vi.fn(defaultConversationListHooks.useConversationListView);
  render(<ConversationList hooks={{ useT, useConversationListView }} conversations={[]} activeConversationId={null} onSelect={vi.fn()} onCreate={vi.fn()} />);
  expect(useT).toHaveBeenCalled();
  expect(useConversationListView).toHaveBeenCalled();
});

it('an untitled chat is named Untitled on its select and pin controls, and is unselected while the host has no selection', () => {
  const onTogglePin = vi.fn();
  render(<ConversationList hooks={defaultConversationListHooks} conversations={[{ id: 'u', title: null }]} activeConversationId={null} onSelect={vi.fn()} onCreate={vi.fn()} onTogglePin={onTogglePin} selectable onSelectionChange={vi.fn()} />);
  fireEvent.click(screen.getByTestId('conversation-trigger'));
  expect(screen.getByRole('checkbox', { name: 'Select Untitled' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Pin Untitled' }));
  expect(onTogglePin).toHaveBeenCalledExactlyOnceWith({ id: 'u', pinned: true });
});
