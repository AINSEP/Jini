import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { ToolInputError } from "@jini-ai/core";
import { reclassifyToolError } from "@jini-ai/core/model-facing-tool-errors";
import { expect, it, vi } from "vitest";
import { ForbiddenError } from "../../core/index.js";
import { EMAIL_TEMPLATE_KIND } from "../post.js";
import { PostConflictError, PostNotFoundError, PostValidationError, PostVersionConflictError } from "@jini-ai/cms/posts/post";
// post-tool-errors.ts classifies by `instanceof` against its relative `./post.js` import (src), while the
// tool modules throw the self-named (built) classes; each test builds errors from the module its unit uses.
import * as postSource from "../post.js";
import { assertFreshVersion, loadDeletablePost } from "../post-tool-delete.js";
import type { PostToolDeps } from "../post-tool-deps.js";
import { isPostShapeRejection, POST_MODEL_FACING_ERRORS } from "../post-tool-errors.js";
import { optionalBodyJson, optionalNonEmptyString, optionalPostStatus, optionalPublishAt, requireBodyJson, requirePostKind, requirePostStatus } from "../post-tool-input.js";
import { clampPostListLimit, excerptCharsFor, matchesPostListFilters, optionalPostListFields, projectPostListRow, toPostListRow } from "../post-tool-list.js";
import { assertHtmlBodyUnchanged, assertPatchNotEmpty, assertTemplateAvailable, isPartialPatch, loadUpdateTarget, mergeUpdatePatch, parseUpdatePatch, updateInverse } from "../post-tool-update.js";
import { resolveAdminUrl, toPostToolViewWithPublicUrl, toPostWriteResultView, type PostToolViewDeps } from "../post-tool-views.js";
import { NOW, WORKSPACE, postRepo, postRow } from "./post-coverage.fixture.js";

const post = postRow({ title: "Concert Notes", slug: "music-reviews", author: "Jo", showAuthor: true });
const page = postRow({ id: "page-id", kind: "page", title: "Front page", slug: "/", status: "published" });
const internal = postRow({ id: "template-id", kind: EMAIL_TEMPLATE_KIND });
const trash = postRow({ id: "trashed-id", deletedAt: NOW });
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "one two three" }] }] };

function viewDeps(mode: "production" | "local" = "local"): PostToolViewDeps {
  return {
    workspaceId: WORKSPACE, runtimeMode: () => mode, publishedWhere: { local: "Local copy", live: "Live newsroom" },
    entryPublicPath: ({ post: p, ctx }) => ctx.workspaceId === WORKSPACE && p.status === "published"
      ? { path: "/show/alias", canonicalUrl: "https://news.example/show/alias" } : null,
  };
}
function depsForTools() {
  const readPostTemplateOptions = vi.fn<PostToolDeps["readPostTemplateOptions"]>(async ({ kind }) => kind === "page" ? ["page.html", "landing.html"] : ["article.html"]);
  // These boundary helpers consume only the supplied slice of their host bag.
  const slice = { postRepo: postRepo([post, page, internal, trash, postRow({ id: "foreign", workspaceId: "elsewhere" })]),
    workspaceId: WORKSPACE, readPostTemplateOptions, postToolViewDeps: () => viewDeps() };
  return { routeDeps: slice as unknown as PostToolDeps, readPostTemplateOptions };
}

it("loads the requested public target for deletion and refuses missing, wrong-kind, or trashed rows", async () => {
  const { routeDeps } = depsForTools();
  expect(await loadDeletablePost({ routeDeps, id: "page-id" })).toEqual(page);
  expect(await loadDeletablePost({ routeDeps, id: "page-id" }, { kind: "page" })).toEqual(page);
  expect(await loadDeletablePost({ routeDeps, id: "post-id" }, { kind: "post" })).toEqual(post);
  await assert.rejects(loadDeletablePost({ routeDeps, id: "post-id" }, { kind: "page" }),
    { constructor: PostNotFoundError, message: "page 'post-id' was not found" });
  for (const id of ["missing", "template-id", "trashed-id", "foreign"]) {
    await assert.rejects(loadDeletablePost({ routeDeps, id }), { constructor: PostNotFoundError, message: `post '${id}' was not found` });
  }
});

