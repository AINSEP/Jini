// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOverflowDetection } from "../useOverflowDetection.hooks.js";

/**
 * @file `useOverflowDetection` — the measurement behind the chat pane's "Show in modal" button
 * (only shown once content genuinely doesn't fit its own box, per the owner's own framing; see
 * `OverflowAwareMcpUiSurfaceCard.tsx`'s doc). jsdom implements no real layout engine —
 * `scrollWidth`/`clientWidth`/`ResizeObserver` are either always 0 or entirely absent — so this
 * fakes `ResizeObserver` and stubs the measured element's box metrics directly, the same "control
 * the inputs, assert the derived state" approach `useChatPaneControlsHeight`'s own tests use for
 * the identical jsdom gap.
 */

type ResizeCallback = () => void;

function installFakeResizeObserver() {
  const observedElements: Element[] = [];
  let callback: ResizeCallback = () => {};
  const disconnect = vi.fn(() => { observedElements.length = 0; });

  class FakeResizeObserver {
    constructor(cb: ResizeCallback) {
      callback = cb;
    }
    observe(el: Element) {
      observedElements.push(el);
    }
    disconnect = disconnect;
  }

  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return { trigger: () => { if (observedElements.length) callback(); }, observedElements, disconnect };
}

function stubBoxMetrics(el: HTMLElement, metrics: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, "scrollWidth", { value: metrics.scrollWidth, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: metrics.clientWidth, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
}

describe("useOverflowDetection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports not overflowing for content that fits its own box", () => {
    installFakeResizeObserver();
    const el = document.createElement("div");
    stubBoxMetrics(el, { scrollWidth: 200, clientWidth: 200, scrollHeight: 100, clientHeight: 100 });

    // Assigning the ref during the render body (rather than via a real DOM ref callback) still
    // lands before the effect below reads it, since React commits refs and runs effects after
    // render — the same "attach before the mount-time measurement runs" ordering a real `<div
    // ref={containerRef}>` gets.
    function useHookWithRef() {
      const hook = useOverflowDetection();
      if (hook.containerRef.current !== el) hook.containerRef.current = el;
      return hook;
    }

    const { result } = renderHook(() => useHookWithRef());

    expect(result.current.isOverflowing).toBe(false);
  });

  it.each([
    [202, 100, true],
    [201, 101, false],
    [200, 102, true],
  ])("measures on mount with 1px slack (scrollWidth=%s, scrollHeight=%s)", (scrollWidth, scrollHeight, overflowing) => {
    const { observedElements, disconnect } = installFakeResizeObserver();
    const el = document.createElement("div");
    stubBoxMetrics(el, { scrollWidth, clientWidth: 200, scrollHeight, clientHeight: 100 });
    const { result, unmount } = renderHook(() => {
      const hook = useOverflowDetection();
      hook.containerRef.current = el;
      return hook;
    });
    expect(observedElements).toEqual([el]);
    expect(result.current.isOverflowing).toBe(overflowing);
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(observedElements).toEqual([]);
  });

  it("reports overflowing once the element's content exceeds its box on either axis", () => {
    const { trigger } = installFakeResizeObserver();
    const el = document.createElement("div");
    document.body.appendChild(el);
    stubBoxMetrics(el, { scrollWidth: 200, clientWidth: 200, scrollHeight: 100, clientHeight: 100 });

    function useHookWithRef() {
      const hook = useOverflowDetection();
      if (hook.containerRef.current !== el) hook.containerRef.current = el;
      return hook;
    }

    const { result } = renderHook(() => useHookWithRef());
    expect(result.current.isOverflowing).toBe(false);

    // Simulate a fenced code block growing the box's scrollWidth past its clientWidth (this fix's
    // own confirmed repro), then a ResizeObserver notification firing for it.
    stubBoxMetrics(el, { scrollWidth: 1600, clientWidth: 200, scrollHeight: 100, clientHeight: 100 });
    act(() => trigger());

    expect(result.current.isOverflowing).toBe(true);

    document.body.removeChild(el);
  });

  it("treats vertical overflow the same as horizontal overflow", () => {
    const { trigger } = installFakeResizeObserver();
    const el = document.createElement("div");

    function useHookWithRef() {
      const hook = useOverflowDetection();
      if (hook.containerRef.current !== el) hook.containerRef.current = el;
      return hook;
    }

    stubBoxMetrics(el, { scrollWidth: 200, clientWidth: 200, scrollHeight: 100, clientHeight: 100 });
    const { result } = renderHook(() => useHookWithRef());
    expect(result.current.isOverflowing).toBe(false);

    stubBoxMetrics(el, { scrollWidth: 200, clientWidth: 200, scrollHeight: 900, clientHeight: 100 });
    act(() => trigger());

    expect(result.current.isOverflowing).toBe(true);
  });

  it("does nothing (and does not throw) when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { result } = renderHook(() => useOverflowDetection());
    expect(result.current.isOverflowing).toBe(false);
  });
});
