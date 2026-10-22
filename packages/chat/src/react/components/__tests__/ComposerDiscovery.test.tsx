import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerDiscoveryMenu, ComposerSlashMenu } from '../ComposerDiscovery.js';
import type { ComposerDiscoveryMenuProps } from '../ComposerDiscovery.js';

const t = (key: string) => key;
const item = { id: 'mcp', label: 'MCP servers', description: 'Connect a server' };

function menu(overrides: Partial<ComposerDiscoveryMenuProps> = {}) {
  const props: ComposerDiscoveryMenuProps = {
    groups: [{ id: 'tools', label: 'Tools', items: [item] }, { id: 'empty', label: 'Empty group', items: [] }],
    open: true, disabled: false, attachmentInputRef: createRef(), onToggle: vi.fn(), onClose: vi.fn(),
    onSelect: vi.fn(), onAttachmentChange: vi.fn(), t, ...overrides,
  };
  return { props, ...render(<ComposerDiscoveryMenu {...props} />) };
}

afterEach(cleanup);

describe('ComposerDiscoveryMenu', () => {
  it('renders nothing when no group has items', () => {
    const { container } = menu({ groups: [{ id: 'empty', label: 'Empty group', items: [] }] });
    expect(container.innerHTML).toBe('');
  });

  it('omits empty groups and labels items with their description', () => {
    menu();
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Tools']);
    expect(screen.getByRole('menuitem', { name: /MCP servers/ }).getAttribute('aria-describedby')).toBe('jini-composer-discovery-desc-mcp');
  });

  it('Escape closes an open menu and claims the key; other keys and a closed menu do not', () => {
    const open = menu();
    const button = screen.getByRole('button', { name: 'Add context' });
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
    expect(open.props.onClose).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(button, { key: 'Escape' })).toBe(false);
    expect(open.props.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const closed = menu({ open: false });
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Add context' }), { key: 'Escape' })).toBe(true);
    expect(closed.props.onClose).not.toHaveBeenCalled();
  });

  it('shows the in-progress label and disables the picker while uploading', () => {
    menu({ attachmentPicker: { onFiles: vi.fn(), uploading: true } });
    const attach = screen.getByRole('menuitem', { name: 'Attaching files…' }) as HTMLButtonElement;
    expect(attach.disabled).toBe(true);
    expect((screen.getByTestId('composer-attachment-input') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('ComposerSlashMenu', () => {
  it('renders nothing without matches', () => {
    const { container } = render(<ComposerSlashMenu matches={[]} activeIndex={0} onSelect={vi.fn()} t={t} />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps focus in the textarea on mousedown and selects on click', () => {
    const onSelect = vi.fn();
    render(<ComposerSlashMenu matches={[{ groupId: 'tools', groupLabel: 'Tools', item }]} activeIndex={0} onSelect={onSelect} t={t} />);
    const option = screen.getByRole('option', { name: /MCP servers/ });
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});