it("requires a fresh deletion confirmation only when a live row changed versions", () => {
  const input = { existing: page, kind: "page" as const };
  expect(assertFreshVersion({ ...input, current: page })).toBeUndefined();
  expect(assertFreshVersion({ ...input, current: null })).toBeUndefined();
  expect(assertFreshVersion({ ...input, current: { ...page, version: 7, deletedAt: NOW } })).toBeUndefined();
  assert.throws(() => assertFreshVersion({ ...input, current: { ...page, version: 7 } }), {
    constructor: ToolInputError,
    message: "CONTENT_POST_STALE_CONFIRMATION: content_post_delete: the removal could not be completed (stale-entity-version). The page changed between its read and removal. Nothing was deleted. Call content_post_delete again with { id, kind } to raise a fresh dialog against the current version.",
  });
});

it("only decorates shape rejections and sends model-facing error codes with the actionable reason", () => {
  const shape = new postSource.PostValidationError("title is empty");
  const version = new postSource.PostVersionConflictError({ message: "expected 4, found 6", expectedVersion: 4, currentVersion: 6 });
  const conflict = new postSource.PostConflictError("slug 'notes' already exists");
  const missing = new postSource.PostNotFoundError("post 'notes' was not found");
  const forbidden = new ForbiddenError({ message: "content.write denied", permission: "content.write", reason: "no_grant" });
  expect([shape, version, conflict, missing, forbidden, null].map(error => isPostShapeRejection({ error })))
    .toEqual([true, false, false, false, false, false]);
  const convert = (err: unknown) => reclassifyToolError({ err, rules: POST_MODEL_FACING_ERRORS });
  for (const [err, message] of [
    [shape, "CONTENT_POST_VALIDATION_FAILED: title is empty"],
    [conflict, "CONTENT_POST_CONFLICT: slug 'notes' already exists"],
    [missing, "CONTENT_POST_NOT_FOUND: post 'notes' was not found"],
    [forbidden, "CONTENT_POST_FORBIDDEN: content.write denied"],
    [version, "VERSION_CONFLICT: expected 4, found 6. Someone else saved this post after you read it, so your edit was NOT applied and nothing was overwritten. Re-read the post with content_post_get, reapply your change on top of the body you get back, and resend with that row's `version` as `expectedVersion`. Do not resend this call unchanged."],
  ] as const) {
    expect(convert(err)).toBeInstanceOf(ToolInputError);
    expect(convert(err)).toMatchObject({ message });
  }
  const unclassified = new Error("private storage failure");
  const alreadyTyped = new ToolInputError({ message: "schema rejected the title" });
  expect(convert(unclassified)).toBe(unclassified);
  expect(convert(alreadyTyped)).toBe(alreadyTyped);
});

it.each([undefined, null, 0, true, "", "  ", "POST", "email-template", {}, ["post"]].map(value => ({ value })))(
  "rejects unrecognized post kind $value", ({ value }) =>
    assert.throws(() => requirePostKind({ kind: value }), { constructor: ToolInputError, message: "'kind' must be exactly 'post' or 'page'" }),
);

it.each([null, 0, true, "", "  ", "DRAFT", "scheduled", {}, ["published"]].map(value => ({ value })))(
  "rejects invalid present post status $value", ({ value }) =>
    assert.throws(() => optionalPostStatus({ status: value }), { constructor: ToolInputError, message: "'status' must be exactly 'draft' or 'published'" }),
);

it("retains admitted kinds and statuses and distinguishes an omitted optional status", () => {
  expect(requirePostKind({ kind: "post" })).toBe("post");
  expect(requirePostKind({ kind: "page" })).toBe("page");
  expect(requirePostStatus({ status: "draft" })).toBe("draft");
  expect(optionalPostStatus({ status: "published" })).toBe("published");
  expect(optionalPostStatus({})).toBeUndefined();
  assert.throws(() => requirePostStatus({}), { constructor: ToolInputError, message: "'status' must be exactly 'draft' or 'published'" });
});

it.each([null, 0, true, "doc", ["paragraph"]].map(value => ({ value })))(
  "rejects malformed present body $value", ({ value }) =>
    assert.throws(() => optionalBodyJson({ input: { bodyJson: value }, key: "bodyJson" }), { constructor: ToolInputError, message: "'bodyJson' (object) is required" }),
);

