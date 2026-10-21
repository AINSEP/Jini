import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSettingsDialog } from '../components/ChatSettingsDialog.js';
import { useChatSettingsView, type ChatPermissionsPort } from '../components/ChatSettingsDialog.hooks.js';

const permissions = (over: Partial<ChatPermissionsPort> = {}): ChatPermissionsPort =>
  ({ enabled: false, canEdit: true, capabilities: [], onChange: vi.fn(), ...over });

// jsdom ships HTMLDialogElement without showModal/close; browsers have both. These install a
// minimal native-like pair for the tests that cover the browser path, and are removed afterwards.
function installNativeDialog() {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
  proto.showModal = showModal; proto.close = close;
  return { showModal, close };
}
afterEach(() => {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  delete proto.showModal; delete proto.close;
});

describe('ChatSettingsDialog lifecycle', () => {
  it('renders closed without opening the dialog or moving focus', () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    render(<ChatSettingsDialog open={false} onClose={vi.fn()} displaySections={[]} permissions={permissions()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('uses native showModal/close when the browser has them and returns focus to the opener', () => {
    const native = installNativeDialog();
    const opener = document.createElement('button'); opener.textContent = 'Open'; document.body.append(opener); opener.focus();
    const view = render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[]} permissions={permissions()} />);
    expect(native.showModal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    view.rerender(<ChatSettingsDialog open={false} onClose={vi.fn()} displaySections={[]} permissions={permissions()} />);
    expect(native.close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('does not re-open an already open native dialog nor close one already closed', () => {
    const native = installNativeDialog();
    const view = render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[]} permissions={permissions()} />);
    const dialog = document.querySelector('dialog')!;
    dialog.removeAttribute('open');
    view.unmount();
    expect(native.close).not.toHaveBeenCalled();
    dialog.setAttribute('open', '');
    native.showModal.mockClear();
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[]} permissions={permissions()} />);
    expect(native.showModal).toHaveBeenCalledOnce();
  });

  it('skips focus return when the opener is gone or not an HTML element', () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const view = render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[]} permissions={permissions()} />);
    opener.remove();
    view.rerender(<ChatSettingsDialog open={false} onClose={vi.fn()} displaySections={[]} permissions={permissions()} />);
    expect(document.activeElement).not.toBe(opener);
  });

  it('closes on Escape (cancel) without letting the browser close it on its own', () => {
    const onClose = vi.fn();
    render(<ChatSettingsDialog open onClose={onClose} displaySections={[]} permissions={permissions()} />);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), cancel);
    expect(onClose).toHaveBeenCalledOnce();
    expect(cancel.defaultPrevented).toBe(true);
  });

  it('closes on a backdrop click or a keyboard-synthesised click, never on a click inside the box', () => {
    const onClose = vi.fn();
    render(<ChatSettingsDialog open onClose={onClose} displaySections={[]} permissions={permissions()} />);
    const dialog = screen.getByRole('dialog');
    // jsdom has no layout: give the dialog a box so inside/outside can be told apart.
    dialog.getBoundingClientRect = () => ({ left: 100, right: 300, top: 50, bottom: 250, width: 200, height: 200, x: 100, y: 50, toJSON: () => ({}) });
    fireEvent.click(screen.getByRole('heading', { name: 'Chat settings' }), { clientX: 5, clientY: 5 });
    fireEvent.click(dialog, { clientX: 150, clientY: 100 });
    expect(onClose).not.toHaveBeenCalled();
    for (const [clientX, clientY] of [[0, 0], [50, 100], [350, 100], [150, 10], [150, 400]] as const) {
      fireEvent.click(dialog, { clientX, clientY });
    }
    expect(onClose).toHaveBeenCalledTimes(5);
  });
});

describe('ChatSettingsDialog content', () => {
  it('gives an unlabelled radio group no name and a labelled switch group a legend', () => {
    render(<ChatSettingsDialog open onClose={vi.fn()} permissions={permissions()} displaySections={[
      { key: 'density', items: [{ key: 'compact', label: 'Compact', role: 'menuitemradio', checked: true }] },
      { key: 'transcript', label: 'Transcript', items: [{ key: 'done', label: 'Done line', role: 'menuitemcheckbox' }] },
    ]} />);
    const groups = screen.getAllByRole('group');
    expect(groups[0]).not.toHaveAttribute('aria-labelledby');
    expect(groups[0]).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('group', { name: 'Transcript' })).toContainElement(screen.getByRole('switch', { name: 'Done line' }));
    expect(screen.getByRole('switch', { name: 'Done line' })).not.toBeChecked();
  });

  it('toggles every capability at once from the master switch', async () => {
    const onChange = vi.fn();
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[]} permissions={permissions({ onChange })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Agent permissions' }));
    await user.click(screen.getByRole('switch', { name: 'Full CLI access' }));
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
    await user.click(screen.getByRole('tab', { name: 'Display' }));
    expect(screen.getByRole('tabpanel', { name: 'Display' })).toBeInTheDocument();
  });

  it('shows a saving status and the host error while permissions are busy', async () => {
    render(<ChatSettingsDialog open onClose={vi.fn()} displaySections={[]}
      permissions={permissions({ busy: true, error: 'Could not save permissions' })} t={key => `«${key}»`} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: '«Agent permissions»' }));
    expect(screen.getByRole('status')).toHaveTextContent('«Saving…»');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save permissions');
    expect(screen.getByRole('switch', { name: '«Full CLI access»' })).toBeDisabled();
  });
});

describe('useChatSettingsView', () => {
  it('ignores permission changes while the port is not editable or busy, and unknown tabs fall back to display', () => {
    const onChange = vi.fn();
    const port = permissions({ canEdit: false, onChange, capabilities: [{ key: 'shell', label: 'Shell', description: 'Run shell.', enabled: false }] });
    const { result } = renderHook(() => useChatSettingsView({ displaySections: [], permissions: port }));
    result.current.master.onCheckedChange({ checked: true });
    result.current.capabilities[0]!.control.onCheckedChange({ checked: true });
    expect(onChange).not.toHaveBeenCalled();
    act(() => result.current.setTab('permissions'));
    expect(result.current.tab).toBe('permissions');
    act(() => result.current.setTab('nonsense'));
    expect(result.current.tab).toBe('display');
  });

  it('never selects a disabled display item', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useChatSettingsView({ permissions: permissions(), displaySections: [
      { key: 's', items: [{ key: 'a', label: 'A', disabled: true, onSelect }, { key: 'b', label: 'B' }] },
    ] }));
    result.current.display[0]!.items[0]!.change();
    result.current.display[0]!.items[1]!.change();
    expect(onSelect).not.toHaveBeenCalled();
    expect(result.current.display[0]!.radio).toBe(false);
    expect(result.current.display[0]!.hint).toBeUndefined();
  });
});
