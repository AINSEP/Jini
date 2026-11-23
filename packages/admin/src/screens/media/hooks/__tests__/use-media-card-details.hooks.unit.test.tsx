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
