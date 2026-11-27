import { expect, test } from "vitest";
import { buildPostUpdatePatch, keepNewerEdit, savedPostFields, withEverPublished } from "../post-editor-save.rules.js";
import { loadedPostHandles, type PostFormState } from "../post-editor-state.rules.js";

test("loaded identity survives a new slug; untouched keys stay omitted and explicit clearing survives", () => {
  const post = { id: "persisted-id", slug: "renamed-slug", status: "draft" as const };
  expect(loadedPostHandles({ post, postId: "old-slug", nowMs: 0, isScheduledPost: () => false }).entryId).toBe("persisted-id");
  const original: PostFormState = { title: "Title", slug: "old-slug", status: "draft", bodyJson: {}, templateChoice: "", overridesThemePage: null, publishAt: "2030-01-01T00:00:00Z", featuredMediaId: "media", author: "Credit", showAuthor: true, hideCoverImageInBody: true };
  const working = { ...original, bodyJson: {}, slug: "renamed-slug", followsTitle: false };
  const unchanged = buildPostUpdatePatch({ working, original, expectedVersion: undefined });
  for (const key of ["publishAt", "featuredMediaId", "author", "showAuthor", "hideCoverImageInBody"]) expect(Object.hasOwn(unchanged, key)).toBe(false);
  expect(Object.hasOwn(unchanged, "expectedVersion")).toBe(true);
  expect(unchanged.templateChoice).toBe("");
  expect(buildPostUpdatePatch({ working: { ...working, publishAt: null, featuredMediaId: null, author: "", showAuthor: false, hideCoverImageInBody: false }, original, expectedVersion: 4 })).toMatchObject({ expectedVersion: 4, publishAt: null, featuredMediaId: null, author: null, showAuthor: false, hideCoverImageInBody: false });
});

test("saved row values preserve an explicit cover choice and normalize omitted byline fields", () => {
  expect(savedPostFields({ saved: { slug: "latest", author: null, ext: { "post-presentation": { hideCoverImageInBody: false } } } }))
    .toEqual({ slug: "latest", author: "", showAuthor: false, hideCoverImageInBody: false });
  expect(savedPostFields({ saved: { slug: "latest", author: "A. Writer", showAuthor: true } }))
    .toEqual({ slug: "latest", author: "A. Writer", showAuthor: true, hideCoverImageInBody: true });
});

test("save reconciliation retains publication history across a draft return", () => {
  type Row = { status: "draft" | "published"; everPublished: boolean };
  const draft: Row = { status: "draft", everPublished: false };
  const published: Row = { status: "published", everPublished: false };
  expect(withEverPublished({ previous: null, saved: draft })).toEqual(draft);
  expect(withEverPublished({ previous: null, saved: published }).everPublished).toBe(true);
  expect(withEverPublished({ previous: published, saved: draft }).everPublished).toBe(true);
  expect(withEverPublished({ previous: { ...draft, everPublished: true }, saved: draft }).everPublished).toBe(true);
});

test("save reconciliation updates only the text still matching what was sent", () => {
  const merge = keepNewerEdit({ sent: "my-edited-slug", fromSaved: "my-edited-slug-2" });
  expect(merge("my-edited-slug")).toBe("my-edited-slug-2");
  expect(merge("a-newer-local-edit")).toBe("a-newer-local-edit");
});
