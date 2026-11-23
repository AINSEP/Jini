import { describe, expect, it } from "vitest";
import { resolveSlowRunDetail } from "../SlowRunNoticeCard.hooks.js";

describe("slow-run detail after a malformed newest event", () => {
  // F4.3/F6.2: selecting the last VALID detail instead of the last EVENT must fail.
  // Literal sequence distinguishes stale history from the current wire entry. No async/state/mock.
  it.each([undefined, null, {}, { detail: "" }, { detail: 42 }])("discards the older detail when the newest entry is %j", (latest) => {
    expect(resolveSlowRunDetail([{ detail: "Previous stall detail" }])).toBe("Previous stall detail");
    expect(resolveSlowRunDetail([{ detail: "Previous stall detail" }, latest])).toBeUndefined();
  });
});
