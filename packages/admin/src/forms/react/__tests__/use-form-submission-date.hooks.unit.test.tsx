// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFormSubmissionDate } from "../hooks/use-form-submission-date.hooks.js";

describe("submission dates", () => {
  it("reformats submission dates when the operator's timezone changes", () => {
    const { result, rerender } = renderHook(
      ({ timeZone }) => useFormSubmissionDate({}, { locale: "en-US", timeZone }),
      { initialProps: { timeZone: "America/Los_Angeles" } },
    );
    expect(result.current({ iso: "2026-10-06T03:12:05.365Z" })).toEqual({
      text: "10/5/26, 8:12 PM", full: "Oct 5, 2026, 8:12 PM", dateTime: "2026-10-06T03:12:05.365Z",
    });
    expect(result.current({ iso: "2026-10-06T20:00:00.000Z" })).toEqual({
      text: "10/6/26, 1:00 PM", full: "Oct 6, 2026, 1:00 PM", dateTime: "2026-10-06T20:00:00.000Z",
    });
    rerender({ timeZone: "UTC" });
    expect(result.current({ iso: "2026-10-06T03:12:05.365Z" })).toEqual({
      text: "10/6/26, 3:12 AM", full: "Oct 6, 2026, 3:12 AM", dateTime: "2026-10-06T03:12:05.365Z",
    });
  });
});
