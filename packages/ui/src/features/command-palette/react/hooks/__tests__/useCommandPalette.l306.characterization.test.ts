import { createElement, type KeyboardEvent } from 'react';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommandPalette, type UseCommandPaletteOptions } from '../useCommandPalette.js';
import type { CommandPaletteItem } from '../../../types.js';
import type { CommandPaletteRecentsPort } from '../../../ports.js';

const items: CommandPaletteItem[] = [
  { id: 'older', name: 'Older', kind: 'file', mtime: 1 },
  { id: 'middle', name: 'Middle', kind: 'file', mtime: 2 },
  { id: 'newer', name: 'Newer', kind: 'file', mtime: 3 },
];

function renderPalette(
  input: Pick<UseCommandPaletteOptions, 'items' | 'scopeKey'>,
  options: { cursor?: number } = {},
) {
  const calls: string[] = [];
  const recents: CommandPaletteRecentsPort = {
    read: () => [],
    push: vi.fn((scopeKey: string, id: string) => { calls.push(`push:${scopeKey}:${id}`); }),
  };
  const onSelect = vi.fn((item: CommandPaletteItem) => { calls.push(`select:${item.id}`); });
  const onClose = vi.fn(() => { calls.push('close'); });
  const { result } = renderHook(() =>
    useCommandPalette({ ...input, onSelect, onClose }, { recents }),
  );
  act(() => result.current.setCursorTo(options.cursor ?? 0));
  // Dispatch real React keyboard events while always using the latest hook callback.
  const view = render(createElement('input', {
    'aria-label': 'Palette',
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => result.current.handleKeyDown(event),
  }));
  return { result, input: view.getByRole('textbox'), recents, onSelect, onClose, calls };
}

afterEach(cleanup);

describe('useCommandPalette keyboard characterization (L306)', () => {
  it.each(['ArrowDown', 'ArrowUp', 'Enter', 'Escape'])(
    'leaves %s untouched during IME composition',
    (key) => {
      const palette = renderPalette({ items }, { cursor: 1 });
      const allowedDefault = fireEvent.keyDown(palette.input, { key, isComposing: true, cancelable: true });

      expect(allowedDefault).toBe(true);
      expect(palette.result.current.cursor).toBe(1);
      expect(palette.calls).toEqual([]);
    },
  );

  it.each([
    { key: 'ArrowDown', start: 2, end: 0 },
    { key: 'ArrowUp', start: 0, end: 2 },
  ])('prevents $key and wraps the cursor in its direction', ({ key, start, end }) => {
    const palette = renderPalette({ items }, { cursor: start });
    const allowedDefault = fireEvent.keyDown(palette.input, { key, cancelable: true });

    expect(allowedDefault).toBe(false);
    expect(palette.result.current.cursor).toBe(end);
    expect(palette.calls).toEqual([]);
  });

  it.each(['ArrowDown', 'ArrowUp'])('prevents %s with empty results while preserving the cursor', (key) => {
    const palette = renderPalette({ items: [] }, { cursor: 3 });
    const allowedDefault = fireEvent.keyDown(palette.input, { key, cancelable: true });

    expect(allowedDefault).toBe(false);
    expect(palette.result.current.cursor).toBe(3);
    expect(palette.calls).toEqual([]);
  });

  it('closes on Escape without preventing its default or selecting an item', () => {
    const palette = renderPalette({ items }, { cursor: 1 });
    const allowedDefault = fireEvent.keyDown(palette.input, { key: 'Escape', cancelable: true });

    expect(allowedDefault).toBe(true);
    expect(palette.result.current.cursor).toBe(1);
    expect(palette.calls).toEqual(['close']);
    expect(palette.onClose).toHaveBeenCalledTimes(1);
    expect(palette.onSelect).not.toHaveBeenCalled();
    expect(palette.recents.push).not.toHaveBeenCalled();
  });

  it('prevents Enter and records the cursor item before selecting and closing', () => {
    const palette = renderPalette({ items, scopeKey: 'workspace' }, { cursor: 2 });
    const allowedDefault = fireEvent.keyDown(palette.input, { key: 'Enter', cancelable: true });

    expect(allowedDefault).toBe(false);
    expect(palette.recents.push).toHaveBeenCalledTimes(1);
    expect(palette.recents.push).toHaveBeenCalledWith('workspace', 'older');
    expect(palette.onSelect).toHaveBeenCalledTimes(1);
    expect(palette.onSelect).toHaveBeenCalledWith(items[0]);
    expect(palette.onClose).toHaveBeenCalledTimes(1);
    expect(palette.calls).toEqual(['push:workspace:older', 'select:older', 'close']);
  });

  it.each([
    { label: 'empty results', entries: [], cursor: 0 },
    { label: 'a cursor beyond the results', entries: items, cursor: 3 },
  ])('prevents Enter without selection for $label', ({ entries, cursor }) => {
    const palette = renderPalette({ items: entries }, { cursor });
    const allowedDefault = fireEvent.keyDown(palette.input, { key: 'Enter', cancelable: true });

    expect(allowedDefault).toBe(false);
    expect(palette.result.current.cursor).toBe(cursor);
    expect(palette.calls).toEqual([]);
  });

  it('leaves unrelated keys and their defaults untouched', () => {
    const palette = renderPalette({ items }, { cursor: 1 });
    const allowedDefault = fireEvent.keyDown(palette.input, { key: 'a', cancelable: true });

    expect(allowedDefault).toBe(true);
    expect(palette.result.current.cursor).toBe(1);
    expect(palette.calls).toEqual([]);
  });
});