it("preserves optional body, string, and publish time omission instead of clearing the record", () => {
  expect(optionalBodyJson({ input: {}, key: "bodyJson" })).toBeUndefined();
  expect(requireBodyJson({ input: { bodyJson: body }, key: "bodyJson" })).toEqual(body);
  assert.throws(() => requireBodyJson({ input: { title: "Example" }, key: "bodyJson" }), { constructor: ToolInputError, message: "'bodyJson' (object) is required; received: title" });
  expect(optionalNonEmptyString({ input: {}, key: "title" })).toBeUndefined();
  expect(optionalNonEmptyString({ input: { title: "  Credit  " }, key: "title" })).toBe("  Credit  ");
  assert.throws(() => optionalNonEmptyString({ input: { title: "" }, key: "title" }), { constructor: ToolInputError, message: "'title' (non-empty string) is required" });
  expect(optionalPublishAt({})).toBeUndefined();
  expect(optionalPublishAt({ publishAt: null })).toBeNull();
  expect(optionalPublishAt({ publishAt: "2026-11-25T10:30:00-08:00" })).toBe("2026-11-25T18:30:00.000Z");
});

it("keeps explicit clears in an update patch and fills only omitted core fields", () => {
  const patch = parseUpdatePatch({ title: "New title", author: null, template: "", showAuthor: false, publishAt: null });
  expect(patch).toEqual({ title: "New title", slug: undefined, bodyJson: undefined, status: undefined,
    author: null, showAuthor: false, templateChoice: "", publishAt: null });
  expect(isPartialPatch(patch)).toBe(true);
  expect(mergeUpdatePatch({ patch, existing: post })).toEqual({ title: "New title", slug: "music-reviews", bodyJson: post.bodyJson, status: "draft" });
  const full = { title: "Full replacement", slug: "new-slug", status: "published", bodyJson: body } as const;
  expect(isPartialPatch(parseUpdatePatch({ ...full, author: "  Credit  " }))).toBe(false);
  expect(mergeUpdatePatch({ patch: parseUpdatePatch(full), existing: post })).toEqual(full);
  for (const key of ["title", "slug", "bodyJson", "status"] as const) {
    expect(isPartialPatch(parseUpdatePatch({ ...full, [key]: undefined }))).toBe(true);
  }
  assert.throws(() => assertPatchNotEmpty({ patch: parseUpdatePatch({}), featuredMediaId: undefined }), {
    constructor: ToolInputError,
    message: "content_post_update: send at least one of title, slug, bodyJson, status, publishAt, featuredImage, author, showAuthor or template. Nothing was changed.",
  });
  expect(assertPatchNotEmpty({ patch: parseUpdatePatch({}), featuredMediaId: null })).toBeUndefined();
  expect(assertPatchNotEmpty({ patch: parseUpdatePatch({ showAuthor: false }), featuredMediaId: undefined })).toBeUndefined();
});

it("validates template input and checks a named file only against templates for the chosen kind", async () => {
  assert.throws(() => parseUpdatePatch({ template: true }), { constructor: ToolInputError,
    message: "content_post_update: template must be a filename from content_post_preview.availableTemplates, an empty string for no template, or null to reset the choice. Nothing was changed." });
  const { routeDeps, readPostTemplateOptions } = depsForTools();
  for (const templateChoice of [undefined, null, ""]) await assertTemplateAvailable({ routeDeps, templateChoice, kind: "page" });
  expect(readPostTemplateOptions).not.toHaveBeenCalled();
  await assertTemplateAvailable({ routeDeps, templateChoice: "landing.html", kind: "page" });
  await assert.rejects(assertTemplateAvailable({ routeDeps, templateChoice: "article.html", kind: "page" }), {
    constructor: ToolInputError,
    message: 'content_post_update: template \'article.html\' is not available for this page in the active theme. Valid templates: ["page.html","landing.html"]. Use one of these filenames, an empty string for no template, or null to reset the choice. Nothing was changed.',
  });
  expect(readPostTemplateOptions.mock.calls).toEqual([[{ deps: routeDeps, kind: "page" }], [{ deps: routeDeps, kind: "page" }]]);
});

it("updates public records by scope while retaining the documented explicit-page kind check", async () => {
  const { routeDeps } = depsForTools();
  expect(await loadUpdateTarget({ routeDeps, id: "page-id", kind: undefined })).toEqual(page);
  expect(await loadUpdateTarget({ routeDeps, id: "page-id", kind: "post" })).toEqual(page);
  await assert.rejects(loadUpdateTarget({ routeDeps, id: "post-id", kind: "page" }), { constructor: PostNotFoundError, message: "page 'post-id' was not found" });
  for (const id of ["foreign", "template-id", "missing"]) {
    await assert.rejects(loadUpdateTarget({ routeDeps, id, kind: undefined }), { constructor: PostNotFoundError, message: `post '${id}' was not found` });
  }
});

