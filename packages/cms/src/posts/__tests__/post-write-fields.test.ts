import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { PostValidationError, type PostRecord } from "../post.js";
import {
  assertOptionalBoolean, assertPostPresentationFields, assertTitleWithinLimit, isJsonObject,
  isValidPostStatus, normalizeFeaturedMediaId, normalizePostAuthor, normalizePublishAt,
  normalizeShowPostAuthor, presentScheduleFields, resolveBodyFields, resolveUpdateBodyFields, savedPostContent,
} from "../post-write-fields.js";
import { mergeExt, runBeforeSaveHook, withCoverPresentation, type BeforeSaveEntryDraft } from "../post-before-save.js";

const row: PostRecord = {
  workspaceId: "site", id: "page-id", slug: "about", title: "About", kind: "page", status: "draft",
  version: 3, updatedAt: "2026-11-20T00:00:00.000Z", bodyFormat: "doc", bodyHtml: null,
  bodyJson: { type: "doc", content: [{ type: "paragraph" }] },
};

it("normalizes offset timestamps and distinguishes omitted from cleared schedules", () => {
  expect(normalizePublishAt({ value: undefined })).toBeUndefined();
  expect(normalizePublishAt({ value: null })).toBeNull();
  expect(normalizePublishAt({ value: "" })).toBeNull();
  expect(normalizePublishAt({ value: "2026-10-12T09:12-07:00" })).toBe("2026-10-12T16:12:00.000Z");
  expect(normalizePublishAt({ value: "2026-10-12T09:12:01.123456+02:30" })).toBe("2026-10-12T06:42:01.123Z");
  expect(normalizePublishAt({ value: "2026-10-12T09:12:01Z" })).toBe("2026-10-12T09:12:01.000Z");
});

it.each([
  { label: "wrong type", value: 42 }, { label: "no timezone", value: "2026-10-12T09:12:01" },
  { label: "invalid date", value: "2026-19-12T09:12:01Z" },
  { label: "trailing junk", value: "2026-10-12T09:12:01Z\n" },
])("refuses publishAt with $label", ({ value }) => {
  assert.throws(() => normalizePublishAt({ value }), { constructor: PostValidationError,
    message: "publishAt must be an ISO 8601 date-time with a timezone offset (e.g. 2026-10-12T09:00:00-07:00 or 2026-10-12T16:00:00Z), or null",
  });
});

it("stores trimmed cover IDs and preserves omission and explicit clearing", () => {
  expect(normalizeFeaturedMediaId({ value: undefined })).toBeUndefined();
  expect(normalizeFeaturedMediaId({ value: null })).toBeNull();
  expect(normalizeFeaturedMediaId({ value: "" })).toBeNull();
  expect(normalizeFeaturedMediaId({ value: "  media-id " })).toBe("media-id");
  expect(normalizeFeaturedMediaId({ value: "x".repeat(200) })).toBe("x".repeat(200));
  expect(presentScheduleFields({ featuredMediaId: null, publishAt: "" })).toEqual({});
  expect(presentScheduleFields({ featuredMediaId: "media-id", publishAt: "2026-12-01T00:00:00.000Z" })).toEqual({
    featuredMediaId: "media-id", publishAt: "2026-12-01T00:00:00.000Z",
  });
});

it.each([{ label: "object", value: {} }, { label: "spaces", value: "   " }, { label: "201 characters", value: "x".repeat(201) }])(
  "refuses a featured ID consisting of $label", ({ value }) => {
    assert.throws(() => normalizeFeaturedMediaId({ value }), { constructor: PostValidationError, message: "featuredMediaId must be a media asset id (1-200 characters) or null" });
  },
);

it("validates display credits and keeps the byline flag tri-state", () => {
  expect(normalizePostAuthor({ author: undefined })).toBeNull();
  expect(normalizePostAuthor({ author: null })).toBeNull();
  expect(normalizePostAuthor({ author: "  " })).toBeNull();
  expect(normalizePostAuthor({ author: "  Ada  " })).toBe("Ada");
  expect(normalizePostAuthor({ author: "𝄞".repeat(200) })).toBe("𝄞".repeat(200));
  assert.throws(() => normalizePostAuthor({ author: "𝄞".repeat(201) }), { constructor: PostValidationError, message: "author must be at most 200 characters" });
  assert.throws(() => normalizePostAuthor({ author: false }), { constructor: PostValidationError, message: "author must be a string or null" });
  expect(normalizeShowPostAuthor({ showAuthor: undefined })).toBeUndefined();
  expect(normalizeShowPostAuthor({ showAuthor: false })).toBe(false);
  expect(normalizeShowPostAuthor({ showAuthor: true })).toBe(true);
  assert.throws(() => normalizeShowPostAuthor({ showAuthor: "false" }), { constructor: PostValidationError, message: "showAuthor must be a boolean" });
});

it("accepts only the two writer statuses and object bodies", () => {
  expect(["draft", "published", "scheduled", null, {}].map(isValidPostStatus)).toEqual([true, true, false, false, false]);
  expect([{}, { content: [] }, [], null, "doc"].map(isJsonObject)).toEqual([true, true, false, false, false]);
});

