// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerBrowserDownload, useAssetTreeBatchActions } from '../../../react/hooks/useAssetTreeBatchActions.js';

describe('triggerBrowserDownload', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    revokeObjectURL = vi.fn();
    // jsdom doesn't implement these — stub them for the download-trigger test.
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an object URL, clicks a temporary anchor, and revokes the URL after a delay', () => {
    const blob = new Blob(['data']);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    triggerBrowserDownload({ blob, filename: 'archive.zip' });
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    clickSpy.mockRestore();
  });
});

describe('useAssetTreeBatchActions', () => {
  it('deleteSelected is a no-op when nothing is selected', async () => {
    const onDeleteFiles = vi.fn();
    const { result } = renderHook(() => useAssetTreeBatchActions({ selected: new Set(), onDeleteFiles }));
    await act(async () => result.current.deleteSelected());
    expect(onDeleteFiles).not.toHaveBeenCalled();
  });

  it('deleteSelected calls onDeleteFiles with the selected paths and toggles the busy flag', async () => {
    let resolveDelete: () => void = () => {};
    const onDeleteFiles = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(['a.txt', 'b.txt']), onDeleteFiles }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.deleteSelected();
    });
    expect(result.current.deleting).toBe(true);
    expect(onDeleteFiles).toHaveBeenCalledWith(expect.arrayContaining(['a.txt', 'b.txt']));
    await act(async () => {
      resolveDelete();
      await pending;
    });
    expect(result.current.deleting).toBe(false);
  });

  it('deleteSelected ignores a second call while one is already in flight', async () => {
    let resolveDelete: () => void = () => {};
    const onDeleteFiles = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(['a.txt']), onDeleteFiles }),
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.deleteSelected();
    });
    await act(async () => result.current.deleteSelected());
    expect(onDeleteFiles).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveDelete();
      await first;
    });
  });

  it('downloadSelected is a no-op when downloadFiles is not supplied', async () => {
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(['a.txt']), onDeleteFiles: vi.fn() }),
    );
    await act(async () => result.current.downloadSelected());
    expect(result.current.downloading).toBe(false);
  });

  it('downloadSelected is a no-op when nothing is selected', async () => {
    const downloadFiles = vi.fn();
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(), onDeleteFiles: vi.fn(), downloadFiles }),
    );
    await act(async () => result.current.downloadSelected());
    expect(downloadFiles).not.toHaveBeenCalled();
  });

  it('downloadSelected fetches the archive and triggers a download on success', async () => {
    const blob = new Blob(['zip']);
    const downloadFiles = vi.fn().mockResolvedValue({ blob, filename: 'archive.zip' });
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(['a.txt']), onDeleteFiles: vi.fn(), downloadFiles }),
    );
    await act(async () => result.current.downloadSelected());
    expect(downloadFiles).toHaveBeenCalledWith(['a.txt']);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(result.current.downloading).toBe(false);
    expect(result.current.downloadError).toBeNull();
    clickSpy.mockRestore();
    vi.useRealTimers();
  });

  it('downloadSelected surfaces a downloadError when downloadFiles rejects', async () => {
    const downloadFiles = vi.fn().mockRejectedValue(new Error('archive failed'));
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(['a.txt']), onDeleteFiles: vi.fn(), downloadFiles }),
    );
    await act(async () => result.current.downloadSelected());
    expect(result.current.downloadError).toBe('archive failed');
    expect(result.current.downloading).toBe(false);
  });

  it('downloadSelected wraps a thrown non-Error value via String()', async () => {
    const downloadFiles = vi.fn().mockRejectedValue('nope');
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(['a.txt']), onDeleteFiles: vi.fn(), downloadFiles }),
    );
    await act(async () => result.current.downloadSelected());
    expect(result.current.downloadError).toBe('nope');
  });

  it('downloadSelected ignores a second call while one is already in flight', async () => {
    let resolveDownload: (v: { blob: Blob; filename: string }) => void = () => {};
    const downloadFiles = vi.fn(
      () =>
        new Promise<{ blob: Blob; filename: string }>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    vi.useFakeTimers();
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn().mockReturnValue('blob:x');
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useAssetTreeBatchActions({ selected: new Set(['a.txt']), onDeleteFiles: vi.fn(), downloadFiles }),
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.downloadSelected();
    });
    await act(async () => result.current.downloadSelected());
    expect(downloadFiles).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveDownload({ blob: new Blob(['x']), filename: 'x.zip' });
      await first;
    });
    clickSpy.mockRestore();
    vi.useRealTimers();
  });
});