it("blocks a real body change to bespoke HTML but permits a structurally equal round trip", () => {
  const existing = { ...page, bodyFormat: "html" as const, bodyHtml: "<p>Actual HTML</p>" };
  const input = { id: "page-id", existing, isDeepStrictEqual, contentPostReadToolId: "read_content" };
  expect(assertHtmlBodyUnchanged({ ...input, bodyJson: { type: "doc", content: [] } })).toBeUndefined();
  expect(assertHtmlBodyUnchanged({ ...input, existing: page, bodyJson: body })).toBeUndefined();
  assert.throws(() => assertHtmlBodyUnchanged({ ...input, bodyJson: body }), {
    constructor: ToolInputError,
    message: "CONTENT_POST_HTML_BODY: page 'page-id' is a bespoke-HTML page, so bodyJson can't change its body. To edit its title, slug or status, send bodyJson back exactly as read_content returned it. To change the body, use pages_write_html or pages_write_region.",
  });
});

it("records pre-edit presentation and only captures a template when a change was requested", () => {
  const existing = { ...post, publishAt: NOW, featuredMediaId: "cover", templateChoice: "" };
  const baseline = { title: "Concert Notes", slug: "music-reviews", bodyJson: { type: "doc", content: [] }, status: "draft", author: "Jo", showAuthor: true };
  expect(updateInverse({ existing, templateChoice: null })).toEqual({ ...baseline, publishAt: NOW, featuredMediaId: "cover", templateChoice: "" });
  expect(updateInverse({ existing, templateChoice: undefined })).toEqual({ ...baseline, publishAt: NOW, featuredMediaId: "cover" });
  expect(updateInverse({ existing: postRow(), templateChoice: "article.html" })).toEqual({
    title: "Default article", slug: "default-article", bodyJson: { type: "doc", content: [] }, status: "draft",
    author: null, showAuthor: false, publishAt: null, featuredMediaId: null, templateChoice: null,
  });
});

it("applies listing defaults, floors fractional limits, and preserves a text floor on large results", () => {
  expect([undefined, -1, 0, 1, 8.9, 199, 200, 201].map(limit => clampPostListLimit({ limit }))).toEqual([50, 1, 1, 1, 8, 199, 200, 200]);
  expect([0, 1, 7, 50, 100, 101, 200].map(rowCount => excerptCharsFor({ rowCount }))).toEqual([30_000, 30_000, 4285, 600, 300, 300, 300]);
});

it("requires both listing filters and matches title or slug without case sensitivity", () => {
  expect(matchesPostListFilters(post, {})).toBe(true);
  expect(matchesPostListFilters(post, { query: "concert", status: "draft" })).toBe(true);
  expect(matchesPostListFilters({ ...post, slug: "Music-Reviews" }, { query: "-reviews" })).toBe(true);
  expect(matchesPostListFilters(post, { query: "concert", status: "published" })).toBe(false);
  expect(matchesPostListFilters(post, { query: "missing" })).toBe(false);
});

it("parses listing fields without leaking unrequested content, always retaining the id", () => {
  const { routeDeps } = depsForTools();
  const row = toPostListRow({ routeDeps, post, excerptChars: 40 });
  expect(optionalPostListFields({ input: {} })).toBeUndefined();
  expect(optionalPostListFields({ input: { fields: " title, slug,title " } })).toEqual(["title", "slug", "title"]);
  expect(optionalPostListFields({ input: { fields: ["slug", "title"] } })).toEqual(["slug", "title"]);
  expect(projectPostListRow({ row, fields: ["title", "slug", "title"] })).toEqual({ id: "post-id", title: "Concert Notes", slug: "music-reviews" });
  expect(projectPostListRow({ row, fields: [] })).toEqual({ id: "post-id" });
  for (const fields of [true, "", "title, bodyJson", ["bodyJson", "title", "slug"], ["title", "bodyJson", "slug"], ["title", "slug", "bodyJson"]]) {
    assert.throws(() => optionalPostListFields({ input: { fields } }), { constructor: ToolInputError,
      message: /content_post_list: fields must be an array or comma-separated string of supported field names/ });
  }
});

