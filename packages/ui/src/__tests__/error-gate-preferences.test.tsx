import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserHistoryStorage } from '../features/browser-chrome/dependencies.js';
import { createLocalStorageRecents } from '../features/command-palette/dependencies.js';
import { createLocalStorageViewModeStorage } from '../features/resource-dashboard/dependencies.js';
import { readSavedWidth, saveWidth, useResizableSplitPane } from '../react/hooks/useResizableSplitPane.js';
import { isVisualStabilityMode } from '../utils/visual-stability.js';

afterEach(() => vi.restoreAllMocks());

it('returns the existing defaults for denied preference reads', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('secret-storage'); });
  expect(createBrowserHistoryStorage().loadHistory('scope')).toEqual([]);
  expect(createLocalStorageRecents().read('scope')).toEqual([]);
  expect(createLocalStorageViewModeStorage().getViewMode('scope')).toBeNull();
  expect(readSavedWidth('scope', 460, 345, 720)).toBe(460);
  expect(isVisualStabilityMode('scope')).toBe(false);
  expect(read).toHaveBeenCalledTimes(5);
});

it('keeps callers usable after every optional preference write is denied', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('secret-storage'); });
  const history = [{ title: 'Saved', url: 'https://example.test', lastVisitedAt: 1, visitCount: 1 }];
  expect(() => createBrowserHistoryStorage().saveHistory('scope', history)).not.toThrow();
  expect(() => createLocalStorageRecents().push('scope', 'recent')).not.toThrow();
  expect(() => createLocalStorageViewModeStorage().setViewMode('scope', 'kanban')).not.toThrow();
  expect(() => saveWidth('scope', 500, 345, 720)).not.toThrow();
  expect(history).toEqual([{ title: 'Saved', url: 'https://example.test', lastVisitedAt: 1, visitCount: 1 }]);
  expect(write).toHaveBeenCalledTimes(4);
});

it('keeps the live split width after a denied keyboard-resize write', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('secret-storage'); });
  const { result } = renderHook(() => useResizableSplitPane());
  render(<div ref={result.current.containerRef} />);
  render(<button onKeyDown={result.current.onHandleKeyDown}>Resize</button>);
  expect(result.current.width).toBe(460);
  act(() => fireEvent.keyDown(screen.getByRole('button', { name: 'Resize' }), { key: 'ArrowRight' }));
  expect(result.current.width).toBe(476);
});
