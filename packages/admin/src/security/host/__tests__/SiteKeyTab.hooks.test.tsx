// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRevealedKeyCopy } from "../SiteKeyTab.hooks.js";

const HEX = "ab".repeat(32);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useRevealedKeyCopy", () => {
  it("writes the exact revealed hex and resets Copied after the display interval", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { result } = renderHook(() => useRevealedKeyCopy({ hex: HEX }));
    await act(async () => result.current.copy());
    expect(writeText).toHaveBeenCalledWith(HEX);
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.copied).toBe(false);

  });
});