it("does not convert a raw HTML page when updating ordinary post fields", () => {
  const replacement = { type: "doc", content: [{ type: "heading" }] };
  const customPage: PostRecord = { ...row, bodyFormat: "html", bodyHtml: " <h2>Original</h2> " };
  expect(resolveBodyFields()).toEqual({ bodyFormat: "doc", bodyHtml: null });
  expect(resolveUpdateBodyFields(row, replacement)).toEqual({ bodyFormat: "doc", bodyHtml: null, bodyJson: replacement });
  expect(resolveUpdateBodyFields(customPage, replacement)).toEqual({
    bodyFormat: "html", bodyHtml: " <h2>Original</h2> ", bodyJson: { type: "doc", content: [{ type: "paragraph" }] },
  });
});

it("enforces title length without rejecting valid boundary values or explicit resets", () => {
  expect([199, 200].map(length => assertTitleWithinLimit({ trimmedTitle: "x".repeat(length) }))).toEqual([undefined, undefined]);
  assert.throws(() => assertTitleWithinLimit({ trimmedTitle: "x".repeat(201) }), { constructor: PostValidationError, message: "title must be 200 characters or fewer" });
  expect(assertPostPresentationFields({})).toBeUndefined();
  expect(assertPostPresentationFields({ templateChoice: null, overridesThemePage: null })).toBeUndefined();
  expect(assertPostPresentationFields({ templateChoice: "", overridesThemePage: false })).toBeUndefined();
  // Simulate values arriving from an untyped request at the domain boundary.
  assert.throws(() => assertPostPresentationFields({ templateChoice: 4 } as unknown as Parameters<typeof assertPostPresentationFields>[0]),
    { constructor: PostValidationError, message: "templateChoice must be a string or null" });
  assert.throws(() => assertOptionalBoolean({ name: "overridesThemePage", value: "false" }), { constructor: PostValidationError, message: "overridesThemePage must be a boolean" });
});

it("compares saved content rather than revision metadata or inactive body columns", () => {
  const draft = {
    title: "About", slug: "about", status: "draft", bodyFormat: "doc", bodyJson: { type: "doc", content: [{ type: "paragraph" }] }, bodyHtml: null,
    templateChoice: null, author: null, showAuthor: false, publishAt: null, featuredMediaId: null, overridesThemePage: null, ext: {},
  };
  expect(savedPostContent({ ...row, version: 40, updatedAt: "later", bodyHtml: "not used" })).toEqual(draft);
  expect(savedPostContent({
    ...row, bodyFormat: "html", bodyHtml: "<p>Published copy</p>", status: "published", templateChoice: "",
    overridesThemePage: false, author: "Ada", showAuthor: true, featuredMediaId: "image-id",
    publishAt: "2026-12-01T00:00:00.000Z", ext: { notes: { reviewed: true } },
  })).toEqual({
    ...draft, bodyFormat: "html", bodyJson: null, bodyHtml: "<p>Published copy</p>", status: "published", templateChoice: "",
    overridesThemePage: false, author: "Ada", showAuthor: true, featuredMediaId: "image-id",
    publishAt: "2026-12-01T00:00:00.000Z", ext: { notes: { reviewed: true } },
  });
});

it("returns the before-save patch and propagates the hook's refusal unchanged", async () => {
  const draft: BeforeSaveEntryDraft = { id: "p", workspaceId: "w", title: "About", slug: "about", status: "draft", bodyJson: row.bodyJson, ext: { old: { value: 1 } } };
  expect(await runBeforeSaveHook({ hook: undefined, draft })).toEqual({});
  const patch = { new: { value: 7 } };
  expect(await runBeforeSaveHook({ draft, hook: async received => {
    expect(received).toEqual(draft);
    return patch;
  } })).toEqual(patch);
  const refusal = new Error("plugin refused this draft");
  await expect(runBeforeSaveHook({ draft, hook: async () => { throw refusal; } })).rejects.toBe(refusal);
});

it("merges plugins by namespace and updates only the cover preference", () => {
  const existingExt = { disabled: { retained: 3 }, plugin: { obsolete: true }, "post-presentation": { layout: "wide", hideCoverImageInBody: true } };
  expect(mergeExt({ existingExt: undefined, patch: {} })).toBeUndefined();
  const merged = mergeExt({ existingExt, patch: { plugin: { score: 9 } } });
  expect(withCoverPresentation({ ext: merged, hideCoverImageInBody: undefined })).toEqual({
    disabled: { retained: 3 }, plugin: { score: 9 }, "post-presentation": { layout: "wide", hideCoverImageInBody: true },
  });
  expect(withCoverPresentation({ ext: merged, hideCoverImageInBody: false })).toEqual({
    disabled: { retained: 3 }, plugin: { score: 9 }, "post-presentation": { layout: "wide", hideCoverImageInBody: false },
  });
  expect(withCoverPresentation({ ext: undefined, hideCoverImageInBody: true })).toEqual({ "post-presentation": { hideCoverImageInBody: true } });
  expect(existingExt["post-presentation"].hideCoverImageInBody).toBe(true);
});
