/**
 * `ConversationList` — the four actions plus rename-on-double-click.
 *
 * The rename tests are the reason this file leads with them: Open Design shipped double-click
 * rename in its original switcher and silently lost it in the newer one. A behaviour that can
 * regress by omission needs a test that fails when it does.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  const view = render(<ConversationList {...props} />);
  return { props, user: userEvent.setup(), view };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('conversation-trigger'));
}

describe('opening and listing', () => {
  it('shows clean stored titles in the row, trigger tooltip and accessible label without renaming', async () => {
    const conversations = [{ id: 'c1', title: 'Page: **Plannie** at **plannie' }];
    const { props, user } = setup({ conversations });
    const trigger = screen.getByTestId('conversation-trigger');
    expect(trigger).toHaveAttribute('title', 'Page: Plannie at **plannie');
    expect(trigger).toHaveAttribute('aria-label', 'Conversations — Page: Plannie at **plannie');
    await openMenu(user);
    expect(screen.getByTestId('conversation-select-c1')).toHaveTextContent('Page: Plannie at **plannie');
    expect(props.onRename).not.toHaveBeenCalled();
    expect(conversations[0]!.title).toBe('Page: **Plannie** at **plannie');
  });

  it('cleans server search result titles before displaying them', async () => {
    const onSearch = vi.fn(async () => [{ id: 'found', title: '# [Plannie](https://plannie.com) `API`' }]);
    const { user } = setup({ onSearch });
    await openMenu(user);
    await user.type(screen.getByPlaceholderText('Search conversations'), 'Plannie');
    await waitFor(() => expect(screen.getByTestId('conversation-select-found')).toHaveTextContent('Plannie API'));
  });

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
  it('opens Rename from the keyboard and commits a trimmed title without selecting', async () => {
    const { props, user } = setup();
    await openMenu(user);
    const rename = within(screen.getByTestId('conversation-item-c2')).getByRole('button', { name: 'Rename chat' });
    rename.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByTestId('conversation-rename-c2');
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, '  New title  {Enter}');
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith('c2', 'New title');
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('keeps the row available for a double-click whose clicks are 300ms apart', () => {
    vi.useFakeTimers();
    try {
      const { props } = setup();
      fireEvent.click(screen.getByTestId('conversation-trigger'));
      const row = screen.getByTestId('conversation-select-c2');
      fireEvent.click(row, { detail: 1 });
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByTestId('conversation-select-c2')).toBe(row);
      fireEvent.click(row, { detail: 2 });
      fireEvent.doubleClick(row);
      act(() => vi.runOnlyPendingTimers());
      expect(screen.getByTestId('conversation-rename-c2')).toHaveFocus();
      expect(props.onSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('limits the inline title input to 50 characters', async () => {
    const { props, user } = setup();
    await openMenu(user);
    await user.dblClick(screen.getByTestId('conversation-select-c2'));
    const input = screen.getByTestId('conversation-rename-c2');
    expect(input).toHaveAttribute('maxlength', '50');
    await user.clear(input);
    await user.type(input, 'x'.repeat(51));
    await user.keyboard('{Enter}');
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith('c2', 'x'.repeat(50));
  });

  it('does not write an untouched draft after the host refreshes the stored title', async () => {
    const { props, user, view } = setup();
    await openMenu(user);
    await user.dblClick(screen.getByTestId('conversation-select-c1'));
    view.rerender(<ConversationList {...props} conversations={[{ id: 'c1', title: 'Refreshed title' }]} />);
    await user.keyboard('{Enter}');
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId('conversation-select-c1')).toHaveTextContent('Refreshed title');
  });

  it.each([
    { title: `**Long title** ${'retained words '.repeat(12)}tail`, finish: 'Enter' },
    { title: '  **Deliberate** _markers_ and *.ts  ', finish: 'blur' },
    { title: null, finish: 'Enter' },
  ])('preserves the raw title and skips an unchanged rename on $finish: $title', async ({ title, finish }) => {
    const conversations = [{ id: 'c1', title }];
    const { props, user } = setup({ conversations });
    await openMenu(user);
    await user.dblClick(screen.getByTestId('conversation-select-c1'));
    expect(screen.getByTestId('conversation-rename-c1')).toHaveValue(title ?? '');
    if (finish === 'Enter') await user.keyboard('{Enter}');
    else await user.click(screen.getByTestId('conversation-search'));
    expect(screen.queryByTestId('conversation-rename-c1')).not.toBeInTheDocument();
    expect(props.onRename).not.toHaveBeenCalled();
    expect(conversations[0]!.title).toBe(title);
  });

  it('displays the full cleaned legacy title and replaces it with a bounded raw rename', async () => {
    const rawTitle = `**Deliberate** ${'retained words '.repeat(12)}tail`;
    const { props, user } = setup({ conversations: [{ id: 'c1', title: rawTitle }] });
    await openMenu(user);
    expect(screen.getByTestId('conversation-select-c1').querySelector('.jini-conv-item-title')?.textContent)
      .toBe(rawTitle.replace('**Deliberate**', 'Deliberate'));
    await user.dblClick(screen.getByTestId('conversation-select-c1'));
    expect(screen.getByTestId('conversation-rename-c1')).toHaveValue(rawTitle);
    await user.clear(screen.getByTestId('conversation-rename-c1'));
    await user.type(screen.getByTestId('conversation-rename-c1'), '**Deliberate** revised{Enter}');
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith('c1', '**Deliberate** revised');
  });

  it.each(['c1', 'unloaded'])('uses the raw server result for %s, including newer titles for loaded ids', async id => {
    const rawTitle = `**Search title** ${'full title '.repeat(12)}tail`;
    const onSearch = async () => [{ id, title: rawTitle }];
    const { props, user } = setup({ onSearch });
    await openMenu(user);
    await user.type(screen.getByTestId('conversation-search'), 'search');
    await waitFor(() => expect(screen.getByTestId(`conversation-select-${id}`)).toHaveTextContent('Search title'));
    await user.dblClick(screen.getByTestId(`conversation-select-${id}`));
    expect(screen.getByTestId(`conversation-rename-${id}`)).toHaveValue(rawTitle);
    await user.keyboard('{Enter}');
    expect(props.onRename).not.toHaveBeenCalled();
    await user.dblClick(screen.getByTestId(`conversation-select-${id}`));
    await user.clear(screen.getByTestId(`conversation-rename-${id}`));
    await user.type(screen.getByTestId(`conversation-rename-${id}`), '**Search title** revised');
    await user.click(screen.getByTestId('conversation-search'));
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onRename).toHaveBeenCalledWith(id, '**Search title** revised');
  });

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

describe('rejected host effects are reported, not left as unhandled rejections', () => {
  it('reports a rejected onSearch without leaving an unhandled rejection', async () => {
    const failure = new Error('search host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSearch = vi.fn().mockRejectedValue(failure);
    try {
      const { user } = setup({ onSearch });
      await openMenu(user);
      await user.type(screen.getByTestId('conversation-search'), 'q');
      await waitFor(() => expect(onSearch).toHaveBeenCalledWith('q'));
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[@jini-ai/chat] ConversationList onSearch host effect failed:',
          failure,
        );
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reports a rejected onRename without leaving an unhandled rejection', async () => {
    const failure = new Error('rename host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRename = vi.fn().mockRejectedValue(failure);
    try {
      const { user } = setup({ onRename });
      await openMenu(user);
      await user.dblClick(screen.getByTestId('conversation-select-c2'));
      const input = screen.getByTestId('conversation-rename-c2');
      await user.clear(input);
      await user.type(input, 'Design system Q3{Enter}');
      expect(onRename).toHaveBeenCalledWith('c2', 'Design system Q3');
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[@jini-ai/chat] ConversationList onRename host effect failed:',
          failure,
        );
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reports a rejected onCreate without leaving an unhandled rejection', async () => {
    const failure = new Error('create host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onCreate = vi.fn().mockRejectedValue(failure);
    try {
      const { user } = setup({ onCreate });
      await openMenu(user);
      await user.click(screen.getByTestId('conversation-new'));
      expect(onCreate).toHaveBeenCalled();
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[@jini-ai/chat] ConversationList onCreate host effect failed:',
          failure,
        );
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reports a rejected onDelete without leaving an unhandled rejection', async () => {
    const failure = new Error('delete host failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDelete = vi.fn().mockRejectedValue(failure);
    try {
      const { user } = setup({ onDelete });
      await openMenu(user);
      await user.click(screen.getByTestId('conversation-delete-c2'));
      expect(onDelete).toHaveBeenCalledWith('c2');
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[@jini-ai/chat] ConversationList onDelete host effect failed:',
          failure,
        );
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
