import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatSettingsDialog } from '../components/ChatSettingsDialog.js';
import { useChatSettingsDialog } from '../components/ChatSettingsDialog.hooks.js';

describe('advanced chat settings', () => {
  it('keeps open state in the hook', () => {
    const { result } = renderHook(() => useChatSettingsDialog({}));
    expect(result.current.open).toBe(false);
    act(() => result.current.show({}));
    expect(result.current.open).toBe(true);
    act(() => result.current.close({}));
    expect(result.current.open).toBe(false);
  });
  it('calls the supplied display and permission owners without its own settings copy', async () => {
    const user = userEvent.setup(), select = vi.fn(), change = vi.fn();
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[
      { key: 'tools', label: 'Tool calls', items: [{ key: 'show', label: 'Show', role: 'menuitemradio', checked: true, onSelect: select }] },
      { key: 'transcript', items: [{ key: 'done', label: 'Done line', role: 'menuitemcheckbox', checked: true, onSelect: select }] },
    ]} permissions={{ enabled: true, canEdit: true, capabilities: [{ key: 'shell', label: 'Bash/shell', description: 'Run shell commands.', enabled: true }], onChange: change }} />);
    const dialog = screen.getByRole('dialog', { name: 'Chat settings' });
    await user.click(within(dialog).getByRole('switch', { name: 'Done line' }));
    expect(select).toHaveBeenCalledOnce();
    await user.click(within(dialog).getByRole('tab', { name: 'Agent permissions' }));
    await user.click(within(dialog).getByRole('switch', { name: 'Bash/shell' }));
    expect(change).toHaveBeenCalledWith({ key: 'shell', enabled: false });
    expect(within(dialog).getByText('Permission changes apply to the next run.')).toBeTruthy();
  });
  it('shows hosted permissions disabled', async () => {
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[]} permissions={{
      enabled: false, canEdit: false, unavailableReason: 'Not available on hosted sites',
      capabilities: [{ key: 'shell', label: 'Bash/shell', description: 'Run shell commands.', enabled: false }], onChange: vi.fn(),
    }} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Agent permissions' }));
    for (const toggle of screen.getAllByRole('switch')) expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Not available on hosted sites')).toBeTruthy();
  });
  it('splits display and permissions into keyboard tabs with only the active panel shown', async () => {
    const user = userEvent.setup();
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[
      { key: 'transcript', items: [{ key: 'done', label: 'Done line', role: 'menuitemcheckbox', checked: true, onSelect: vi.fn() }] },
    ]} permissions={{ enabled: true, canEdit: true, capabilities: [{ key: 'shell', label: 'Bash/shell', description: 'Run shell commands.', enabled: true }], onChange: vi.fn() }} />);
    const display = screen.getByRole('tab', { name: 'Display' });
    expect(display.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Display' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Bash/shell' })).toBeNull();
    display.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Agent permissions' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Agent permissions' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Done line' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Full CLI access' })).toBeTruthy();
  });
  it('explains each option in a visible one-line description the control is described by, with no info icons', async () => {
    const user = userEvent.setup();
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[
      { key: 'tools', label: 'Tool calls', description: 'How tool calls appear.', items: [{ key: 'show', label: 'Show', role: 'menuitemradio', checked: true, hint: 'Every tool call.', onSelect: vi.fn() }] },
      { key: 'transcript', items: [{ key: 'done', label: 'Done line', role: 'menuitemcheckbox', checked: true, hint: 'Time and cost.', onSelect: vi.fn() }] },
    ]} permissions={{ enabled: false, canEdit: true, capabilities: [{ key: 'shell', label: 'Bash/shell', description: 'Run shell commands.', enabled: false }], onChange: vi.fn() }} />);
    const described = (element: HTMLElement) => document.getElementById(element.getAttribute('aria-describedby') ?? '');
    expect(screen.queryByRole('button', { name: /More info/ })).toBeNull();
    expect(described(screen.getByRole('group', { name: 'Tool calls' }))?.textContent).toBe('How tool calls appear.');
    expect(screen.queryByText('Every tool call.')).toBeNull();
    const doneLine = described(screen.getByRole('switch', { name: 'Done line' }));
    expect(doneLine?.textContent).toBe('Time and cost.');
    expect(doneLine?.className).toContain('jini-chat-settings-description');
    await user.click(screen.getByRole('tab', { name: 'Agent permissions' }));
    expect(described(screen.getByRole('switch', { name: 'Bash/shell' }))?.textContent).toBe('Run shell commands.');
    expect(described(screen.getByRole('switch', { name: 'Full CLI access' }))?.textContent).toBe('Turn every capability below on or off at once.');
    expect(screen.queryByRole('button', { name: /More info/ })).toBeNull();
  });
  it('describes radio and switch controls with help outside their labels without selecting them', async () => {
    const user = userEvent.setup(), onSelect = vi.fn();
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[
      { key: 'tools', items: [{ key: 'show', label: 'Show', role: 'menuitemradio', checked: false, tooltip: 'Radio help.', onSelect }] },
      { key: 'transcript', items: [{ key: 'done', label: 'Done line', role: 'menuitemcheckbox', checked: true, tooltip: 'Switch help.', onSelect }] },
    ]} permissions={{ enabled: false, canEdit: true, capabilities: [], onChange: vi.fn() }} />);
    const radioHelp = screen.getByRole('button', { name: 'Radio help.' });
    expect(radioHelp).toBeInTheDocument();
    // The dialog bounds its own tips, so a host dock's narrower bounds never pull them off their icon.
    expect(radioHelp.closest('[data-jini-tip-bounds]')?.tagName).toBe('DIALOG');
    expect(radioHelp.closest('label')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Show' })).toHaveAccessibleDescription('Radio help.');
    await user.click(radioHelp);
    expect(onSelect).not.toHaveBeenCalled();
    const switchHelp = screen.getByRole('button', { name: 'Switch help.' });
    expect(switchHelp).toBeInTheDocument();
    expect(switchHelp.closest('label')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Done line' })).toHaveAccessibleDescription('Switch help.');
    await user.click(switchHelp);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('closes from the header close button', async () => {
    const onClose = vi.fn();
    render(<ChatSettingsDialog open onClose={onClose} displaySections={[]} permissions={{ enabled: false, canEdit: true, capabilities: [], onChange: vi.fn() }} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
