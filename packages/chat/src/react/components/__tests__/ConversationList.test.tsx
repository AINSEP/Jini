/**
 * `ConversationList` — the four actions plus rename-on-double-click.
 *
 * The rename tests are the reason this file leads with them: Open Design shipped double-click
 * rename in its original switcher and silently lost it in the newer one. A behaviour that can
 * regress by omission needs a test that fails when it does.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConversationList, type ConversationListItem } from '../ConversationList.js';

const ITEMS: ConversationListItem[] = [
  { id: 'c1', title: 'Slow mornings research', messageCount: 6, updatedAt: Date.now() - 60_000 },
  { id: 'c2', title: 'Hawke Media design system', messageCount: 40, updatedAt: Date.now() - 3_600_000 },
  { id: 'c3', title: null, messageCount: 0, updatedAt: Date.now() },
];

function setup(overrides: Partial<React.ComponentProps<typeof ConversationList>> = {}) {
  const props = {
    conversations: ITEMS,
    activeConversationId: 'c1',
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    // Deleting without asking, so delete tests exercise the callback rather than `window.confirm`.
    confirmDelete: () => true,
    ...overrides,
  };
  render(<ConversationList {...props} />);
  return { props, user: userEvent.setup() };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('conversation-trigger'));
}

describe('opening and listing', () => {
  it('renders every conversation once open, and an untitled fallback', async () => {
    const { user } = setup();
    await openMenu(user);
    expect(screen.getByTestId('conversation-item-c1')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-item-c2')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-select-c3')).toHaveTextContent('Untitled');
  });

  it('shows message count in the row meta', async () => {
    const { user } = setup();
    await openMenu(user);
    expect(screen.getByTestId('conversation-select-c2')).toHaveTextContent('40 msg');
  });
});

describe('the four actions', () => {
  it('selects a conversation and closes', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.click(screen.getByTestId('conversation-select-c2'));
    // Selection is deliberately deferred past the double-click grace window, so that a
    // double-click to rename is not preceded by a select-and-close. See DOUBLE_CLICK_GRACE_MS.
    await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith('c2'));
    expect(screen.queryByTestId('conversation-menu')).not.toBeInTheDocument();
  });

  it('does not select when a double-click opens the rename editor', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.dblClick(screen.getByTestId('conversation-select-c2'));
    expect(screen.getByTestId('conversation-rename-c2')).toBeInTheDocument();
    // The pending single-click selection must have been cancelled, not merely outrun.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('creates a new conversation', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.click(screen.getByTestId('conversation-new'));
    expect(props.onCreate).toHaveBeenCalled();
  });

  it('does not create when creation is disabled', async () => {
    const { props, user } = setup({ createDisabled: true });
    await openMenu(user);
    await user.click(screen.getByTestId('conversation-new'));
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('deletes after confirmation, and does not select the row it deleted', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.click(screen.getByTestId('conversation-delete-c2'));
    expect(props.onDelete).toHaveBeenCalledWith('c2');
    // The delete button sits inside the row; without stopPropagation this would also select it.
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('does not delete when confirmation is declined', async () => {
    const { props, user } = setup({ confirmDelete: () => false });
    await openMenu(user);
    await user.click(screen.getByTestId('conversation-delete-c2'));
    expect(props.onDelete).not.toHaveBeenCalled();
  });
});

describe('rename on double-click', () => {
  it('opens an editor seeded with the current title and commits on Enter', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.dblClick(screen.getByTestId('conversation-select-c2'));
    const input = screen.getByTestId('conversation-rename-c2');
    expect(input).toHaveValue('Hawke Media design system');
    await user.clear(input);
    await user.type(input, 'Design system Q3{Enter}');
    expect(props.onRename).toHaveBeenCalledWith('c2', 'Design system Q3');
  });

  it('abandons the rename on Escape', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.dblClick(screen.getByTestId('conversation-select-c2'));
    await user.type(screen.getByTestId('conversation-rename-c2'), 'discarded{Escape}');
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('treats an emptied title as a cancel rather than an erase', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.dblClick(screen.getByTestId('conversation-select-c2'));
    const input = screen.getByTestId('conversation-rename-c2');
    await user.clear(input);
    await user.type(input, '{Enter}');
    expect(props.onRename).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  it('filters client-side by default', async () => {
    const { user } = setup();
    await openMenu(user);
    await user.type(screen.getByTestId('conversation-search'), 'hawke');
    await waitFor(() => {
      expect(screen.queryByTestId('conversation-item-c1')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('conversation-item-c2')).toBeInTheDocument();
  });

  it('reports no matches rather than an empty list', async () => {
    const { user } = setup();
    await openMenu(user);
    await user.type(screen.getByTestId('conversation-search'), 'zzzz');
    await waitFor(() => {
      expect(screen.getByText('No conversations match')).toBeInTheDocument();
    });
  });

  it('delegates to onSearch when a host provides one', async () => {
    const onSearch = vi.fn().mockResolvedValue([ITEMS[2]!]);
    const { user } = setup({ onSearch });
    await openMenu(user);
    await user.type(screen.getByTestId('conversation-search'), 'q');
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('q'));
    await waitFor(() => {
      expect(screen.queryByTestId('conversation-item-c1')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('conversation-item-c3')).toBeInTheDocument();
  });

  it('clears the query when the menu closes, so it does not reopen filtered', async () => {
    const { user } = setup();
    await openMenu(user);
    await user.type(screen.getByTestId('conversation-search'), 'hawke');
    await user.keyboard('{Escape}');
    await openMenu(user);
    expect(screen.getByTestId('conversation-search')).toHaveValue('');
    expect(screen.getByTestId('conversation-item-c1')).toBeInTheDocument();
  });
});

describe('empty state', () => {
  it('distinguishes "no conversations" from "no matches"', async () => {
    const { user } = setup({ conversations: [], activeConversationId: null });
    await openMenu(user);
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });
});
