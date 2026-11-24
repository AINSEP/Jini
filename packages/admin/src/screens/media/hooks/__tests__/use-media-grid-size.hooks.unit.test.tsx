// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_GRID_SIZES, parseMediaGridSize } from "../../grid-size.js";
import { useMediaGridSize } from "../use-media-grid-size.hooks.js";

const KEY = "host.media.cardSize";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("parseMediaGridSize", () => {
  it("keeps every known size id and maps anything else to medium", () => {
    for (const { id } of MEDIA_GRID_SIZES) expect(parseMediaGridSize({ value: id })).toBe(id);
    expect(parseMediaGridSize({ value: null })).toBe("medium");
    expect(parseMediaGridSize({ value: "huge" })).toBe("medium");
  });
});

describe("useMediaGridSize", () => {
  it("reads the saved size from the host-injected storage key", () => {
    window.localStorage.setItem(KEY, "xl");
    window.localStorage.setItem("other.key", "small");
    const { result } = renderHook(() => useMediaGridSize({ storageKey: KEY }));
    expect(result.current[0]).toBe("xl");
  });

  it("defaults to medium when nothing (or junk) is saved", () => {
    window.localStorage.setItem(KEY, "gigantic");
    expect(renderHook(() => useMediaGridSize({ storageKey: KEY })).result.current[0]).toBe("medium");
  });

  it("remembers a new choice under the injected key", () => {
    const { result } = renderHook(() => useMediaGridSize({ storageKey: KEY }));
    act(() => result.current[1]("small"));
    expect(result.current[0]).toBe("small");
    expect(window.localStorage.getItem(KEY)).toBe("small");
  });

  it("still changes size for the visit when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useMediaGridSize({ storageKey: KEY }));
    expect(result.current[0]).toBe("medium");
    act(() => result.current[1]("large"));
    expect(result.current[0]).toBe("large");
  });
});
