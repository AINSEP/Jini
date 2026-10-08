// @vitest-environment jsdom
import { describe, expect, it, vi } from "./test-runner.js";

import { ApiError, type AdminComment, type CommentsSettings } from "./rules-support.js";
import {
  buildSettingsPatch,
  commentRowMenuItems,
  describeModerationError,
  emptyRowState,
  parseCloseAfterDays,
  parseOptionalNumber,
  truncate,
  validateSettingsPatch,
} from "./rules-support.js";

/**
 * @file Pure-logic coverage for `features/comments/rules.ts` — the row-menu builder
 * (`commentRowMenuItems`, rank #21 by risk), the moderation-error formatter, and the
 * Comments-settings patch builder/validator (REQ-08/09/10; `buildSettingsPatch` was rank #12 by
 * risk, 34.5% covered — only reachable before this pass by rendering the whole `Comments` screen
 * and submitting its settings form).
 */

const COMMENT: AdminComment = {
  id: "c1",
  workspaceId: "ws1",
  entryId: "e1",
  parentId: null,
  threadRootId: "c1",
  depth: 0,
  status: "pending",
  authorPrincipalId: null,
  authorName: "Jane",
  authorEmail: null,
  authorUrl: null,
  authorIpHash: null,
  bodyText: "Nice post!",
  spamScore: null,
  spamProvider: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

const SETTINGS: CommentsSettings = {
  enabled: true,
  requireModeration: true,
  maxDepth: 5,
  closeAfterDays: null,
  spamAutoRejectScore: 0.5,
  maxPerIpPerHour: 10,
};

describe("emptyRowState", () => {
  it("is idle with no error", () => {
    expect(emptyRowState()).toEqual({ busy: false, error: null });
  });
});

describe("truncate", () => {
  it("passes short text through unchanged", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("clips and appends an ellipsis once text exceeds max", () => {
    expect(truncate("this is a long comment body", 10)).toBe("this is a …");
  });

  it("does not truncate text exactly at the boundary", () => {
    expect(truncate("1234567890", 10)).toBe("1234567890");
  });
});

describe("describeModerationError", () => {
  it("REQ-07: a 409 with a numeric currentVersion gets the stale-version message including it", () => {
    const err = new ApiError("conflict", 409, "STALE_VERSION", { currentVersion: 7 });
    expect(describeModerationError(err)).toBe(
      "This comment changed since you loaded it (current version 7) — refresh and try again.",
    );
  });

  it("a 409 with no currentVersion in the body omits the parenthetical", () => {
    const err = new ApiError("conflict", 409, "STALE_VERSION", {});
    expect(describeModerationError(err)).toBe("This comment changed since you loaded it — refresh and try again.");
  });

  it("a 409 with a non-numeric currentVersion omits the parenthetical", () => {
    const err = new ApiError("conflict", 409, "STALE_VERSION", { currentVersion: "seven" });
    expect(describeModerationError(err)).toBe("This comment changed since you loaded it — refresh and try again.");
  });

  it("any other status falls through to the shared default", () => {
    expect(describeModerationError(new ApiError("nope", 403, "FORBIDDEN"))).toBe("nope");
    expect(describeModerationError(new Error("boom"))).toBe("boom");
    expect(describeModerationError("not an error")).toBe("Failed to update comment.");
  });
});

describe("commentRowMenuItems", () => {
  const FULL_PERMISSIONS = ["comments.moderate", "comments.delete", "comments.delete.force"];
  const handlers = { onModerate: vi.fn(), onRequestPurge: vi.fn() };

  it("a pending comment with full permissions offers Approve/Spam/Trash, no Restore/Purge", () => {
    const items = commentRowMenuItems(COMMENT, { permissions: FULL_PERMISSIONS, currentFilterStatus: "pending" }, handlers, "en");
    expect(items.map((i) => i.key)).toEqual(["approve", "spam", "trash"]);
  });

  it("a spam comment offers Restore instead of Spam, still no Purge outside the trash filter", () => {
    const items = commentRowMenuItems(
      { ...COMMENT, status: "spam" },
      { permissions: FULL_PERMISSIONS, currentFilterStatus: "spam" },
      handlers,
      "en",
    );
    expect(items.map((i) => i.key)).toEqual(["approve", "trash", "restore"]);
  });

  it("REQ-06: Purge only appears when both the comment AND the active filter are trash", () => {
    const trashedButWrongFilter = commentRowMenuItems(
      { ...COMMENT, status: "trash" },
      { permissions: FULL_PERMISSIONS, currentFilterStatus: "pending" },
      handlers,
      "en",
    );
    expect(trashedButWrongFilter.some((i) => i.key === "purge")).toBe(false);

    const trashedUnderTrashFilter = commentRowMenuItems(
      { ...COMMENT, status: "trash" },
      { permissions: FULL_PERMISSIONS, currentFilterStatus: "trash" },
      handlers,
      "en",
    );
    const purge = trashedUnderTrashFilter.find((i) => i.key === "purge");
    expect(purge).toBeDefined();
    expect(purge?.destructive).toBe(true);
  });

  it("withholds every item the caller lacks permission for", () => {
    const items = commentRowMenuItems(COMMENT, { permissions: [], currentFilterStatus: "pending" }, handlers, "en");
    expect(items).toEqual([]);
  });

  it("withholds Purge without comments.delete.force even under the trash filter on a trashed comment", () => {
    const items = commentRowMenuItems(
      { ...COMMENT, status: "trash" },
      { permissions: ["comments.moderate", "comments.delete"], currentFilterStatus: "trash" },
      handlers,
      "en",
    );
    expect(items.some((i) => i.key === "purge")).toBe(false);
  });

  it("wires onSelect through to the passed handlers", () => {
    handlers.onModerate.mockClear();
    handlers.onRequestPurge.mockClear();
    const items = commentRowMenuItems(COMMENT, { permissions: FULL_PERMISSIONS, currentFilterStatus: "pending" }, handlers, "en");
    items.find((i) => i.key === "approve")?.onSelect();
    expect(handlers.onModerate).toHaveBeenCalledWith(COMMENT, "approve");
    for (const action of ["spam", "trash"] as const) {
      handlers.onModerate.mockClear();
      items.find((i) => i.key === action)!.onSelect();
      expect(handlers.onModerate).toHaveBeenCalledExactlyOnceWith(COMMENT, action);
      expect(handlers.onRequestPurge).not.toHaveBeenCalled();
    }

    const trashed = { ...COMMENT, status: "trash" as const };
    const trashItems = commentRowMenuItems(trashed, { permissions: FULL_PERMISSIONS, currentFilterStatus: "trash" }, handlers, "en");
    handlers.onModerate.mockClear();
    trashItems.find((i) => i.key === "restore")!.onSelect();
    expect(handlers.onModerate).toHaveBeenCalledExactlyOnceWith(trashed, "restore");
    expect(handlers.onRequestPurge).not.toHaveBeenCalled();

    handlers.onModerate.mockClear();
    trashItems.find((i) => i.key === "purge")!.onSelect();
    expect(handlers.onRequestPurge).toHaveBeenCalledExactlyOnceWith(trashed);
    expect(handlers.onModerate).not.toHaveBeenCalled();
  });

  it("translates labels to Spanish when locale is es", () => {
    const items = commentRowMenuItems(COMMENT, { permissions: FULL_PERMISSIONS, currentFilterStatus: "pending" }, handlers, "es");
    expect(items.map((i) => i.label)).toEqual(["Aprobar", "Spam", "Papelera"]);
  });
});

describe("buildSettingsPatch", () => {
  function form(fields: Record<string, string | undefined>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) fd.set(key, value);
    }
    return fd;
  }

  it("returns an empty patch when nothing changed", () => {
    const patch = buildSettingsPatch({
      form: form({ enabled: "on", requireModeration: "on", maxDepth: "5", closeAfterDays: "", spamAutoRejectScore: "0.5", maxPerIpPerHour: "10" }),
      current: SETTINGS,
    });
    expect(patch).toEqual({});
  });

  it("includes only the fields that changed", () => {
    const patch = buildSettingsPatch({
      form: form({ enabled: "", requireModeration: "on", maxDepth: "5", closeAfterDays: "", spamAutoRejectScore: "0.5", maxPerIpPerHour: "10" }),
      current: SETTINGS,
    });
    expect(patch).toEqual({ enabled: false });
  });

  it("REQ-10: a blank closeAfterDays maps to null on the wire, not the backend's -1 sentinel", () => {
    const patch = buildSettingsPatch({
      form: form({ enabled: "on", requireModeration: "on", maxDepth: "5", closeAfterDays: "", spamAutoRejectScore: "0.5", maxPerIpPerHour: "10" }),
      current: { ...SETTINGS, closeAfterDays: 30 },
    });
    expect(patch.closeAfterDays).toBeNull();
  });

  it("a positive closeAfterDays is sent as a number", () => {
    const patch = buildSettingsPatch({
      form: form({ enabled: "on", requireModeration: "on", maxDepth: "5", closeAfterDays: "14", spamAutoRejectScore: "0.5", maxPerIpPerHour: "10" }),
      current: SETTINGS,
    });
    expect(patch.closeAfterDays).toBe(14);
  });

  it("ignores a non-numeric maxDepth/spamAutoRejectScore/maxPerIpPerHour rather than sending NaN", () => {
    const patch = buildSettingsPatch({
      form: form({
        enabled: "on",
        requireModeration: "on",
        maxDepth: "not-a-number",
        closeAfterDays: "",
        spamAutoRejectScore: "not-a-number",
        maxPerIpPerHour: "not-a-number",
      }),
      current: SETTINGS,
    });
    expect(patch.maxDepth).toBeUndefined();
    expect(patch.spamAutoRejectScore).toBeUndefined();
    expect(patch.maxPerIpPerHour).toBeUndefined();
  });

  it("a blank numeric field (maxDepth) is left out of the patch rather than coerced to 0", () => {
    const patch = buildSettingsPatch({
      form: form({ enabled: "on", requireModeration: "on", maxDepth: "", closeAfterDays: "", spamAutoRejectScore: "0.5", maxPerIpPerHour: "10" }),
      current: SETTINGS,
    });
    expect(patch.maxDepth).toBeUndefined();
  });

  it("includes every changed numeric field together", () => {
    const patch = buildSettingsPatch({
      form: form({ enabled: "on", requireModeration: "on", maxDepth: "8", closeAfterDays: "", spamAutoRejectScore: "0.9", maxPerIpPerHour: "25" }),
      current: SETTINGS,
    });
    expect(patch).toEqual({ maxDepth: 8, spamAutoRejectScore: 0.9, maxPerIpPerHour: 25 });
  });
});

