import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../Composer.js';
import { FolderChips } from '../FolderChips.js';
import { useComposer } from '../../hooks/useComposer.js';

afterEach(() => { Reflect.deleteProperty(navigator, 'clipboard'); });

describe('FolderChips handle forwarding', () => {
  it('inherits the Composer base at every folder control and keeps false through opening', () => {
    const { result } = renderHook(() => useComposer());
    act(() => result.current.addFolders({ folders: ['/first/project', '/second/project'] }));
    const { container, rerender } = render(<Composer agentHandle="assistant" composer={result.current} onSend={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Folders (2)' });
    expect(toggle).toHaveAttribute('data-agent-element', 'assistant-folders-toggle');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Copy folder path: /first/project' }).getAttribute('data-agent-element')).toMatch(/^assistant-folder-copy-/);
    expect(screen.getByRole('button', { name: 'Remove folder: /first/project' }).getAttribute('data-agent-element')).toMatch(/^assistant-folder-remove-/);
    rerender(<Composer agentHandle={false} composer={result.current} onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Copy folder path: /first/project' })).not.toHaveAttribute('data-agent-element');
    expect(container.querySelector('[data-agent-element]')).toBeNull();
  });

  it('uses exact folder paths for identity across reordering and removes the intended folder', () => {
    const folders = ['/first/project', '/second/project'];
    const onRemove = vi.fn();
    const { rerender } = render(<FolderChips agentHandle="draft" folders={folders} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Folders (2)' }));
    const first = screen.getByRole('button', { name: 'Remove folder: /first/project' }).getAttribute('data-agent-element');
    const second = screen.getByRole('button', { name: 'Remove folder: /second/project' }).getAttribute('data-agent-element');
    expect(first).toMatch(/^draft-folder-remove-[a-z0-9-]+$/);
    expect(first).not.toBe(second);
    rerender(<FolderChips agentHandle="draft" folders={[...folders].reverse()} onRemove={onRemove} />);
    expect(screen.getByRole('button', { name: 'Remove folder: /first/project' })).toHaveAttribute('data-agent-element', first!);
    expect(screen.getByRole('button', { name: 'Remove folder: /second/project' })).toHaveAttribute('data-agent-element', second!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder: /second/project' }));
    expect(onRemove).toHaveBeenCalledWith({ path: '/second/project' });
  });

  it('copies the original path and retains its handle when the accessible label changes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FolderChips agentHandle="draft" folders={['C:\\work\\project']} />);
    const copy = screen.getByRole('button', { name: 'Copy folder path: C:\\work\\project' });
    const handle = copy.getAttribute('data-agent-element');
    expect(handle).toMatch(/^draft-folder-copy-[a-z0-9-]+$/);
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith('C:\\work\\project');
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveAttribute('data-agent-element', handle!);
  });

  it('keeps standalone sent-message folders opt-in without remove controls', () => {
    const { container } = render(<FolderChips folders={['/first/project']} />);
    expect(screen.getByRole('button', { name: 'Copy folder path: /first/project' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Remove folder/ })).toBeNull();
    expect(container.querySelector('[data-agent-element]')).toBeNull();
  });
});