it("uses active body format for listing excerpts and marks both soft and hard cuts", () => {
  const { routeDeps } = depsForTools();
  const doc = toPostListRow({ routeDeps, post: { ...post, bodyJson: body }, excerptChars: 30 });
  expect(doc).toEqual({
    id: "post-id", kind: "post", title: "Concert Notes", slug: "music-reviews", status: "draft", updatedAt: "2026-11-24T12:00:00.000Z", version: 4,
    publicUrl: null, adminUrl: "/admin/posts/post-id", excerpt: "one two three", bodyChars: 13, author: "Jo", showAuthor: true,
  });
  const htmlRow = { ...page, bodyFormat: "html" as const, bodyHtml: "<p>123456789  next</p>", bodyJson: body };
  expect(toPostListRow({ routeDeps, post: htmlRow, excerptChars: 10 })).toMatchObject({
    id: "page-id", adminUrl: "/admin/pages/home", publicUrl: "https://news.example/show/alias",
    excerpt: "123456789…", bodyChars: 14, author: null, showAuthor: false,
  });
  expect(toPostListRow({ routeDeps, post: { ...htmlRow, bodyHtml: "<p>abcdefghijklmnopqrstuvwxyz</p>" }, excerptChars: 10 }))
    .toMatchObject({ excerpt: "abcdefghij…", bodyChars: 26 });
  expect(toPostListRow({ routeDeps, post: { ...htmlRow, bodyHtml: null }, excerptChars: 10 }))
    .toMatchObject({ excerpt: "", bodyChars: 0 });
});

it("selects an unambiguous admin editor path for posts, pages, root, and the literal home slug", () => {
  expect(resolveAdminUrl({ post })).toBe("/admin/posts/post-id");
  expect(resolveAdminUrl({ post: page })).toBe("/admin/pages/home");
  expect(resolveAdminUrl({ post: { ...page, slug: "about" } })).toBe("/admin/pages/about");
  expect(resolveAdminUrl({ post: { ...page, slug: "home" } })).toBe("/admin/pages/page-id");
});

it("projects a scheduled record without internal fields and stops calling it scheduled at go-live", () => {
  vi.useFakeTimers();
  try {
    const scheduled = { ...page, bodyJson: body, publishAt: NOW, featuredMediaId: "cover-asset", templateChoice: null,
      seoExtJson: '{"private":true}', ext: { plugin: { secret: true } } };
    const entryPublicPath = vi.fn<PostToolViewDeps["entryPublicPath"]>(() => null);
    const deps = { ...viewDeps(), entryPublicPath };
    vi.setSystemTime(new Date("2026-11-25T11:59:59.999Z"));
    const expected = {
      id: "page-id", kind: "page", title: "Front page", slug: "/", status: "published", version: 4,
      bodyJson: body, updatedAt: "2026-11-24T12:00:00.000Z", author: null, showAuthor: false,
      publishAt: NOW, featuredMediaId: "cover-asset", template: null, publicUrl: null, adminUrl: "/admin/pages/home",
    };
    expect(toPostToolViewWithPublicUrl({ deps, post: scheduled })).toEqual({ ...expected, scheduled: true });
    expect(entryPublicPath).toHaveBeenCalledExactlyOnceWith({ post: scheduled, ctx: { workspaceId: WORKSPACE } });
    vi.setSystemTime(new Date(NOW));
    expect(toPostToolViewWithPublicUrl({ deps, post: scheduled })).toEqual(expected);
  } finally {
    vi.useRealTimers();
  }
});

it("uses the canonical routing URL and reports the destination only on a published write", () => {
  const production = viewDeps("production");
  const local = viewDeps("local");
  const readView = toPostToolViewWithPublicUrl({ deps: production, post: page });
  expect(readView.publicUrl).toBe("https://news.example/show/alias");
  expect(readView).not.toHaveProperty("publishedWhere");
  expect(toPostWriteResultView({ deps: production, post: page })).toEqual({ ...readView, publishedWhere: "Live newsroom" });
  expect(toPostWriteResultView({ deps: local, post: page })).toEqual({ ...readView, publishedWhere: "Local copy" });
  const draft = toPostWriteResultView({ deps: production, post });
  expect(draft).toMatchObject({ id: "post-id", publicUrl: null, author: "Jo", showAuthor: true, status: "draft" });
  expect(draft).not.toHaveProperty("publishedWhere");
  expect(draft).not.toHaveProperty("template");
});
