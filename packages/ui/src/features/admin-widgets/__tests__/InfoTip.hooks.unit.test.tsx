import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TIP_BOUNDS_ATTRIBUTE, useInfoTip } from "../components/InfoTip.hooks";
import { placeInfoTipBubble } from "../components/InfoTip.rules";

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
  it("uses measured height for a requested top placement, and falls back below without enough room", () => {
    const { result } = renderHook(() => useInfoTip({}, { placement: "top" }));
    attachIcon(result, { top: 120, bottom: 140, left: 500, width: 20 });
    const bubble = document.createElement("span");
    bubble.getBoundingClientRect = () => ({ height: 80 }) as DOMRect;
    result.current.bubbleRef!.current = bubble;
    act(() => result.current.show());
    expect(result.current.placement).toBe("above");
    expect(result.current.coords.top).toBe(120);
    attachIcon(result, { top: 40, bottom: 60, left: 500, width: 20 });
    act(() => result.current.show());
    expect(result.current.placement).toBe("below");
    expect(result.current.coords.top).toBe(60);
  });

  it("honors a requested bottom placement even with ample headroom", () => {
    const { result } = renderHook(() => useInfoTip({}, { placement: "bottom" }));
    attachIcon(result, { top: 400, bottom: 420, left: 500, width: 20 });
    act(() => result.current.show());
    expect(result.current.placement).toBe("below");
    expect(result.current.coords.top).toBe(420);
  });
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
    const preventDefault = vi.fn();
    const event = { key: "Escape", stopPropagation, preventDefault } as unknown as Parameters<
      typeof result.current.handleIconKeyDown
    >[0];
    act(() => result.current.handleIconKeyDown(event));

    expect(result.current.open).toBe(false);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("handleIconKeyDown on Escape while already closed does not throw", () => {
    const { result } = renderHook(() => useInfoTip());
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const event = { key: "Escape", stopPropagation, preventDefault } as unknown as Parameters<
      typeof result.current.handleIconKeyDown
    >[0];
    expect(() => act(() => result.current.handleIconKeyDown(event))).not.toThrow();
    expect(result.current.open).toBe(false);
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("leave() closes a hover-opened tip but not a pinned one; hide() unpins", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 500, right: 520, width: 20, height: 20 });
    act(() => result.current.show());
    act(() => result.current.leave());
    expect(result.current.open).toBe(false);

    act(() => result.current.toggle());
    act(() => result.current.leave());
    expect(result.current.open).toBe(true);
    act(() => result.current.hide());
    act(() => result.current.show());
    act(() => result.current.leave());
    expect(result.current.open).toBe(false);
  });

  it("toggle() closes a pinned tip", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 500, right: 520, width: 20, height: 20 });
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it("keeps a measured bubble inside a host panel marked with the bounds attribute and reports the arrow offset", () => {
    const { result } = renderHook(() => useInfoTip());
    const panel = document.createElement("div");
    panel.setAttribute(TIP_BOUNDS_ATTRIBUTE, "");
    panel.getBoundingClientRect = () => ({ left: 600, right: 900 }) as DOMRect;
    const icon = document.createElement("span");
    icon.getBoundingClientRect = () => ({ top: 400, bottom: 420, left: 860, width: 20 }) as DOMRect;
    panel.append(icon);
    result.current.iconRef.current = icon;
    const bubble = document.createElement("span");
    bubble.getBoundingClientRect = () => ({ width: 200, height: 40 }) as DOMRect;
    result.current.bubbleRef!.current = bubble;
    act(() => result.current.show());
    const expected = placeInfoTipBubble(
      { anchor: { left: 860, top: 400, width: 20, height: 20 }, bubble: { width: 200, height: 40 }, viewport: { width: window.innerWidth, height: window.innerHeight } },
      { bounds: { left: 600, right: 900 } },
    );
    expect(result.current.coords).toEqual({ top: expected.top, left: expected.left, arrowLeft: expected.arrowLeft });
    // Centre x stays far enough inside the panel's right edge for the 200px bubble to fit.
    expect(result.current.coords.left + 100).toBeLessThanOrEqual(900);
  });

  it("re-measures an open tip on resize, so it follows its icon", () => {
    const { result } = renderHook(() => useInfoTip());
    attachIcon(result, { top: 400, bottom: 420, left: 500, width: 20 });
    act(() => result.current.show());
    expect(result.current.coords.top).toBe(400);
    attachIcon(result, { top: 250, bottom: 270, left: 500, width: 20 });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(result.current.coords.top).toBe(250);
  });

  it("closes when a scroll moves its icon, but not for a scroll in an unrelated pane", () => {
    const { result } = renderHook(() => useInfoTip());
    const page = document.createElement("div");
    const pane = document.createElement("div");
    const icon = document.createElement("span");
    icon.getBoundingClientRect = () => ({ top: 400, bottom: 420, left: 500, width: 20 }) as DOMRect;
    page.append(icon);
    document.body.append(page, pane);
    result.current.iconRef.current = icon;
    act(() => result.current.show());
    act(() => { pane.dispatchEvent(new Event("scroll")); });
    expect(result.current.open).toBe(true);
    act(() => { page.dispatchEvent(new Event("scroll")); });
    expect(result.current.open).toBe(false);
    page.remove();
    pane.remove();
  });

  it("opening one tip closes any other open tip", () => {
    const first = renderHook(() => useInfoTip()).result;
    const second = renderHook(() => useInfoTip()).result;
    attachIcon(first, { top: 400, bottom: 420, left: 500, width: 20 });
    attachIcon(second, { top: 400, bottom: 420, left: 500, width: 20 });
    act(() => first.current.toggle());
    act(() => second.current.show());
    expect(first.current.open).toBe(false);
    expect(second.current.open).toBe(true);
  });

  it("a mouse click opens without pinning; a touch tap pins and hides after 2.5 s; Enter pins with no timer", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useInfoTip());
      attachIcon(result, { top: 400, bottom: 420, left: 500, width: 20 });
      act(() => { result.current.pointerDown!({ pointerType: "mouse" }); result.current.toggle(); });
      act(() => result.current.leave());
      expect(result.current.open).toBe(false);

      act(() => { result.current.pointerDown!({ pointerType: "touch" }); result.current.toggle(); });
      act(() => result.current.leave());
      expect(result.current.open).toBe(true);
      act(() => { vi.advanceTimersByTime(2500); });
      expect(result.current.open).toBe(false);

      act(() => result.current.toggle());
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(result.current.open).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
