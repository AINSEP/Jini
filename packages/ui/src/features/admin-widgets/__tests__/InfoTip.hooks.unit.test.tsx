import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useInfoTip } from "../components/InfoTip.hooks";

/**
 * @file `useInfoTip` — the open/close state and placement measurement extracted out of `InfoTip.tsx`
 * (`InfoTip.hooks.tsx`). `InfoTip.unit.test.tsx` already covers the same behavior end-to-end through
 * the rendered component (hover/focus/Escape), so this file's job is to pin the hook's own contract
 * in isolation: starts closed, `show()` measures via the attached ref and flips `open`, and the
 * `above`/`below` placement split on `ABOVE_HEADROOM_PX`.
 */

function attachIcon(result: { current: ReturnType<typeof useInfoTip> }, rect: Partial<DOMRect>) {
  const el = document.createElement("span");
  el.getBoundingClientRect = () => rect as DOMRect;
  result.current.iconRef.current = el;
}

describe("useInfoTip", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useInfoTip());
    expect(result.current.open).toBe(false);
  });

  it("show() is a no-op when the icon ref has nothing attached yet", () => {
    const { result } = renderHook(() => useInfoTip());
    act(() => result.current.show());
    expect(result.current.open).toBe(false);
  });

  // `left: 500` here (not the arbitrary `100` this fixture used before the horizontal-clamp fix
  // below) — far enough from either jsdom-default-viewport (1024px) edge that `clampBubbleLeft`
  // is a no-op, so these two keep testing exactly what they say: the above/below flip and the
  // straight top/left passthrough, uncoupled from the separate clamp behavior its own tests cover.
  it("show() opens above when there is enough headroom, using the icon's own top/left", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 500, right: 520, width: 20, height: 20 });

    act(() => result.current.show());

    expect(result.current.open).toBe(true);
    expect(result.current.placement).toBe("above");
    expect(result.current.coords).toEqual({ top: 400, left: 510 });
  });

  it("show() opens below and anchors to the icon's bottom when there isn't enough headroom", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 40, bottom: 60, left: 500, right: 520, width: 20, height: 20 });

    act(() => result.current.show());

    expect(result.current.placement).toBe("below");
    expect(result.current.coords).toEqual({ top: 60, left: 510 });
  });

  /**
   * Horizontal clamp (bugfix, 2026-09-24) — found via `Users.tsx`'s new reset-password info tip
   * clipping off the left edge of a 900px screenshot. Before this, `coords.left` was always the
   * icon's own raw midpoint, so an icon near either edge centered a bubble that ran off-screen.
   * jsdom's default `window.innerWidth` is 1024, so `maxLeft` here is `1024 - 8 - 144 = 872` and
   * `minLeft` is `8 + 144 = 152`.
   */
  it("show() clamps the bubble's left away from the left edge when the icon sits close to it", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 4, right: 24, width: 20, height: 20 });

    act(() => result.current.show());

    expect(result.current.coords.left).toBe(152);
  });

  it("show() clamps the bubble's left away from the right edge when the icon sits close to it", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 1000, right: 1020, width: 20, height: 20 });

    act(() => result.current.show());

    expect(result.current.coords.left).toBe(872);
  });

  it("hide() closes an open tip", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 100, right: 120, width: 20, height: 20 });
    act(() => result.current.show());
    expect(result.current.open).toBe(true);

    act(() => result.current.hide());

    expect(result.current.open).toBe(false);
  });

  it("handleIconKeyDown closes on Escape only while open, and stops propagation when it does", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 100, right: 120, width: 20, height: 20 });
    act(() => result.current.show());

    const stopPropagation = vi.fn();
    const event = { key: "Escape", stopPropagation: () => stopPropagation() } as unknown as Parameters<
      typeof result.current.handleIconKeyDown
    >[0];
    act(() => result.current.handleIconKeyDown(event));

    expect(result.current.open).toBe(false);
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("handleIconKeyDown on Escape while already closed does not throw", () => {
    const { result } = renderHook(() => useInfoTip());
    const stopPropagation = vi.fn();
    const event = { key: "Escape", stopPropagation } as unknown as Parameters<
      typeof result.current.handleIconKeyDown
    >[0];
    expect(() => act(() => result.current.handleIconKeyDown(event))).not.toThrow();
    expect(result.current.open).toBe(false);
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});
