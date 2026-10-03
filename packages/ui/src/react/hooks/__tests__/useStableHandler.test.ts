// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStableHandler } from '../useStableHandler.js';

describe('useStableHandler', () => {
  it('returns a function with a stable identity across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ handler }: { handler: () => void }) => useStableHandler({ handler }),
      { initialProps: { handler: () => {} } },
    );

    const first = result.current;
    rerender({ handler: () => {} });
    const second = result.current;

    expect(first).toBe(second);
  });

  it('calls into the latest committed handler, not a stale closure', () => {
    const first = vi.fn();
    const second = vi.fn();

    const { result, rerender } = renderHook(
      ({ handler }: { handler: () => void }) => useStableHandler({ handler }),
      { initialProps: { handler: first } },
    );

    const stable = result.current;
    stable();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    rerender({ handler: second });
    stable();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('forwards arguments and returns the handler result', () => {
    const handler = vi.fn((a: number, b: number) => a + b);
    const { result } = renderHook(() => useStableHandler({ handler }));

    const value = result.current(2, 3);

    expect(handler).toHaveBeenCalledWith(2, 3);
    expect(value).toBe(5);
  });
});
