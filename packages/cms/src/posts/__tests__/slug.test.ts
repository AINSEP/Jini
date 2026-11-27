import assert from "node:assert/strict";
import { expect, it, test, vi } from "vitest";

import { derivePostSlugBase, isAutomaticPostSlug, MAX_SLUG_LENGTH, DERIVED_SLUG_SUFFIX_ROOM } from "../slug.js";
import {
  assertValidExplicitSlug, availablePostSlug, captureSlugChange, hasPostBeenPublished, releaseTrashedSlug,
  resolveCreateSlug, trashedSlugHolderOrConflict,
} from "../post-slugs.js";
import { PostConflictError, PostValidationError } from "../post.js";
import { NOW, WORKSPACE, postRepo, postRow } from "./post-coverage.fixture.js";

test("derivePostSlugBase leaves room for a collision suffix, trims a trailing dash, and falls back to untitled", () => {
  assert.equal(derivePostSlugBase({ title: "Hello World" }), "hello-world");
  const long = derivePostSlugBase({ title: "a".repeat(200) });
  assert.equal(long.length, MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM);
  assert.equal(derivePostSlugBase({ title: `${"b".repeat(MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM - 1)} tail` }), "b".repeat(MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM - 1));
  assert.equal(derivePostSlugBase({ title: "!!!" }), "untitled");
});

test("isAutomaticPostSlug recognises the derived slug, its numeric collision suffixes, and untitled placeholders", () => {
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world" }), true);
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world-2" }), true);
  assert.equal(isAutomaticPostSlug({ title: "Anything", slug: "untitled" }), true);
  assert.equal(isAutomaticPostSlug({ title: "Anything", slug: "untitled-7" }), true);
});

test("isAutomaticPostSlug treats an edited slug as manual, including a non-numeric suffix on the derived base", () => {
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "my-own-slug" }), false);
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world-draft" }), false);
  assert.equal(isAutomaticPostSlug({ title: "Hello World", slug: "hello-world-" }), false);
});

it.each([
  ["post", "/", "slug must use lowercase letters, numbers, and dashes"],
  ["page", "", "slug must use lowercase letters, numbers, and dashes"],
  ["page", "Upper", "slug must use lowercase letters, numbers, and dashes"],
  ["page", "extra/path", "slug must use lowercase letters, numbers, and dashes"],
  ["post", "api", "slug 'api' is reserved"],
  ["post", "a".repeat(121), "slug must be 120 characters or fewer"],
] as const)("rejects the invalid %s slug %s", (kind, slug, message) => {
  assert.throws(() => assertValidExplicitSlug({ slug, kind, reservedSegments: new Set(["api"]) }), { constructor: PostValidationError, message });
});

it("allows the root only for pages and admits explicit slugs up to 120 characters", () => {
  const reservedSegments = new Set(["api"]);
  expect(assertValidExplicitSlug({ slug: "/", kind: "page", reservedSegments })).toBeUndefined();
  expect(assertValidExplicitSlug({ slug: "a", kind: "post", reservedSegments })).toBeUndefined();
  expect(assertValidExplicitSlug({ slug: "a-1".repeat(40), kind: "post", reservedSegments })).toBeUndefined();
});

it("chooses distinct article and page suffixes and reports the exact trashed candidate", async () => {
  const discarded = postRow({ id: "trashed", slug: "articles-2", deletedAt: NOW });
  const repo = postRepo([discarded, postRow({ id: "live", slug: "articles" }), postRow({ id: "foreign", workspaceId: "elsewhere", slug: "articles-1" })]);
  const base = { repo, title: "Articles", reservedSegments: new Set<string>(), input: { workspaceId: WORKSPACE } };
  expect(await resolveCreateSlug({ ...base, explicitSlug: undefined })).toEqual({ slug: "articles-1", trashedHolder: null });
  expect(await resolveCreateSlug({ ...base, explicitSlug: undefined, input: { workspaceId: WORKSPACE, kind: "page" } }))
    .toEqual({ slug: "articles-2", trashedHolder: discarded });
  expect(await resolveCreateSlug({ ...base, explicitSlug: "articles-2" })).toEqual({ slug: "articles-2", trashedHolder: discarded });
  expect(await resolveCreateSlug({ ...base, explicitSlug: "deliberate" })).toEqual({ slug: "deliberate", trashedHolder: null });
  await assert.rejects(resolveCreateSlug({ ...base, explicitSlug: "articles" }), { constructor: PostConflictError, message: "slug 'articles' already exists" });
  expect(await trashedSlugHolderOrConflict({ repo, workspaceId: WORKSPACE, slug: "articles" }, { selfId: "live" })).toBeNull();
});

