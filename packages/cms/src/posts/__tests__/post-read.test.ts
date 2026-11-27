import { expect, it, vi } from "vitest";
import {
  createPublicPostReader, findPublishedPostById, findPublishedPostBySlug, getAdminPostById, getAdminPostByIdOrSlug,
  getPublishedPostBySlug, listAdminPages, listAdminPosts, listPublishedPosts, listPublishedPostPreviews,
} from "../post-read.js";
import { EMAIL_TEMPLATE_KIND, PostNotFoundError } from "../post.js";
import { NOW, WORKSPACE, postRepo, postRow } from "./post-coverage.fixture.js";

const draft = postRow({ id: "draft", slug: "unreleased" });
const scheduled = postRow({ id: "go-live", slug: "scheduled", status: "published", publishAt: NOW });
const page = postRow({ id: "page", slug: "/", kind: "page", status: "published" });
const trashed = postRow({ id: "trashed", slug: "trashed", status: "published", deletedAt: NOW });
const internal = postRow({ id: "template", slug: "template", kind: EMAIL_TEMPLATE_KIND, status: "published" });
const foreign = postRow({ id: "foreign", slug: "private", workspaceId: "foreign", status: "published" });
const scope = { workspaceId: WORKSPACE };
const fixtures = [draft, scheduled, page, trashed, internal, foreign];

it("the kind-only reader excludes internal templates but leaves draft and trash decisions to callers", async () => {
  const reader = createPublicPostReader({ repo: postRepo(fixtures) });
  expect(await reader.list(scope)).toEqual([draft, scheduled, page, trashed]);
  expect(await reader.findById({ ...scope, id: "draft" })).toEqual(draft);
  expect(await reader.findById({ ...scope, id: "template" })).toBeNull();
  expect(await reader.findBySlug({ ...scope, slug: "trashed" })).toEqual(trashed);
  expect(await reader.findBySlug({ ...scope, slug: "template" })).toBeNull();
});

it("admin post, page and all lenses include drafts and exclude trash and internal records", async () => {
  const repo = postRepo(fixtures);
  const input = { deps: { repo }, input: scope };
  expect(await listAdminPosts(input)).toEqual({ posts: [draft, scheduled] });
  expect(await listAdminPages(input)).toEqual({ posts: [page] });
  expect(await listAdminPosts(input, { kind: "all" })).toEqual({ posts: [draft, scheduled, page] });
  expect(await getAdminPostById({ deps: { repo }, input: { ...scope, id: "draft" } })).toEqual({ post: draft });
});

it.each(["not-present", "trashed", "template", "foreign"])("admin lookup for %s gives the same typed not-found contract", async id => {
  const missed = getAdminPostById({ deps: { repo: postRepo(fixtures) }, input: { ...scope, id } });
  await expect(missed).rejects.toBeInstanceOf(PostNotFoundError);
  await expect(missed).rejects.toThrow(`post '${id}' was not found`);
});

it("public listing and both embed lookups open at the exact go-live instant", async () => {
  const repo = postRepo(fixtures);
  const before = { nowIso: "2026-11-25T11:59:59.999Z" };
  const at = { nowIso: NOW };
  const list = { deps: { repo }, input: scope };
  const byId = { deps: { repo }, input: { ...scope, id: "go-live" } };
  const bySlug = { deps: { repo }, input: { ...scope, slug: "scheduled" } };
  expect(await listPublishedPosts(list, before)).toEqual({ posts: [page] });
  expect(await listPublishedPosts(list, at)).toEqual({ posts: [scheduled, page] });
  expect(await findPublishedPostById(byId, before)).toBeNull();
  expect(await findPublishedPostById(byId, at)).toEqual(scheduled);
  expect(await findPublishedPostBySlug(bySlug, before)).toBeNull();
  expect(await findPublishedPostBySlug(bySlug, at)).toEqual(scheduled);
  for (const row of [draft, trashed, internal, foreign]) {
    expect(await findPublishedPostById({ deps: { repo }, input: { ...scope, id: row.id } }, at)).toBeNull();
    expect(await findPublishedPostBySlug({ deps: { repo }, input: { ...scope, slug: row.slug } }, at)).toBeNull();
  }
});

it("visitor slug lookup normalizes the selector without revealing an embargoed post", async () => {
  const required = { deps: { repo: postRepo(fixtures) }, input: { ...scope, slug: "  SCHEDULED " } };
  const embargoed = getPublishedPostBySlug(required, { nowIso: "2026-11-25T11:59:59.999Z" });
  await expect(embargoed).rejects.toBeInstanceOf(PostNotFoundError);
  await expect(embargoed).rejects.toThrow("post 'scheduled' was not found");
  expect(await getPublishedPostBySlug(required, { nowIso: NOW })).toEqual({ post: scheduled });
});

it("admin selector prefers a normalized slug over a colliding id and preserves the exact id fallback", async () => {
  const slugHolder = postRow({ id: "slug-winner", slug: "shared" });
  const idHolder = postRow({ id: "shared", slug: "id-only" });
  const fallback = postRow({ id: "OpaqueId", slug: "opaque" });
  const repo = postRepo([idHolder, slugHolder, fallback, page, trashed]);
  const get = (idOrSlug: string) => getAdminPostByIdOrSlug({ deps: { repo }, input: { ...scope, idOrSlug } });
  expect(await get("shared")).toEqual({ post: slugHolder });
  expect(await get("  ///SHARED ")).toEqual({ post: slugHolder });
  expect(await get("OpaqueId")).toEqual({ post: fallback });
  expect(await get("/")).toEqual({ post: page });
  const missed = get("trashed");
  await expect(missed).rejects.toBeInstanceOf(PostNotFoundError);
  await expect(missed).rejects.toThrow("post 'trashed' was not found");
});

it("previews pass pagination and time to the bounded port and discard invalid result kinds", async () => {
  const repo = postRepo();
  const bounded = vi.spyOn(repo, "listPublishedPreviews").mockResolvedValue([scheduled, internal]);
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(NOW));
    expect(await listPublishedPostPreviews({ deps: { repo }, input: { ...scope, limit: 4 } })).toEqual({ posts: [scheduled] });
    expect(await listPublishedPostPreviews({ deps: { repo }, input: { ...scope, limit: 2, offset: 7 } }, { nowIso: "2026-11-26T12:00:00.000Z" }))
      .toEqual({ posts: [scheduled] });
    expect(bounded.mock.calls).toEqual([
      [{ ...scope, limit: 4, offset: 0, nowIso: NOW }],
      [{ ...scope, limit: 2, offset: 7, nowIso: "2026-11-26T12:00:00.000Z" }],
    ]);
  } finally {
    bounded.mockRestore();
    vi.useRealTimers();
  }
});