describe("parseOptionalNumber", () => {
  it("treats a blank string as no opinion", () => {
    expect(parseOptionalNumber("")).toBeUndefined();
  });

  it("treats a non-numeric string as no opinion", () => {
    expect(parseOptionalNumber("not-a-number")).toBeUndefined();
  });

  it("parses a numeric string, including 0 and negatives", () => {
    expect(parseOptionalNumber("8")).toBe(8);
    expect(parseOptionalNumber("0")).toBe(0);
    expect(parseOptionalNumber("-3")).toBe(-3);
  });
});

describe("parseCloseAfterDays", () => {
  it("REQ-10: a blank (or whitespace-only) raw value is null — never closes", () => {
    expect(parseCloseAfterDays("")).toBeNull();
    expect(parseCloseAfterDays("   ")).toBeNull();
  });

  it("a non-numeric raw value is undefined — no opinion, not a patch value", () => {
    expect(parseCloseAfterDays("not-a-number")).toBeUndefined();
  });

  it("parses a positive numeric string", () => {
    expect(parseCloseAfterDays("14")).toBe(14);
  });
});

describe("validateSettingsPatch", () => {
  it("is null (valid) when spamAutoRejectScore is absent from the patch", () => {
    expect(validateSettingsPatch({})).toBeNull();
  });

  it("is null for an in-range spamAutoRejectScore", () => {
    expect(validateSettingsPatch({ spamAutoRejectScore: 0 })).toBeNull();
    expect(validateSettingsPatch({ spamAutoRejectScore: 1 })).toBeNull();
    expect(validateSettingsPatch({ spamAutoRejectScore: 0.5 })).toBeNull();
  });

  it("rejects a spamAutoRejectScore outside [0, 1]", () => {
    expect(validateSettingsPatch({ spamAutoRejectScore: -0.1 })).toBe(
      "Spam auto-reject score must be between 0 and 1.",
    );
    expect(validateSettingsPatch({ spamAutoRejectScore: 1.1 })).toBe(
      "Spam auto-reject score must be between 0 and 1.",
    );
  });
});