it("skips reserved candidates, allows its own live slug, and refuses an exhausted namespace", async () => {
  const repo = postRepo([postRow({ id: "self", slug: "articles" })]);
  const input = { repo, workspaceId: WORKSPACE, title: "Articles", kind: "post" as const, selfId: "self" };
  expect(await availablePostSlug({ ...input, reservedSegments: new Set() })).toEqual({ slug: "articles", trashedHolder: null });
  expect(await availablePostSlug({ ...input, reservedSegments: new Set(["articles", "articles-1"]) })).toEqual({ slug: "articles-2", trashedHolder: null });
  const reservedSegments = new Set(["articles", ...Array.from({ length: 998 }, (_, index) => `articles-${index + 1}`)]);
  await assert.rejects(availablePostSlug({ ...input, reservedSegments }), { constructor: PostConflictError, message: "slug 'articles' already exists" });
});

it.each([
  { name: "root", slug: "/", base: "home-trashed" },
  { name: "long slug", slug: "x".repeat(120), base: `${"x".repeat(108)}-trashed` },
])("moves a trashed $name past occupied names without changing its restore version", async ({ slug, base }) => {
  const holder = postRow({ id: "trashed", kind: "page", slug, deletedAt: NOW });
  const repo = postRepo([holder, postRow({ id: "block-one", slug: base }), postRow({ id: "block-two", slug: `${base}-2` })]);
  const moved = { ...holder, slug: `${base}-3` };
  expect(await releaseTrashedSlug({ repo, holder })).toEqual(moved);
  expect(await repo.findBySlug({ workspaceId: WORKSPACE, slug })).toBeNull();
  expect(await repo.findById({ workspaceId: WORKSPACE, id: "trashed" })).toEqual(moved);
  expect(await repo.listRevisions({ workspaceId: WORKSPACE, postId: "trashed" })).toEqual([]);
});

it("refuses to rename a trash holder that was restored after it was read", async () => {
  const holder = postRow({ slug: "art", deletedAt: NOW });
  const restored = postRow({ slug: "art", version: 5 });
  const repo = postRepo([restored]);
  await assert.rejects(releaseTrashedSlug({ repo, holder }), { constructor: PostConflictError, message: "slug 'art' changed while it was being taken from the Trash" });
  expect(await repo.findBySlug({ workspaceId: WORKSPACE, slug: "art" })).toEqual(restored);
  expect(await repo.findBySlug({ workspaceId: WORKSPACE, slug: "art-trashed" })).toBeNull();
});

it("captures old and new public paths for a previously published rename, even when unpublishing", async () => {
  const existing = postRow({ slug: "old", status: "published" });
  const post = { ...existing, slug: "new", status: "draft" as const };
  const onSlugChange = vi.fn(async () => {});
  const lookup = vi.fn(() => ({ onSlugChange }));
  const postPublicPath = ({ slug }: { slug: string }) => `/news/${slug}`;
  await captureSlugChange({ lookup, existing, post, actor: "editor", postPublicPath });
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(onSlugChange).toHaveBeenCalledExactlyOnceWith({ workspaceId: WORKSPACE, entryId: "post-id", oldPath: "/news/old", newPath: "/news/new", actor: "editor" });
});

it("does not ask for a redirect for unchanged, draft-only, or root addresses", async () => {
  const existing = postRow({ slug: "old", status: "published" });
  const post = { ...existing, slug: "new" };
  const lookup = vi.fn(() => { throw new Error("Unexpected redirect lookup"); });
  const input = { lookup, existing, post, actor: "editor", postPublicPath: ({ slug }: { slug: string }) => `/${slug}` };
  await captureSlugChange({ ...input, post: existing });
  await captureSlugChange({ ...input, existing: { ...existing, status: "draft" } });
  await captureSlugChange({ ...input, existing: { ...existing, kind: "page", slug: "/" } });
  expect(lookup).not.toHaveBeenCalled();
  const path = vi.fn(input.postPublicPath);
  const missingProvider = vi.fn(() => undefined);
  await captureSlugChange({ ...input, lookup: undefined, postPublicPath: path });
  await captureSlugChange({ ...input, lookup: missingProvider, postPublicPath: path });
  expect(missingProvider).toHaveBeenCalledTimes(1);
  expect(path).not.toHaveBeenCalled();
});

it("uses revision history to distinguish an unpublished draft from one with a prior public address", async () => {
  const post = postRow();
  const repo = postRepo([post]);
  expect(await hasPostBeenPublished({ post }, { repo })).toBe(false);
  const append = (seq: number, status: "draft" | "published") => repo.appendRevision({
    workspaceId: WORKSPACE, postId: post.id, seq, op: "update", stateJson: { ...post, version: seq, status }, actorId: "editor", recordedAt: NOW,
  });
  await append(2, "draft");
  expect(await hasPostBeenPublished({ post }, { repo })).toBe(false);
  await append(3, "published");
  await append(4, "draft");
  expect(await hasPostBeenPublished({ post }, { repo })).toBe(true);
  const emptyRepo = postRepo();
  expect(await hasPostBeenPublished({ post: { ...post, status: "published" } }, { repo: emptyRepo })).toBe(true);
});
