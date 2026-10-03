// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from '../useDebouncedValue.js';

describe('useDebouncedValue', () => {
  it('updates only after the delay elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue({ value, delayMs: 250 }), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe('ab');
    vi.useRealTimers();
  });

  it('resets the timer on rapid successive changes (only the last value lands)', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue({ value, delayMs: 250 }), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('abc');
    vi.useRealTimers();
  });
});
