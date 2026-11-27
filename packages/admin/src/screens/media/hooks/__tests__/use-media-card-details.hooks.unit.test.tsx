// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useMediaCardDetails } from "../use-media-card-details.hooks.js";

describe("phone media card details", () => {
  it("server-renders the desktop card when no window is available", () => {
    function CardDetails() {
      const { isPhone } = useMediaCardDetails({ onToggleEdit: () => {} });
      return <span>{isPhone ? "Phone details" : "Desktop details"}</span>;
    }

    vi.stubGlobal("window", undefined);
    try {
      expect(renderToString(<CardDetails />)).toBe("<span>Desktop details</span>");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tracks phone width, cleans up the viewport subscription, and uses the existing edit action", () => {
    const query = Object.assign(new EventTarget(), {
      matches: false, media: "(max-width: 640px)", onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
    });
    const removeListener = vi.spyOn(query, "removeEventListener");
    const addListener = vi.spyOn(query, "addEventListener");
    const onToggleEdit = vi.fn<(item: { id: string; title: string }) => void>();
    const matchMedia = vi.fn(() => query as MediaQueryList);
    const { result, unmount } = renderHook(() => useMediaCardDetails({ onToggleEdit }, { matchMedia }));
    expect(result.current.isPhone).toBe(false);
    expect(matchMedia.mock.calls).toEqual([["(max-width: 640px)"], ["(max-width: 640px)"]]);
    act(() => {
      query.matches = true;
      query.dispatchEvent(new Event("change"));
    });
    expect(result.current.isPhone).toBe(true);
    const item = { id: "media-1", title: "Sunset" };
    act(() => result.current.openDetails(item));
    expect(onToggleEdit.mock.calls).toEqual([[item]]);
    act(() => {
      query.matches = false;
      query.dispatchEvent(new Event("change"));
    });
    expect(result.current.isPhone).toBe(false);
    unmount();
    expect(removeListener.mock.calls).toEqual(addListener.mock.calls);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});

it("keeps details available in a browser with no matchMedia implementation", () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
  try {
    const onToggleEdit = vi.fn<(id: string) => void>();
    const { result } = renderHook(() => useMediaCardDetails({ onToggleEdit }));
    expect(result.current.isPhone).toBe(false);
    act(() => result.current.openDetails("asset-79"));
    expect(onToggleEdit.mock.calls).toEqual([["asset-79"]]);
  } finally {
    if (descriptor) Object.defineProperty(window, "matchMedia", descriptor);
    else Reflect.deleteProperty(window, "matchMedia");
  }
});

it("reads the browser's initial phone match without waiting for a change event", () => {
  const mediaQuery = Object.assign(new EventTarget(), {
    matches: true, media: "(max-width: 640px)", onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
  }) as MediaQueryList;
  const matchMedia = vi.fn(() => mediaQuery);
  const descriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
  try {
    const { result, unmount } = renderHook(() => useMediaCardDetails({ onToggleEdit: vi.fn() }));
    expect(result.current.isPhone).toBe(true);
    expect(matchMedia.mock.calls).toEqual([["(max-width: 640px)"], ["(max-width: 640px)"]]);
    unmount();
  } finally {
    if (descriptor) Object.defineProperty(window, "matchMedia", descriptor);
    else Reflect.deleteProperty(window, "matchMedia");
  }
});
