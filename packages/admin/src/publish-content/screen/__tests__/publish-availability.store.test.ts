import { describe, expect, it } from "vitest";
import {
  isPublishToLiveAvailable,
  readPublishToLiveAvailability,
  setPublishToLiveAvailable,
} from "../hooks/publish-availability.store.js";

describe("publish-to-live availability store", () => {
  it("reads an absent canPublishToLive (an older server) as available", () => {
    expect(readPublishToLiveAvailability({})).toBe(true);
    expect(readPublishToLiveAvailability({ canPublishToLive: true })).toBe(true);
    expect(readPublishToLiveAvailability({ canPublishToLive: false })).toBe(false);
  });

  it("defaults to available and follows set calls", () => {
    expect(isPublishToLiveAvailable()).toBe(true);
    setPublishToLiveAvailable({ next: false });
    expect(isPublishToLiveAvailable()).toBe(false);
    setPublishToLiveAvailable({ next: true });
    expect(isPublishToLiveAvailable()).toBe(true);
  });
});
