
import { expect, test, vi } from "vitest";
import { loadedPostForm, loadedPostHandles, postFormSnapshot, resolveActivePostTheme, resolveEditorSlug } from "../post-editor-state.rules.js";
import { postSlugFollowsTitle, postSlugForTitle } from "../../post-editor-rules.js";

test("theme capabilities are taken from the active id, or absent when that theme disappeared", () => {
  const availableThemes = [{ id: "base", tier: "static" }, { id: "chosen", tier: "code", apiVersion: 2 }] as const;
  const presentation = { settings: { activeThemeId: "chosen" }, availableThemes: [...availableThemes] };
  expect(resolveActivePostTheme({ presentation })).toEqual({ activeThemeId: "chosen", activeThemeTier: "code", activeThemeApiVersion: 2 });
  expect(resolveActivePostTheme({ presentation: { ...presentation, settings: { activeThemeId: "uninstalled" } } }))
    .toEqual({ activeThemeId: "uninstalled", activeThemeTier: null, activeThemeApiVersion: undefined });
});

test("load normalizes minute precision, theme defaults and the saved controls without making the editor dirty", () => {
  const post = { title: "Local time", slug: "local-time", status: "draft" } as const;
  const isoToLocalDateTimeInput = vi.fn(({ iso }: { iso: string | null | undefined }) => iso === undefined ? "" : "2031-02-03T14:05");
  const localDateTimeInputToIso = vi.fn(({ value }: { value: string }) => value === "" ? null : "2031-02-03T12:05:00.000Z");
  const load = { activeThemeTemplates: ["article", "alternate"], isoToLocalDateTimeInput, localDateTimeInputToIso };
  const defaultFields = loadedPostForm({ ...load, post });
  expect(defaultFields).toEqual({
    title: "Local time", slug: "local-time", status: "draft", templateChoice: "article", overridesThemePage: null,
    publishAt: null, featuredMediaId: null, author: "", showAuthor: false, hideCoverImageInBody: true,
  });
  expect(loadedPostForm({ ...load, post, activeThemeTemplates: [] }).templateChoice).toBeNull();
  const fields = loadedPostForm({ ...load, post: {
    ...post, templateChoice: "alternate", overridesThemePage: false, publishAt: "2031-02-03T12:05:49.000Z",
    featuredMediaId: "library-1", author: "Writer", showAuthor: true, ext: { "post-presentation": { hideCoverImageInBody: false } },
  } });
  expect(isoToLocalDateTimeInput).toHaveBeenLastCalledWith({ iso: "2031-02-03T12:05:49.000Z" });
  expect(localDateTimeInputToIso).toHaveBeenLastCalledWith({ value: "2031-02-03T14:05" });
  expect(JSON.stringify(postFormSnapshot({ fields, bodyJson: { type: "doc" } }))).toBe(JSON.stringify({
    title: "Local time", slug: "local-time", status: "draft", bodyJson: { type: "doc" },
    templateChoice: "alternate", overridesThemePage: false, publishAt: "2031-02-03T12:05:00.000Z",
    featuredMediaId: "library-1", author: "Writer", showAuthor: true, hideCoverImageInBody: false,
  }));
});

test("slug preview derives for fresh and renamed automatic drafts but preserves the stored suffix or a manual choice", () => {
  const post = { id: "post-1", kind: "post", status: "draft", title: "A post", slug: "a-post-2" } as const;
  const input = { post, title: "A post", storedSlug: "a-post-2", slugEdited: false, postSlugForTitle, postSlugFollowsTitle };
  expect(resolveEditorSlug(input)).toEqual({ followsTitle: true, slug: "a-post-2" });
  expect(resolveEditorSlug({ ...input, title: "A new post" })).toEqual({ followsTitle: true, slug: "a-new-post" });
  expect(resolveEditorSlug({ ...input, slugEdited: true, storedSlug: "manual" })).toEqual({ followsTitle: false, slug: "manual" });
  expect(resolveEditorSlug({ ...input, post: null })).toEqual({ followsTitle: false, slug: "a-post-2" });
  expect(resolveEditorSlug({ ...input, post: { ...post, id: "" }, title: " " })).toEqual({ followsTitle: true, slug: "" });
  expect(resolveEditorSlug({ ...input, post: { ...post, id: "" }, title: "A new post" })).toEqual({ followsTitle: true, slug: "a-new-post" });
});

test("preview and write targets use a loaded row id and forward the scheduler’s exact input", () => {
  const isScheduledPost = vi.fn(() => true);
  const input = { postId: "old-slug", nowMs: 20, isScheduledPost };
  expect(loadedPostHandles({ ...input, post: null }))
    .toEqual({ entryId: "old-slug", loadedId: null, scheduled: false, previewFormTarget: "" });
  expect(loadedPostHandles({ ...input, post: { id: "", status: "draft" } }))
    .toEqual({ entryId: "old-slug", loadedId: null, scheduled: false, previewFormTarget: "" });
  expect(isScheduledPost).not.toHaveBeenCalled();
  expect(loadedPostHandles({ ...input, post: { id: "row-17", status: "published", publishAt: "2031-02-03T12:05:00Z" } }))
    .toEqual({ entryId: "row-17", loadedId: "row-17", scheduled: true, previewFormTarget: "post-preview-pending-row-17" });
  expect(isScheduledPost).toHaveBeenCalledExactlyOnceWith({ input: { status: "published", publishAt: "2031-02-03T12:05:00Z" }, nowMs: 20 });
});
