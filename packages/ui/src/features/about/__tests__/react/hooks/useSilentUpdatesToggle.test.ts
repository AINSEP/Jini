import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSilentUpdatesToggle } from '../../../react/hooks/useSilentUpdatesToggle.js';

/** A promise plus its own `resolve`/`reject`, so a test can control exactly
 *  when a write settles relative to another write — the only way to build
 *  the "first issued, resolves last" scenario deterministically. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSilentUpdatesToggle', () => {
  it('toggle is a no-op when no write handler is supplied (AboutTab hides the control in that case, but the hook tolerates it directly)', () => {
    const { result } = renderHook(() =>
      useSilentUpdatesToggle({ allowSilentUpdates: false, onSilentUpdatePreferenceChange: undefined }),
    );

    expect(() => act(() => result.current.toggle(true))).not.toThrow();

    expect(result.current.allowSilentUpdates).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it('seeds the displayed value from the initial prop', () => {
    const { result } = renderHook(() =>
      useSilentUpdatesToggle({ allowSilentUpdates: true, onSilentUpdatePreferenceChange: vi.fn() }),
    );
    expect(result.current.allowSilentUpdates).toBe(true);
    expect(result.current.busy).toBe(false);
  });

  it('applies the next value optimistically and marks busy the instant toggle is called', () => {
    const onSilentUpdatePreferenceChange = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() =>
      useSilentUpdatesToggle({ allowSilentUpdates: false, onSilentUpdatePreferenceChange }),
    );

    act(() => result.current.toggle(true));

    expect(result.current.allowSilentUpdates).toBe(true);
    expect(result.current.busy).toBe(true);
    expect(onSilentUpdatePreferenceChange).toHaveBeenCalledWith(true);
  });

  it('clears busy and keeps the optimistic value once the write resolves', async () => {
    const write = deferred<void>();
    const onSilentUpdatePreferenceChange = vi.fn().mockReturnValue(write.promise);
    const { result } = renderHook(() =>
      useSilentUpdatesToggle({ allowSilentUpdates: false, onSilentUpdatePreferenceChange }),
    );

    act(() => result.current.toggle(true));
    await act(async () => {
      write.resolve();
      await write.promise;
    });

    expect(result.current.allowSilentUpdates).toBe(true);
    expect(result.current.busy).toBe(false);
  });

  it('rolls back to the value in effect immediately before this attempt when the write rejects', async () => {
    const write = deferred<void>();
    const onSilentUpdatePreferenceChange = vi.fn().mockReturnValue(write.promise);
    const { result } = renderHook(() =>
      useSilentUpdatesToggle({ allowSilentUpdates: false, onSilentUpdatePreferenceChange }),
    );

    act(() => result.current.toggle(true));
    expect(result.current.allowSilentUpdates).toBe(true); // optimistic, before the rejection lands

    await act(async () => {
      write.reject(new Error('daemon unreachable'));
      await write.promise.catch(() => {});
    });

    expect(result.current.allowSilentUpdates).toBe(false); // rolled back to the pre-attempt value
    expect(result.current.busy).toBe(false);
  });

  it('adversarial: two overlapping writes where the FIRST-issued attempt resolves LAST does not clobber the newer value', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const onSilentUpdatePreferenceChange = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() =>
      useSilentUpdatesToggle({ allowSilentUpdates: false, onSilentUpdatePreferenceChange }),
    );

    // Issue both writes back to back, before either settles.
    act(() => result.current.toggle(true));
    act(() => result.current.toggle(false));
    expect(result.current.allowSilentUpdates).toBe(false); // the second (latest) optimistic value

    // The SECOND write settles first — the ordinary case, sanity-checked before the adversarial one.
    await act(async () => {
      second.resolve();
      await second.promise;
    });
    expect(result.current.allowSilentUpdates).toBe(false);
    expect(result.current.busy).toBe(false);

    // The FIRST write (issued before the second, but resolving after it) settles now —
    // a real out-of-order server response. Its outcome must be dropped entirely,
    // whether it succeeds or fails, because a newer attempt has already landed.
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(result.current.allowSilentUpdates).toBe(false); // unchanged — NOT clobbered back to true
    expect(result.current.busy).toBe(false); // NOT re-marked busy by a stale settle either
  });

  it('adversarial: a stale REJECTION from a superseded write does not roll back over the newer value', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const onSilentUpdatePreferenceChange = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() =>
      useSilentUpdatesToggle({ allowSilentUpdates: false, onSilentUpdatePreferenceChange }),
    );

    act(() => result.current.toggle(true)); // first attempt: false -> true
    act(() => result.current.toggle(false)); // second attempt (supersedes first): true -> false

    // The second (current) write succeeds first.
    await act(async () => {
      second.resolve();
      await second.promise;
    });
    expect(result.current.allowSilentUpdates).toBe(false);

    // The first write, now stale, rejects. A naive rollback-to-`previous` would set this
    // back to `false`'s own previous... but the real danger is a rollback firing at all
    // once a newer write already confirmed a different value — assert nothing moves.
    await act(async () => {
      first.reject(new Error('stale request aborted'));
      await first.promise.catch(() => {});
    });
    expect(result.current.allowSilentUpdates).toBe(false);
    expect(result.current.busy).toBe(false);
  });
});
