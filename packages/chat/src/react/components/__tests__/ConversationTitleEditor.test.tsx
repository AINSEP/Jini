import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationTitle, ConversationTitleEditor } from '../ConversationTitleEditor.js';

describe('ConversationTitleEditor', () => {
  it('commits a changed, trimmed title only once even when Enter is followed by blur', async () => {
    const onCommit = vi.fn(), onCancel = vi.fn(), user = userEvent.setup();
    render(<ConversationTitleEditor title="Old" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByRole('textbox', { name: 'Rename chat' });
    await user.clear(input);
    await user.type(input, '  New name  {Enter}');
    input.blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('New name');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reports a failing host commit instead of leaving the rejection unhandled', async () => {
    const failure = new Error('rename failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<ConversationTitleEditor title={null} onCommit={() => Promise.reject(failure)} onCancel={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Rename chat' }), 'Fresh{Enter}');
    await waitFor(() => expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('onCommit host effect failed'), failure));
    errorLog.mockRestore();
  });
});

describe('ConversationTitle', () => {
  it('opens the shared editor on click and saves through onRename, returning to the button', async () => {
    const onRename = vi.fn(), user = userEvent.setup();
    render(<ConversationTitle title="Raw" displayTitle="Shown title" onRename={onRename} />);
    await user.click(screen.getByRole('button', { name: 'Rename chat' }));
    const input = screen.getByRole('textbox', { name: 'Rename chat' });
    expect(input).toHaveValue('Raw');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    expect(onRename).toHaveBeenCalledWith('Renamed');
    expect(screen.getByRole('button', { name: 'Rename chat' })).toHaveTextContent('Shown title');
  });

  it('cancels back to the button on Escape and stays inert when disabled', async () => {
    const onRename = vi.fn(), user = userEvent.setup();
    const view = render(<ConversationTitle title="Raw" displayTitle="Shown" onRename={onRename} />);
    await user.click(screen.getByRole('button', { name: 'Rename chat' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
    view.rerender(<ConversationTitle title="Raw" displayTitle="Shown" onRename={onRename} disabled />);
    const button = screen.getByRole('button', { name: 'Rename chat' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Shown');
  });
});
