import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatPaneWorkingDirectoryAccess } from '../../types.js';
import { useChatPaneWorkingDirectory } from '../../hooks/useChatPaneWorkingDirectory.hooks.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Vitest/act still awaits this rejection; swallow the "unhandled" warning from
  // the promise being observed asynchronously by `act()` rather than inline.
  promise.catch(() => {});
  return { promise, resolve, reject };
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

  it('ignores a stale automatic validation failure raised after a newer directory change started', async () => {
    const first = deferred<boolean>();
    const access = createWorkingDirectoryAccess({
      directoryExists: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(async () => true),
    });
    const { result, rerender } = renderHook(
      ({ directory }: { directory: string }) => useChatPaneWorkingDirectory({
        workingDirectory: directory,
        workingDirectoryAccess: access,
      }),
      { initialProps: { directory: '/work/first' } },
    );

    rerender({ directory: '/work/second' });
    await act(async () => {});
    expect(result.current.workingDirectoryInvalid).toBe(false);
    expect(result.current.workingDirectoryError).toBeNull();

    await act(async () => first.reject(new Error('stale check failed')));
    expect(result.current.workingDirectoryError).toBeNull();
  });

  it('ignores a stale picker-refresh success completed after a newer refresh already applied', async () => {
    const firstRecent = deferred<string[]>();
    const access = createWorkingDirectoryAccess({
      directoryExists: vi.fn(async () => true),
      recentDirectories: vi.fn()
        .mockImplementationOnce(() => firstRecent.promise)
        .mockImplementationOnce(async () => ['/work/second-recent']),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: '/work/current',
      workingDirectoryAccess: access,
    }));
    await act(async () => {});

    let firstRefresh!: Promise<void>;
    act(() => {
      firstRefresh = result.current.openWorkingDirectoryPicker();
    });
    await act(() => result.current.openWorkingDirectoryPicker());
    expect(result.current.recentDirectories).toEqual(['/work/second-recent']);

    await act(async () => firstRecent.resolve(['/work/stale-recent']));
    await firstRefresh;
    expect(result.current.recentDirectories).toEqual(['/work/second-recent']);
  });

  it('ignores a stale picker-refresh failure raised after a newer refresh already applied', async () => {
    const firstRecent = deferred<string[]>();
    const access = createWorkingDirectoryAccess({
      directoryExists: vi.fn(async () => true),
      recentDirectories: vi.fn()
        .mockImplementationOnce(() => firstRecent.promise)
        .mockImplementationOnce(async () => ['/work/second-recent']),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: '/work/current',
      workingDirectoryAccess: access,
    }));
    await act(async () => {});

    let firstRefresh!: Promise<void>;
    act(() => {
      firstRefresh = result.current.openWorkingDirectoryPicker();
    });
    await act(() => result.current.openWorkingDirectoryPicker());
    expect(result.current.workingDirectoryError).toBeNull();

    await act(async () => firstRecent.reject(new Error('stale refresh failed')));
    await firstRefresh;
    expect(result.current.workingDirectoryError).toBeNull();
  });

  it('ignores a stale picker selection applied after a newer pick already completed', async () => {
    const firstPick = deferred<string | null>();
    const access = createWorkingDirectoryAccess({
      pickWorkingDirectory: vi.fn()
        .mockImplementationOnce(() => firstPick.promise)
        .mockImplementationOnce(async () => '/work/second-pick'),
      directoryExists: vi.fn(async () => true),
      recentDirectories: vi.fn(async () => []),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      workingDirectoryAccess: access,
    }));

    let firstAttempt!: Promise<void>;
    act(() => {
      firstAttempt = result.current.pickWorkingDirectory();
    });
    await act(() => result.current.pickWorkingDirectory());
    expect(result.current.workingDirectory).toBe('/work/second-pick');

    await act(async () => firstPick.resolve('/work/stale-pick'));
    await firstAttempt;
    expect(result.current.workingDirectory).toBe('/work/second-pick');
  });

  it('ignores a stale picker-selection failure raised after a newer pick already completed', async () => {
    const firstPick = deferred<string | null>();
    const access = createWorkingDirectoryAccess({
      pickWorkingDirectory: vi.fn()
        .mockImplementationOnce(() => firstPick.promise)
        .mockImplementationOnce(async () => '/work/second-pick'),
      directoryExists: vi.fn()
        .mockImplementationOnce(async () => true)
        .mockImplementationOnce(async () => {
          throw new Error('stale validation failed');
        }),
      recentDirectories: vi.fn(async () => []),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      workingDirectoryAccess: access,
    }));

    let firstAttempt!: Promise<void>;
    act(() => {
      firstAttempt = result.current.pickWorkingDirectory();
    });
    await act(() => result.current.pickWorkingDirectory());
    expect(result.current.workingDirectory).toBe('/work/second-pick');
    expect(result.current.workingDirectoryError).toBeNull();

    await act(async () => firstPick.resolve('/work/stale-pick'));
    await firstAttempt;
    expect(result.current.workingDirectoryError).toBeNull();
    expect(result.current.workingDirectory).toBe('/work/second-pick');
  });

  it('ignores a stale picker validation applied after the directory was cleared mid-flight', async () => {
    const pendingExists = deferred<boolean>();
    const access = createWorkingDirectoryAccess({
      pickWorkingDirectory: vi.fn(async () => '/work/picked'),
      directoryExists: vi.fn(() => pendingExists.promise),
      recentDirectories: vi.fn(async () => ['/work/recent']),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      workingDirectoryAccess: access,
    }));

    let attempt!: Promise<void>;
    act(() => {
      attempt = result.current.pickWorkingDirectory();
    });
    // Lets `access.pickWorkingDirectory()` resolve and the picker enter its
    // validation stage (`Promise.all([directoryExists, recentDirectories])`),
    // which is where `pendingExists` now blocks it.
    await act(async () => {});
    act(() => result.current.clearWorkingDirectory());
    expect(result.current.workingDirectory).toBeNull();

    await act(async () => pendingExists.resolve(true));
    await attempt;
    expect(result.current.workingDirectory).toBeNull();
  });

  it('ignores a stale picker validation failure raised after the directory was cleared mid-flight', async () => {
    const pendingExists = deferred<boolean>();
    const access = createWorkingDirectoryAccess({
      pickWorkingDirectory: vi.fn(async () => '/work/picked'),
      directoryExists: vi.fn(() => pendingExists.promise),
      recentDirectories: vi.fn(async () => []),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      workingDirectoryAccess: access,
    }));

    let attempt!: Promise<void>;
    act(() => {
      attempt = result.current.pickWorkingDirectory();
    });
    await act(async () => {});
    act(() => result.current.clearWorkingDirectory());
    expect(result.current.workingDirectoryError).toBeNull();

    await act(async () => pendingExists.reject(new Error('stale validation failed')));
    await attempt;
    expect(result.current.workingDirectoryError).toBeNull();
    expect(result.current.workingDirectory).toBeNull();
  });

  it('ignores a stale recent-directory selection applied after a newer selection completed', async () => {
    const firstExists = deferred<boolean>();
    const access = createWorkingDirectoryAccess({
      directoryExists: vi.fn()
        .mockImplementationOnce(() => firstExists.promise)
        .mockImplementationOnce(async () => false),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      workingDirectoryAccess: access,
    }));

    let firstSelect!: Promise<void>;
    act(() => {
      firstSelect = result.current.selectRecentDirectory('/work/first-recent');
    });
    await act(() => result.current.selectRecentDirectory('/work/second-recent'));
    expect(result.current.workingDirectory).toBe('/work/second-recent');

    await act(async () => firstExists.resolve(true));
    await firstSelect;
    expect(result.current.workingDirectory).toBe('/work/second-recent');
  });

  it('ignores a stale recent-directory selection failure raised after a newer selection completed', async () => {
    const firstExists = deferred<boolean>();
    const access = createWorkingDirectoryAccess({
      directoryExists: vi.fn()
        .mockImplementationOnce(() => firstExists.promise)
        .mockImplementationOnce(async () => true),
    });
    const { result } = renderHook(() => useChatPaneWorkingDirectory({
      initialWorkingDirectory: null,
      workingDirectoryAccess: access,
    }));

    let firstSelect!: Promise<void>;
    act(() => {
      firstSelect = result.current.selectRecentDirectory('/work/first-recent');
    });
    await act(() => result.current.selectRecentDirectory('/work/second-recent'));
    expect(result.current.workingDirectory).toBe('/work/second-recent');
    expect(result.current.workingDirectoryError).toBeNull();

    await act(async () => firstExists.reject(new Error('stale selection failed')));
    await firstSelect;
    expect(result.current.workingDirectoryError).toBeNull();
    expect(result.current.workingDirectory).toBe('/work/second-recent');
  });
});
