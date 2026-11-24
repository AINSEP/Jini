// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createPublishToLiveAvailabilityStore, readPublishToLiveAvailability } from "../publish-availability.store.js";

const { isPublishToLiveAvailable, setPublishToLiveAvailable, usePublishToLiveAvailable } = createPublishToLiveAvailabilityStore();

/**
 * @file Characterization of the one publish-to-live flag: the host feeds `/auth/me`'s
 * `canPublishToLive` in, every Publish entry point reads it back out.
 */
describe("publish-availability store", () => {
  afterEach(() => { setPublishToLiveAvailable({ next: true }); });

  it("reads canPublishToLive, treating an absent field (older server) as available", () => {
    expect(readPublishToLiveAvailability({ canPublishToLive: false })).toBe(false);
    expect(readPublishToLiveAvailability({ canPublishToLive: true })).toBe(true);
    expect(readPublishToLiveAvailability({})).toBe(true);
  });

  it("defaults to available and reflects a set", () => {
    expect(isPublishToLiveAvailable()).toBe(true);
    setPublishToLiveAvailable({ next: false });
    expect(isPublishToLiveAvailable()).toBe(false);
  });

  it("keeps each instance's flag to itself", () => {
    const other = createPublishToLiveAvailabilityStore();
    setPublishToLiveAvailable({ next: false });
    expect(other.isPublishToLiveAvailable()).toBe(true);
  });

  it("re-renders a subscribed hook on change, and skips listeners when the value is unchanged", () => {
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return usePublishToLiveAvailable(); });
    expect(result.current).toBe(true);
    const before = renders;
    act(() => { setPublishToLiveAvailable({ next: true }); });
    expect(renders).toBe(before);
    act(() => { setPublishToLiveAvailable({ next: false }); });
    expect(result.current).toBe(false);
  });

});
