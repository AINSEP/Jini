import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSeeMoreClamp } from "../components/SeeMore/SeeMore.hooks";

/**
 * @file `useSeeMoreClamp` — the collapse/expand state machine and overflow measurement
 * `SeeMore.tsx` delegates to, driven directly here with `renderHook` rather than through a full
 * component render. Split out of `SeeMore.unit.test.tsx` on the same line the component/hook split
 * itself drew (`SeeMore.tsx` vs. `SeeMore.hooks.tsx`) — modeled on
 * `hooks/__tests__/use-fab-position.hooks.test.ts`'s hook-only test style.
 *
 * Nothing here renders real DOM: `textRef.current` is a plain object exposing only the two
 * properties `measure()` actually reads (`clientHeight`/`scrollHeight`), which is the honest
 * substitute for what a real browser's layout engine would report — jsdom itself reports 0 for
 * both on every element, so a real render would tell you nothing about the measurement logic.
 */

const CLAMPED_BOX_HEIGHT = 40;
const FULL_TEXT_HEIGHT = 120;

/** A fake element good enough for `useSeeMoreClamp`'s `measure()`: it only ever reads
 * `clientHeight`/`scrollHeight` off `textRef.current`, nothing else about a real node. */
function fakeMeasuredElement(clientHeight: number, scrollHeight: number): HTMLDivElement {
  return { clientHeight, scrollHeight } as unknown as HTMLDivElement;
}

describe("useSeeMoreClamp", () => {
  it("rounds lines to the nearest integer and floors anything below 1", () => {
    const cases: Array<[number, number]> = [
      [2, 2],
      [1.4, 1],
      [2.6, 3],
      [0, 1],
      [-3, 1],
    ];
    for (const [lines, expected] of cases) {
      const { result } = renderHook(() => useSeeMoreClamp({ lines, children: "x" }));
      expect(result.current.lineCount).toBe(expected);
    }
  });

  it("starts collapsed and flips via setExpanded", () => {
    const { result } = renderHook(() => useSeeMoreClamp({ lines: 2, children: "x" }));
    expect(result.current.expanded).toBe(false);

    act(() => result.current.setExpanded(true));
    expect(result.current.expanded).toBe(true);
  });

  it("measures overflow against the live textRef element when children change while collapsed", () => {
    const { result, rerender } = renderHook(({ children }) => useSeeMoreClamp({ lines: 2, children }), {
      initialProps: { children: "short" },
    });

    // The hook only measures the ref it's handed — nothing here renders real DOM, so a fake element
    // exposing the two properties `measure()` actually reads is the honest substitute for the
    // clamped/full-text box heights a real browser would report.
    act(() => {
      result.current.textRef.current = fakeMeasuredElement(CLAMPED_BOX_HEIGHT, FULL_TEXT_HEIGHT);
    });
    rerender({ children: "longer text that overflows" });
    expect(result.current.overflows).toBe(true);
  });

  it.each([
    [1, false],
    [2, true],
  ] as const)("reports overflow of %ipx as %s at the rounding tolerance boundary", (extraHeight, expected) => {
    const { result, rerender } = renderHook(({ children }) => useSeeMoreClamp({ lines: 2, children }), {
      initialProps: { children: "before measurement" },
    });
    result.current.textRef.current = fakeMeasuredElement(CLAMPED_BOX_HEIGHT, CLAMPED_BOX_HEIGHT + extraHeight);
    rerender({ children: "measured text" });
    expect(result.current.overflows).toBe(expected);
  });

  it("does not re-measure while expanded, leaving overflows stale until the next collapse", () => {
    const { result, rerender } = renderHook(({ children }) => useSeeMoreClamp({ lines: 2, children }), {
      initialProps: { children: "a" },
    });
    act(() => {
      result.current.textRef.current = fakeMeasuredElement(CLAMPED_BOX_HEIGHT, FULL_TEXT_HEIGHT);
    });
    rerender({ children: "b" });
    expect(result.current.overflows).toBe(true);

    act(() => result.current.setExpanded(true));
    act(() => {
      // Reports "fits" now — matches what a real element would report once the clamp is lifted.
      // The guard under test: the hook must NOT re-measure while expanded, so `overflows` should
      // stay stuck at `true` rather than flip to `false` and strand the user with no way to
      // collapse (the same regression the component-level "keeps the toggle mounted" test pins).
      result.current.textRef.current = fakeMeasuredElement(CLAMPED_BOX_HEIGHT, CLAMPED_BOX_HEIGHT);
    });
    rerender({ children: "c" });
    expect(result.current.overflows).toBe(true);
  });

  /**
   * Coverage-gap-fill (2026-09-05). Every test above runs with no `ResizeObserver` global at all —
   * this file's own header notes jsdom implements none, which is exactly the branch the hook's
   * `typeof ResizeObserver !== "function"` guard exists for. This polyfills a fake `ResizeObserver`
   * (real browser shape) so the OTHER branch — actually constructing, observing, and disconnecting
   * one — gets exercised too.
   */
  it("observes the element via ResizeObserver when the host environment provides one, and disconnects on unmount", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let storedCallback: (() => void) | undefined;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        storedCallback = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    try {
      const { result, unmount } = renderHook(() => useSeeMoreClamp({ lines: 2, children: "x" }));
      // The effect's deps are `[expanded, measure]`, and `measure` is referentially stable — setting
      // `textRef.current` alone (a mutation, not a render) does not re-run it. Toggling `expanded`
      // true-then-false does, and by the time it flips back to false, `textRef.current` already
      // points at the fake element below — the same mount-order reality a real render would produce
      // once the ref actually attaches.
      result.current.textRef.current = fakeMeasuredElement(CLAMPED_BOX_HEIGHT, CLAMPED_BOX_HEIGHT);
      act(() => result.current.setExpanded(true));
      act(() => result.current.setExpanded(false));

      expect(observe).toHaveBeenCalledTimes(1);
      expect(storedCallback).toBeDefined();

      // The observer's own callback re-runs `measure()` — a width-driven reflow, not a children
      // change, so this is the one path the layout effect above can never reach on its own.
      result.current.textRef.current = fakeMeasuredElement(CLAMPED_BOX_HEIGHT, FULL_TEXT_HEIGHT);
      act(() => storedCallback!());
      expect(result.current.overflows).toBe(true);

      unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
