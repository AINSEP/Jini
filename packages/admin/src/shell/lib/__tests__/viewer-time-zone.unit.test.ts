import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it.each([["Pacific/Auckland", "Pacific/Auckland"], ["", "UTC"]] as const)(
  "reads the viewer time zone once and uses UTC when the platform has none (%s)", async (timeZone, expected) => {
    const formatter = new Intl.DateTimeFormat("en");
    const options = formatter.resolvedOptions();
    vi.spyOn(formatter, "resolvedOptions").mockReturnValue({ ...options, timeZone });
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue(formatter);
    const { VIEWER_TIME_ZONE } = await import("../viewer-time-zone.js");
    expect(VIEWER_TIME_ZONE).toBe(expected);
  },
);
