
import { expect, test, vi } from "vitest";
import {
  buildPostAutosaveDraft, isoToLocalDateTimeInput, isScheduledPost, localDateTimeInputToIso,
  postAutosaveStaleBasisMessage, postSlugFollowsTitle, postSlugForTitle, postVersionConflictMessage,
  POST_VERSION_CONFLICT_CODE, resolvePostPreviewBranches,
} from "../post-editor-rules.js";
import { buildPostRowMenuHandleMap, postRowMenuItems } from "../posts-list-rules.js";

test("autosave carries the row version and preserves clearing byline controls without changing live status", () => {
  const bodyJson = { type: "doc", content: [] };
  const fields = { title: "Unsaved title", slug: "unsaved", bodyJson };
  expect(buildPostAutosaveDraft({ version: 5 }, fields)).toEqual({ ...fields, bodyFormat: "doc", baseVersion: 5 });
  expect(buildPostAutosaveDraft({ version: 7 }, { ...fields, author: "", showAuthor: false }))
    .toEqual({ ...fields, bodyFormat: "doc", baseVersion: 7, author: "", showAuthor: false });
});

test("version and autosave conflict copy distinguish an unknown basis from an identified superseded version", () => {
  expect(POST_VERSION_CONFLICT_CODE).toBe("VERSION_CONFLICT");
  expect(postVersionConflictMessage({ expectedVersion: 4, currentVersion: 7, attemptedStatus: "published" }))
    .toBe("Someone else saved this while you were editing — you were working from version 4, and version 7 is now stored. Your changes were NOT saved, and are still here in the editor.");
  expect(postVersionConflictMessage({ expectedVersion: null, currentVersion: null, attemptedStatus: undefined }))
    .toBe("Someone else saved this while you were editing — you were working from the version you loaded, and a newer version is now stored. Your changes were NOT saved, and are still here in the editor.");
  expect(postAutosaveStaleBasisMessage({ baseVersion: 4, draft: { bodyFormat: "doc", bodyJson: {}, baseVersion: 4, title: "Edits", slug: "edits" } }))
    .toBe("Someone else saved this while you were editing — you were working from version 4, so autosaving has paused and nothing you type now is being stored. Your changes were NOT saved, and are still here in the editor. Reload to pick up their version and resume autosaving; copy anything you want to keep first.");
});

test("preview selects exactly one surface based on saved liveness and the kind of edit", () => {
  const published = { status: "published", dirty: false, contentDirty: false } as const;
  const surface = (input: Parameters<typeof resolvePostPreviewBranches>[0]) =>
    Object.entries(resolvePostPreviewBranches(input)).filter(([, visible]) => visible).map(([name]) => name);
  expect(surface(published)).toEqual(["canShowLiveSite"]);
  expect(surface({ ...published, dirty: true })).toEqual(["canShowTemplatePreview"]);
  expect(surface({ ...published, dirty: true, contentDirty: true })).toEqual(["canShowPendingContentPreview"]);
  expect(surface({ ...published, scheduled: true })).toEqual(["canShowPendingContentPreview"]);
  expect(surface({ ...published, status: "draft" })).toEqual(["canShowPendingContentPreview"]);
});

test("schedule input round-trips the local minute and only future published rows are scheduled", () => {
  const local = new Date(2031, 1, 3, 4, 5, 49);
  expect(isoToLocalDateTimeInput({ iso: local.toISOString() })).toBe("2031-02-03T04:05");
  expect(isoToLocalDateTimeInput({ iso: null })).toBe("");
  expect(isoToLocalDateTimeInput({ iso: "not-a-date" })).toBe("");
  const minute = new Date(2031, 1, 3, 4, 5, 0);
  expect(localDateTimeInputToIso({ value: "2031-02-03T04:05" })).toBe(minute.toISOString());
  expect(localDateTimeInputToIso({ value: " " })).toBeNull();
  expect(localDateTimeInputToIso({ value: "not-a-date" })).toBeNull();
  const publishAt = minute.toISOString();
  expect(isScheduledPost({ input: { status: "published", publishAt }, nowMs: minute.getTime() - 1 })).toBe(true);
  expect(isScheduledPost({ input: { status: "published", publishAt }, nowMs: minute.getTime() })).toBe(false);
  expect(isScheduledPost({ input: { status: "draft", publishAt }, nowMs: minute.getTime() - 1 })).toBe(false);
  expect(isScheduledPost({ input: { status: "published", publishAt: null }, nowMs: minute.getTime() - 1 })).toBe(false);
});

test("only automatic never-published post slugs follow the title", () => {
  const post = { kind: "post", status: "draft", title: "Launch Photos", slug: "launch-photos-2" } as const;
  expect(postSlugForTitle({ title: "Launch Photos" })).toBe("launch-photos");
  expect(postSlugFollowsTitle({ post })).toBe(true);
  expect(postSlugFollowsTitle({ post, manuallyEdited: true })).toBe(false);
  expect(postSlugFollowsTitle({ post: { ...post, slug: "manual" } })).toBe(false);
  expect(postSlugFollowsTitle({ post: { ...post, everPublished: true } })).toBe(false);
  expect(postSlugFollowsTitle({ post: { ...post, status: "published" } })).toBe(false);
  expect(postSlugFollowsTitle({ post: { ...post, kind: "page" } })).toBe(false);
});

test("each row menu localizes actions and sends the selected row to the corresponding callback", () => {
  const handlers = { onEdit: vi.fn(), onTogglePublish: vi.fn(), onDelete: vi.fn() };
  const draft = { id: "draft-17", status: "draft" } as const;
  const live = { id: "live-9", status: "published" } as const;
  const shared = { handlers, locale: "es", translate: ({ locale, key }: { locale: string; key: string }) => `${locale}/${key}` };
  const row = postRowMenuItems({ ...shared, post: draft });
  expect(row.map(({ key, label, destructive }) => [key, label, destructive])).toEqual([
    ["edit", "es/Edit", undefined], ["publish", "es/Publish", undefined], ["delete", "es/Delete", true],
  ]);
  const active = postRowMenuItems({ ...shared, post: live });
  expect(active.map(({ key, label }) => [key, label])).toEqual([["edit", "es/Edit"], ["unpublish", "es/Unpublish"], ["delete", "es/Delete"]]);
  for (const item of row) item.onSelect();
  active.find(({ key }) => key === "unpublish")?.onSelect();
  expect(handlers.onEdit).toHaveBeenCalledExactlyOnceWith({ post: draft });
  expect(handlers.onTogglePublish.mock.calls).toEqual([[draft], [live]]);
  expect(handlers.onDelete).toHaveBeenCalledExactlyOnceWith(draft);
});

test("row handles remain distinct when ids normalize to the same slug and are indexed by original id", () => {
  expect(buildPostRowMenuHandleMap({ posts: null })).toEqual(new Map());
  const map = buildPostRowMenuHandleMap({ posts: [{ id: "Entry B" }, { id: "entry-b" }, { id: "Entry A" }] });
  expect([...map.entries()]).toEqual([["Entry B", "posts-row-entry-b"], ["entry-b", "posts-row-entry-b-2"], ["Entry A", "posts-row-entry-a"]]);
});
