import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTabLauncherMenu, type UseTabLauncherMenuOptions } from '../useTabLauncherMenu.js';
import type { TabLauncherAction, TabLauncherResultItem } from '../../../types.js';

const file: TabLauncherResultItem = { id: 'file', name: 'File', kind: 'code' };
const tab: TabLauncherResultItem = { id: 'tab', name: 'Tab', kind: 'page' };

afterEach(cleanup);

function renderKeyboard<TContext = void>(
  required: Pick<UseTabLauncherMenuOptions<TContext>, 'files' | 'onOpenFile' | 'onClose'>,
  optional: Omit<UseTabLauncherMenuOptions<TContext>, 'files' | 'onOpenFile' | 'onClose' | 'anchor'> = {},
) {
  const hook = renderHook(() => useTabLauncherMenu({ anchor: null, ...required, ...optional }));
  const view = render(<input onKeyDown={(event) => hook.result.current.handleInputKeyDown(event)} />);
  return { ...hook, input: view.getByRole('textbox') };
}

describe('useTabLauncherMenu keyboard characterization', () => {
  it('wraps arrows across files and tabs, prevents their defaults, and never runs actions', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const { result, input } = renderKeyboard({ files: [file], onOpenFile, onClose }, {
      tabs: [tab], actions: [{ id: 'new', label: 'New', run }],
    });
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false);
    expect(result.current.selected).toBe(1);
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false);
    expect(result.current.selected).toBe(0);
    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(false);
    expect(result.current.selected).toBe(1);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['ArrowDown', 'ArrowUp'])('keeps selection at zero and prevents %s when no results exist', (key) => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const { result, input } = renderKeyboard({ files: [], onOpenFile, onClose });
    expect(fireEvent.keyDown(input, { key })).toBe(false);
    expect(result.current.selected).toBe(0);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    { selected: 0, expected: 'file' },
    { selected: 1, expected: 'tab' },
  ])('Enter tracks, opens, and closes the selected $expected in order', ({ selected, expected }) => {
    const calls: string[] = [];
    const run = vi.fn();
    const { result, input } = renderKeyboard({
      files: [file], onOpenFile: (item) => calls.push(`open:${item.id}`), onClose: () => calls.push('close'),
    }, {
      tabs: [tab], onOpenTab: (item) => calls.push(`open:${item.id}`),
      onTrack: (event) => calls.push(event.type), actions: [{ id: 'new', label: 'New', run }],
    });
    act(() => result.current.setSelected(selected));
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(calls).toEqual(['open', `select-${expected}`, `open:${expected}`, 'close']);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([-1, 2])('ignores an absent result at selected index %s without falling back to actions', (selected) => {
    const onOpenFile = vi.fn();
    const onOpenTab = vi.fn();
    const onClose = vi.fn();
    const onTrack = vi.fn();
    const run = vi.fn();
    const { result, input } = renderKeyboard({ files: [file], onOpenFile, onClose }, {
      tabs: [tab], onOpenTab, onTrack, actions: [{ id: 'new', label: 'New', run }],
    });
    act(() => result.current.setSelected(selected));
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(result.current.selected).toBe(selected);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onOpenTab).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(onTrack.mock.calls).toEqual([[{ type: 'open' }]]);
  });

  it('closes after Enter on a tab even when no tab opener or tracker is supplied', () => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    const { input } = renderKeyboard({ files: [], onOpenFile, onClose }, { tabs: [tab] });
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('runs only the first action with the host context when search has no matching results', () => {
    const calls: string[] = [];
    const context = { project: 'project-1' };
    const run = vi.fn((received: typeof context) => { calls.push(received.project); });
    const secondRun = vi.fn();
    const actions: TabLauncherAction<typeof context>[] = [
      { id: 'first', label: 'First', run }, { id: 'second', label: 'Second', run: secondRun },
    ];
    const onOpenFile = vi.fn();
    const { result, input } = renderKeyboard({ files: [file], onOpenFile, onClose: () => calls.push('close') }, {
      tabs: [tab], actions, actionContext: context, onTrack: (event) => calls.push(event.type),
    });
    act(() => result.current.setQuery('no match'));
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(context);
    expect(secondRun).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(calls).toEqual(['open', 'run-action', 'project-1', 'close']);
  });

  it('prevents Enter with neither results nor actions without opening or closing', () => {
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    const { input } = renderKeyboard({ files: [], onOpenFile, onClose });
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves unrelated keys and selection alone', () => {
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    const { result, input } = renderKeyboard({ files: [file], onOpenFile, onClose }, { tabs: [tab] });
    act(() => result.current.setSelected(1));
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(result.current.selected).toBe(1);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retains the old position after the anchor becomes null (reported, not fixed)', () => {
    const anchor = document.createElement('button');
    const { result, rerender } = renderHook(
      ({ anchor }: { anchor: HTMLElement | null }) => useTabLauncherMenu({
        anchor, files: [], onOpenFile: vi.fn(), onClose: vi.fn(),
      }),
      { initialProps: { anchor: anchor as HTMLElement | null } },
    );
    const position = result.current.position;
    expect(position).not.toBeNull();
    rerender({ anchor: null });
    expect(result.current.position).toEqual(position);
  });
});
