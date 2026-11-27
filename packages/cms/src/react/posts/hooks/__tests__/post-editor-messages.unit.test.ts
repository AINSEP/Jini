
import { expect, test, vi } from "vitest";
import { formatOutsideChangeMessage, formatSaveErrorMessage, formatSaveSuccessMessage, reportPostLoadFailure } from "../post-editor-messages.js";

const t = (key: string) => key;

test("save copy distinguishes no-op, saved, published and scheduled results", () => {
  const isoToLocalDateTimeInput = vi.fn(() => "2031-03-07T09:03");
  const isScheduledPost = vi.fn(() => false);
  const copy = { t, isoToLocalDateTimeInput, isScheduledPost };
  const saved = { version: 13, status: "draft" } as const;
  expect(formatSaveSuccessMessage({ ...copy, saved, statusOverride: undefined }, { expectedVersion: 13 }))
    .toBe("No changes found · nothing new saved (version 13)");
  expect(formatSaveSuccessMessage({ ...copy, saved, statusOverride: undefined }, { expectedVersion: 12 })).toBe("Saved · version 13");
  expect(formatSaveSuccessMessage({ ...copy, saved, statusOverride: "draft" }, { expectedVersion: 13 })).toBe("Saved · version 13");
  expect(isScheduledPost).not.toHaveBeenCalled();
  vi.spyOn(Date, "now").mockReturnValue(900);
  try {
    expect(formatSaveSuccessMessage({ ...copy, saved: { ...saved, status: "published" }, statusOverride: "published" })).toBe("Published · version 13");
    expect(isScheduledPost).toHaveBeenLastCalledWith({ input: { status: "published", publishAt: null }, nowMs: 900 });
    isScheduledPost.mockReturnValue(true);
    expect(formatSaveSuccessMessage({
      ...copy, saved: { ...saved, status: "published", publishAt: "2031-03-07T08:03:00Z" }, statusOverride: "published",
    })).toBe("Scheduled for 2031-03-07 09:03 · version 13");
    expect(isScheduledPost).toHaveBeenLastCalledWith({ input: { status: "published", publishAt: "2031-03-07T08:03:00Z" }, nowMs: 900 });
    expect(isoToLocalDateTimeInput).toHaveBeenCalledExactlyOnceWith({ iso: "2031-03-07T08:03:00Z" });
  } finally {
    vi.restoreAllMocks();
  }
  expect(formatOutsideChangeMessage({ version: 14, t })).toBe("Changed outside the editor · version 14");
});

test("save and publish errors reserve raw API refusals for the editor and retain the attempted verb", () => {
  const failure = new Error("backend details");
  const isUnexpectedServerFailure = ({ error }: { error: unknown }) => error === failure;
  const copy = { t, isUnexpectedServerFailure };
  expect(formatSaveErrorMessage({ ...copy, error: failure, statusOverride: "published" })).toBe("Not published. Your edits are still here.");
  expect(formatSaveErrorMessage({ ...copy, error: failure, statusOverride: undefined })).toBe("Not saved. Your edits are still here.");
  expect(formatSaveErrorMessage({ ...copy, error: new Error("Slug already in use"), statusOverride: "published" })).toBe("Slug already in use");
  expect(formatSaveErrorMessage({ ...copy, error: "opaque", statusOverride: "published" })).toBe("publish failed");
  expect(formatSaveErrorMessage({ ...copy, error: null, statusOverride: "draft" })).toBe("save failed");
});

test("load failure separates server refusals, shared server notices and local diagnostics", () => {
  class ApiError extends Error {}
  const network = new ApiError("technical network failure");
  const local = new TypeError("renderer crashed");
  const publishLocalFailure = vi.fn();
  const ports = { t, isApiError: (error: unknown): error is Error => error instanceof ApiError,
    isUnexpectedServerFailure: ({ error }: { error: unknown }) => error === network, publishLocalFailure };
  const fallback = "This post didn't finish loading. Reload the page; nothing was changed.";
  expect(reportPostLoadFailure({ ...ports, error: new ApiError("Post was removed") })).toBe("Post was removed");
  expect(reportPostLoadFailure({ ...ports, error: new ApiError("") })).toBe(fallback);
  expect(reportPostLoadFailure({ ...ports, error: network })).toBe(fallback);
  expect(publishLocalFailure).not.toHaveBeenCalled();
  expect(reportPostLoadFailure({ ...ports, error: local })).toBe(fallback);
  expect(publishLocalFailure).toHaveBeenCalledExactlyOnceWith({
    message: "The post editor could not show this post.",
    action: "Reload the page. If it keeps happening, copy details and report this problem.",
    step: "Open post in the editor", cause: local,
  });
});
