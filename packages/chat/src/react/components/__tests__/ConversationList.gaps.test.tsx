import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationList, type ConversationListItem } from '../ConversationList.js';

const HOUR = 3_600_000;
const ITEMS: ConversationListItem[] = [
  { id: 'h', title: 'Two hours old', updatedAt: Date.now() - 2 * HOUR },
  { id: 'd', title: null, updatedAt: Date.now() - 3 * 24 * HOUR },
  { id: 'n', title: 'Never touched' },
];

function setup(overrides: Partial<React.ComponentProps<typeof ConversationList>> = {}) {
  const props = { conversations: ITEMS, activeConversationId: null, onSelect: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(), ...overrides };
  render(<ConversationList {...props} />);
  return { props, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('ConversationList without a host confirmer', () => {
  it('asks the browser to confirm with the conversation title before deleting', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { props, user } = setup();
    await user.click(screen.getByTestId('conversation-trigger'));
    await user.click(screen.getByTestId('conversation-delete-h'));
    expect(confirm).toHaveBeenCalledWith('Delete "Two hours old"? This cannot be undone.');
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('h'));
  });

  it('names an untitled conversation and keeps it when the browser confirm is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { props, user } = setup();
    await user.click(screen.getByTestId('conversation-trigger'));
    await user.click(screen.getByTestId('conversation-delete-d'));
    expect(confirm).toHaveBeenCalledWith('Delete "Untitled"? This cannot be undone.');
    await Promise.resolve();
    expect(props.onDelete).not.toHaveBeenCalled();
  });
});

describe('ConversationList rows and host effects', () => {
  it('shows hour and day ages, and no age for a row without a timestamp', async () => {
    const { user } = setup();
    await user.click(screen.getByTestId('conversation-trigger'));
    expect(screen.getByTestId('conversation-select-h')).toHaveTextContent('2h ago');
    expect(screen.getByTestId('conversation-select-d')).toHaveTextContent('3d ago');
    expect(screen.getByTestId('conversation-select-n').querySelector('.jini-conv-item-meta')?.textContent).toBe('');
  });

  it('reports a host create callback that throws synchronously and still closes the switcher', async () => {
    const failure = new Error('sync create failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = setup({ onCreate: () => { throw failure; } });
    await user.click(screen.getByTestId('conversation-trigger'));
    await user.click(screen.getByTestId('conversation-new'));
    expect(consoleError).toHaveBeenCalledWith('[@jini-ai/chat] ConversationList onCreate host effect failed:', failure);
    expect(screen.queryByTestId('conversation-menu')).toBeNull();
  });

  it('stays open for a press inside the switcher and closes for one outside it', async () => {
    const { user } = setup();
    await user.click(screen.getByTestId('conversation-trigger'));
    fireEvent.mouseDown(screen.getByTestId('conversation-search'));
    expect(screen.getByTestId('conversation-menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('conversation-menu')).toBeNull();
  });

  it('stays open on keys other than Escape and closes on Escape', async () => {
    const { user } = setup();
    await user.click(screen.getByTestId('conversation-trigger'));
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByTestId('conversation-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('conversation-menu')).toBeNull();
  });
});
