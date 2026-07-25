import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatPaneWorkingDirectoryAccess } from '../types.js';
import { useChatPaneWorkingDirectory } from '../react/hooks/useChatPaneWorkingDirectory.hooks.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createWorkingDirectoryAccess(
  overrides: Partial<ChatPaneWorkingDirectoryAccess> = {},
): ChatPaneWorkingDirectoryAccess {
  return {
    pickWorkingDirectory: vi.fn(async () => null),
    recentDirectories: vi.fn(async () => []),
    directoryExists: vi.fn(async () => true),
    ...overrides,
  };
}

describe('useChatPaneWorkingDirectory', () => {
  it('owns uncontrolled current state and ignores native picker cancellation', async () => {
    const onChangeWorkingDirectory = vi.fn();
    const access = createWorkingDirectoryAccess({
      pickWorkingDirectory: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('/work/selected'),
      recentDirectories: vi.fn(async () => ['/work/recent']),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: '/work/initial',
      onChangeWorkingDirectory,
      workingDirectoryAccess: access,
    }));

    await act(() => result.current.pickWorkingDirectory());
    expect(result.current.workingDirectory).toBe('/work/initial');
    expect(onChangeWorkingDirectory).not.toHaveBeenCalled();

    await act(() => result.current.pickWorkingDirectory());
    expect(result.current.workingDirectory).toBe('/work/selected');
    expect(result.current.recentDirectories).toEqual(['/work/recent']);
    expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/work/selected');
  });

  it('keeps controlled state authoritative while reporting requested changes', async () => {
    const onChangeWorkingDirectory = vi.fn();
    const access = createWorkingDirectoryAccess({
      recentDirectories: vi.fn(async () => ['/work/recent']),
      directoryExists: vi.fn(async () => false),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      workingDirectory: '/work/controlled',
      onChangeWorkingDirectory,
      workingDirectoryAccess: access,
    }));

    await act(() => result.current.openWorkingDirectoryPicker());
    expect(result.current.recentDirectories).toEqual(['/work/recent']);
    expect(result.current.workingDirectoryInvalid).toBe(true);

    await act(() => result.current.selectRecentDirectory('/work/recent'));
    expect(result.current.workingDirectory).toBe('/work/controlled');
    expect(result.current.workingDirectoryInvalid).toBe(true);
    expect(onChangeWorkingDirectory).toHaveBeenCalledWith('/work/recent');

    act(() => result.current.clearWorkingDirectory());
    expect(result.current.workingDirectory).toBe('/work/controlled');
    expect(onChangeWorkingDirectory).toHaveBeenCalledWith(null);
  });

  it('surfaces capability errors and clears stale errors after a successful refresh', async () => {
    const access = createWorkingDirectoryAccess({
      recentDirectories: vi
        .fn()
        .mockRejectedValueOnce(new Error('recent folders unavailable'))
        .mockResolvedValueOnce([]),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      workingDirectoryAccess: access,
    }));

    await act(() => result.current.openWorkingDirectoryPicker());
    expect(result.current.workingDirectoryError?.message).toBe('recent folders unavailable');

    await act(() => result.current.openWorkingDirectoryPicker());
    expect(result.current.workingDirectoryError).toBeNull();
  });

  it('normalizes picker/recent validation failures and safely no-ops without native access', async () => {
    const access = createWorkingDirectoryAccess({
      pickWorkingDirectory: vi.fn(async () => {
        throw 'picker bridge unavailable';
      }),
      directoryExists: vi.fn(async () => {
        throw new Error('directory validation unavailable');
      }),
    });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useChatPaneWorkingDirectory({
        initialWorkingDirectory: null,
        ...(enabled ? { workingDirectoryAccess: access } : {}),
      }),
      { initialProps: { enabled: true } },
    );

    await act(() => result.current.pickWorkingDirectory());
    expect(result.current.workingDirectoryError?.message).toBe('picker bridge unavailable');

    await act(() => result.current.selectRecentDirectory('/work/unavailable'));
    expect(result.current.workingDirectoryError?.message).toBe('directory validation unavailable');

    rerender({ enabled: false });
    await act(() => result.current.openWorkingDirectoryPicker());
    await act(() => result.current.pickWorkingDirectory());
    await act(() => result.current.selectRecentDirectory('/work/no-bridge'));
    expect(result.current.workingDirectory).toBe('/work/no-bridge');
  });

  it('normalizes an initial relative directory before exposing it as ready', async () => {
    const onChangeWorkingDirectory = vi.fn();
    const access = createWorkingDirectoryAccess({
      normalizeWorkingDirectory: vi.fn(async () => '/repo/examples/sample-projects/demo'),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: 'examples/sample-projects/demo',
      onChangeWorkingDirectory,
      workingDirectoryAccess: access,
    }));

    expect(result.current.workingDirectoryPending).toBe(true);
    await act(async () => {});
    expect(result.current.workingDirectory).toBe('/repo/examples/sample-projects/demo');
    expect(result.current.workingDirectoryPending).toBe(false);
    expect(onChangeWorkingDirectory)
      .toHaveBeenCalledWith('/repo/examples/sample-projects/demo');
  });

  it('restarts canceled initial validation when the same-directory effect is replayed', async () => {
    const firstNormalization = deferred<string | null>();
    const firstAccess = createWorkingDirectoryAccess({
      normalizeWorkingDirectory: vi.fn(() => firstNormalization.promise),
    });
    const replayedAccess = createWorkingDirectoryAccess({
      normalizeWorkingDirectory: vi.fn(async () => '/repo/examples/sample-projects/demo'),
    });
    const { result, rerender } = renderHook(
      ({ access }: { access: ChatPaneWorkingDirectoryAccess }) =>
        useChatPaneWorkingDirectory({
          initialWorkingDirectory: 'examples/sample-projects/demo',
          workingDirectoryAccess: access,
        }),
      { initialProps: { access: firstAccess } },
    );

    expect(result.current.workingDirectoryPending).toBe(true);
    rerender({ access: replayedAccess });

    await waitFor(() => {
      expect(result.current.workingDirectoryPending).toBe(false);
      expect(result.current.workingDirectory).toBe('/repo/examples/sample-projects/demo');
    });
    expect(replayedAccess.normalizeWorkingDirectory).toHaveBeenCalledOnce();

    await act(async () => firstNormalization.resolve('/work/stale'));
    expect(result.current.workingDirectory).toBe('/repo/examples/sample-projects/demo');
  });

  it('marks null normalization and initial validation failures invalid', async () => {
    const access = createWorkingDirectoryAccess({
      normalizeWorkingDirectory: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce('normalization failed'),
    });
    const { result, rerender } = renderHook(
      ({ directory }: { directory: string }) => useChatPaneWorkingDirectory({
        workingDirectory: directory,
        workingDirectoryAccess: access,
      }),
      { initialProps: { directory: 'first/relative' } },
    );
    await act(async () => {});
    expect(result.current.workingDirectoryInvalid).toBe(true);
    expect(result.current.workingDirectoryPending).toBe(false);

    rerender({ directory: 'second/relative' });
    await act(async () => {});
    expect(result.current.workingDirectoryInvalid).toBe(true);
    expect(result.current.workingDirectoryError?.message).toBe('normalization failed');
  });

  it('ignores a late native picker result after clear', async () => {
    const picked = deferred<string | null>();
    const onChangeWorkingDirectory = vi.fn();
    const access = createWorkingDirectoryAccess({
      pickWorkingDirectory: vi.fn(() => picked.promise),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      onChangeWorkingDirectory,
      workingDirectoryAccess: access,
    }));

    let pick!: Promise<void>;
    act(() => {
      pick = result.current.pickWorkingDirectory();
    });
    expect(result.current.workingDirectoryPending).toBe(true);
    act(() => result.current.clearWorkingDirectory());
    await act(async () => picked.resolve('/work/late'));
    await pick;

    expect(result.current.workingDirectory).toBeNull();
    expect(onChangeWorkingDirectory).not.toHaveBeenCalledWith('/work/late');
  });

  it('ignores stale validation after a controlled external change and unmount', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const exists = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const access = createWorkingDirectoryAccess({ directoryExists: exists });
    const { result, rerender, unmount } = renderHook(
      ({ directory }: { directory: string }) => useChatPaneWorkingDirectory({
        workingDirectory: directory,
        workingDirectoryAccess: access,
      }),
      { initialProps: { directory: '/work/first' } },
    );

    rerender({ directory: '/work/second' });
    await act(async () => second.resolve(true));
    await act(async () => first.resolve(false));
    expect(result.current.workingDirectory).toBe('/work/second');
    expect(result.current.workingDirectoryInvalid).toBe(false);

    rerender({ directory: '/work/third' });
    unmount();
    await act(async () => {});
  });
});
