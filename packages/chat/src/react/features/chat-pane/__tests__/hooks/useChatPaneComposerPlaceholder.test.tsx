import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatPaneComposerPlaceholder } from '../../hooks/useChatPaneComposerPlaceholder.hooks.js';

/** Installs a `window.matchMedia` that reports `matches` for `(prefers-reduced-motion: reduce)`
 *  and nothing else — jsdom implements no media queries at all (`typeof window.matchMedia` is
 *  `undefined`), so every test that needs a specific reduced-motion answer has to supply its own. */
function stubReducedMotion(matches: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
  return listeners;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useChatPaneComposerPlaceholder', () => {
  it('returns placeholder unchanged when placeholders is absent or empty', () => {
    stubReducedMotion(false);
    expect(renderHook(() => useChatPaneComposerPlaceholder('Ask something…', undefined)).result.current).toBe(
      'Ask something…',
    );
    expect(renderHook(() => useChatPaneComposerPlaceholder('Ask something…', [])).result.current).toBe(
      'Ask something…',
    );
  });

  it('shows a single-entry list with no rotation, ignoring placeholder', () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useChatPaneComposerPlaceholder('fallback', ['Only one']));
    expect(result.current).toBe('Only one');
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('rotates through entries on a fixed interval', () => {
      stubReducedMotion(false);
      const { result } = renderHook(() =>
        useChatPaneComposerPlaceholder('fallback', ['First', 'Second', 'Third']),
      );
      expect(result.current).toBe('First');

      act(() => vi.advanceTimersByTime(4_000));
      expect(result.current).toBe('Second');

      act(() => vi.advanceTimersByTime(4_000));
      expect(result.current).toBe('Third');

      // Wraps back to the start rather than stopping at the end of the list.
      act(() => vi.advanceTimersByTime(4_000));
      expect(result.current).toBe('First');
    });

    it('restarts at the first entry when the suggestion set changes mid-cycle', () => {
      stubReducedMotion(false);
      const { result, rerender } = renderHook(
        ({ placeholders }: { placeholders: readonly string[] }) =>
          useChatPaneComposerPlaceholder('fallback', placeholders),
        { initialProps: { placeholders: ['A1', 'A2'] } },
      );
      act(() => vi.advanceTimersByTime(4_000));
      expect(result.current).toBe('A2');

      // A fresh array with different content — not the same reference, but the rotation should
      // still restart from index 0 of the NEW list rather than continuing wherever the old one left off.
      rerender({ placeholders: ['B1', 'B2', 'B3'] });
      expect(result.current).toBe('B1');
    });

    it('does not restart the timer when a host passes a new array with the same content every render', () => {
      stubReducedMotion(false);
      const { result, rerender } = renderHook(
        ({ placeholders }: { placeholders: readonly string[] }) =>
          useChatPaneComposerPlaceholder('fallback', placeholders),
        { initialProps: { placeholders: ['A1', 'A2'] } },
      );

      // Advance almost to the first tick, then re-render with an all-new array of identical
      // content (as an inline `placeholders={['A1', 'A2']}` literal would produce every render).
      act(() => vi.advanceTimersByTime(3_999));
      rerender({ placeholders: ['A1', 'A2'] });
      expect(result.current).toBe('A1');

      // If the identical-content re-render had restarted the timer, this final 1ms would not be
      // enough to reach the next tick.
      act(() => vi.advanceTimersByTime(1));
      expect(result.current).toBe('A2');
    });

    it('shows a stable first entry, never rotating, under prefers-reduced-motion: reduce', () => {
      stubReducedMotion(true);
      const { result } = renderHook(() =>
        useChatPaneComposerPlaceholder('fallback', ['First', 'Second', 'Third']),
      );
      expect(result.current).toBe('First');

      act(() => vi.advanceTimersByTime(20_000));
      expect(result.current).toBe('First');
    });

    it('stops rotating if the OS preference changes to reduced motion mid-session', () => {
      const listeners = stubReducedMotion(false);
      const { result } = renderHook(() =>
        useChatPaneComposerPlaceholder('fallback', ['First', 'Second']),
      );
      act(() => vi.advanceTimersByTime(4_000));
      expect(result.current).toBe('Second');

      act(() => {
        (window.matchMedia('(prefers-reduced-motion: reduce)') as unknown as { matches: boolean }).matches = true;
        listeners.forEach((listener) => listener());
      });
      act(() => vi.advanceTimersByTime(20_000));
      // Frozen wherever it was when the preference changed — no further rotation.
      expect(result.current).toBe('Second');
    });
  });
});
