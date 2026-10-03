// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssetTreeCopyLocalPath } from '../../../react/hooks/useAssetTreeCopyLocalPath.js';
import type { AssetTreeClipboardPort } from '../../../ports.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAssetTreeCopyLocalPath', () => {
  it('starts with no copied path', () => {
    const clipboard: AssetTreeClipboardPort = { copyToClipboard: vi.fn().mockResolvedValue(true) };
    const { result } = renderHook(() => useAssetTreeCopyLocalPath(clipboard));
    expect(result.current.copiedPath).toBeNull();
  });

  it('sets copiedPath on a successful copy and reverts it after confirmMs', async () => {
    const clipboard: AssetTreeClipboardPort = { copyToClipboard: vi.fn().mockResolvedValue(true) };
    const { result } = renderHook(() => useAssetTreeCopyLocalPath(clipboard, 100));
    await act(async () => result.current.copyLocalPath('a.txt', '/Users/me/a.txt'));
    expect(clipboard.copyToClipboard).toHaveBeenCalledWith({ text: '/Users/me/a.txt' });
    expect(result.current.copiedPath).toBe('a.txt');
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.copiedPath).toBeNull();
  });

  it('leaves copiedPath untouched when the copy fails', async () => {
    const clipboard: AssetTreeClipboardPort = { copyToClipboard: vi.fn().mockResolvedValue(false) };
    const { result } = renderHook(() => useAssetTreeCopyLocalPath(clipboard, 100));
    await act(async () => result.current.copyLocalPath('a.txt', '/Users/me/a.txt'));
    expect(result.current.copiedPath).toBeNull();
  });

  it('does not clobber a newer copiedPath when an older confirmation timer fires', async () => {
    const clipboard: AssetTreeClipboardPort = { copyToClipboard: vi.fn().mockResolvedValue(true) };
    const { result } = renderHook(() => useAssetTreeCopyLocalPath(clipboard, 100));
    await act(async () => result.current.copyLocalPath('a.txt', '/a.txt'));
    act(() => vi.advanceTimersByTime(50));
    await act(async () => result.current.copyLocalPath('b.txt', '/b.txt'));
    // The first timer (for 'a.txt') fires now, but current copiedPath is 'b.txt' — must not clear it.
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.copiedPath).toBe('b.txt');
  });
});
