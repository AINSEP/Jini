import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { test } from "vitest";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { SearchDocumentSource } from "../../ports.js";
import { createCmsSearchAccessPort, memberSearchAudiences } from "../access.js";
import {
  CMS_SEARCH_EVENTS, cmsSearchRevision, cmsSearchVisibility, createCmsSearchDocumentSources, isRowLive,
  type CmsSearchDatabase, type CmsSearchIsLiveAt, type CmsSearchPostRow, type CmsSearchResolveMemberAccess,
} from "../cms-document-source.js";

/**
 * @file The pure parts of the CMS search source: event claims, member gates as audiences, revisions, and the
 * injected host rules. Moved from the host's suite with the module; the host keeps its dialect-matrix
 * integration tests over real `posts` rows.
 */

const WS = "ws-search";
const T0 = Date.parse("2026-10-21T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A host-shaped gate decoder: never-gated is public, unreadable is an unknown visibility. */
const resolveMemberAccess: CmsSearchResolveMemberAccess = ({ raw }) => {
  if (!raw) return { visibility: "public" };
  try { return JSON.parse(raw) as { visibility: string }; } catch { return { visibility: "unreadable" }; }
};
const isLiveAt: CmsSearchIsLiveAt = ({ record, nowIso }) =>
  record.status === "published" && !record.deletedAt && (record.publishAt == null || record.publishAt <= nowIso);

/** A kernel whose query builder chains any call and resolves the terminal read to `row`. */
function fakeKernel(row: CmsSearchPostRow | undefined) {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_target, name) => name === "executeTakeFirst" ? async () => row : name === "execute" ? async () => (row ? [row] : []) : () => chain,
  });
  return { run: async (fn: (db: unknown) => unknown) => fn(chain) } as unknown as StorageKernel<never, CmsSearchDatabase>;
}

function sources(row?: CmsSearchPostRow, overrides: { isLiveAt?: CmsSearchIsLiveAt } = {}) {
  return createCmsSearchDocumentSources({
    kernel: fakeKernel(row) as never, now: () => T0, resolveMemberAccess, isLiveAt: overrides.isLiveAt ?? isLiveAt,
    postPublicPath: ({ slug }) => `/blog/${slug}`,
    toSearchText: ({ row: host }) => ({ title: `T:${(host as CmsSearchPostRow).id}`, bodyText: "plain body" }),
  }) as [SearchDocumentSource, SearchDocumentSource];
}

const row = (overrides: Partial<CmsSearchPostRow> = {}): CmsSearchPostRow => ({
  id: "p1", workspace_id: WS, kind: "post", slug: "hello", status: "published", updated_at: iso(T0), version: 3,
  publish_at: null, deleted_at: null, member_access_json: null, ...overrides,
});

test("documentIdOf claims only post.ts's own events for its own kind", () => {
  const [posts, pages] = sources();
  const event = (name: string, payload?: unknown) => ({ name, workspaceId: WS, occurredAt: iso(T0), aggregateId: "p1", payload });
  for (const name of CMS_SEARCH_EVENTS) assert.equal(posts.documentIdOf({ event: event(name, { entryId: "p1", contentType: "post" }) }), "p1");
  assert.equal(pages.documentIdOf({ event: event("entry.updated", { entryId: "g1", contentType: "page" }) }), "g1");
  assert.equal(posts.documentIdOf({ event: event("entry.updated", { entryId: "g1", contentType: "page" }) }), null, "a page is not a post");
  assert.equal(posts.documentIdOf({ event: event("entry.published", { workspaceId: WS, entryId: "e1" }) }), null, "generic entries carry no contentType");
  assert.equal(posts.documentIdOf({ event: event("entry.created", { entryId: "p1", contentType: "post" }) }), null, "not a search event");
  assert.equal(posts.documentIdOf({ event: event("entry.updated") }), null, "no payload");
  assert.equal(posts.documentIdOf({ event: event("entry.updated", { entryId: 7, contentType: "post" }) }), null, "non-string id");
});

test("default sources are post and page with the transition events; collections can be narrowed", () => {
  assert.deepEqual(sources().map(source => [source.collection, source.events]), [["post", CMS_SEARCH_EVENTS], ["page", CMS_SEARCH_EVENTS]]);
  const narrowed = createCmsSearchDocumentSources({
    kernel: fakeKernel(undefined) as never, now: () => 0, isLiveAt, resolveMemberAccess, postPublicPath: () => "/", toSearchText: () => ({ title: "", bodyText: "" }),
  }, { collections: ["page"] });
  assert.deepEqual(narrowed.map(s => s.collection), ["page"]);
});

test("member gates become audiences; anything unreadable is restricted to nobody", () => {
  const visibility = (memberAccessJson: string | null) => cmsSearchVisibility({ memberAccessJson, resolveMemberAccess });
  assert.deepEqual(visibility(null), { kind: "public" });
  assert.deepEqual(visibility('{"visibility":"public"}'), { kind: "public" });
  assert.deepEqual(visibility('{"visibility":"members"}'), { kind: "restricted", audiences: ["members"] });
  assert.deepEqual(visibility('{"visibility":"paid"}'), { kind: "restricted", audiences: ["paid"] });
  assert.deepEqual(visibility('{"visibility":"tiers","tierIds":["gold","silver"]}'), { kind: "restricted", audiences: ["tier:gold", "tier:silver"] });
  assert.deepEqual(visibility('{"visibility":"tiers"}'), { kind: "restricted", audiences: [] });
  assert.deepEqual(visibility("{not json"), { kind: "restricted", audiences: [] });
  assert.deepEqual(visibility('{"visibility":"everyone"}'), { kind: "restricted", audiences: [] });
});

test("viewer audiences use the same tokens, and an anonymous viewer has none", () => {
  assert.deepEqual(memberSearchAudiences({ context: { isAuthenticated: false, activeTierIds: ["gold"], isPaid: true } }), []);
  assert.deepEqual(memberSearchAudiences({ context: { isAuthenticated: true, activeTierIds: ["gold"], isPaid: false } }), ["members", "tier:gold"]);
  assert.deepEqual(memberSearchAudiences({ context: { isAuthenticated: true, activeTierIds: [], isPaid: true } }), ["members", "paid"]);
});

test("revisions: live rows by max(updatedAt, publishAt), others by max(updatedAt, occurredAt), missing outranks the millisecond", () => {
  const base = { updated_at: iso(T0), publish_at: null, version: 1_004 };
  assert.equal(cmsSearchRevision({ row: base, live: true, occurredAtMs: T0 + 5 }), T0 * 1000 + 4, "a live revision ignores the event time");
  assert.equal(cmsSearchRevision({ row: { ...base, publish_at: iso(T0 + 9) }, live: true, occurredAtMs: 0 }), (T0 + 9) * 1000 + 4);
  assert.equal(cmsSearchRevision({ row: base, live: false, occurredAtMs: T0 + 5 }), (T0 + 5) * 1000 + 4);
  assert.equal(cmsSearchRevision({ row: base, live: false, occurredAtMs: T0 - 5 }), T0 * 1000 + 4);
  assert.equal(cmsSearchRevision({ row: null, live: false, occurredAtMs: T0 }), T0 * 1000 + 999);
  assert.ok(Number.isSafeInteger(cmsSearchRevision({ row: null, live: false, occurredAtMs: Date.parse("2200-01-01T00:00:00.000Z") })));
});

test("isRowLive asks the injected host rule with the row's raw columns", () => {
  const seen: unknown[] = [];
  const rule: CmsSearchIsLiveAt = (args) => { seen.push(args); return false; };
  assert.equal(isRowLive({ row: { status: "published", publish_at: "p", deleted_at: null }, nowIso: "n", isLiveAt: rule }), false);
  assert.deepEqual(seen, [{ record: { status: "published", publishAt: "p", deletedAt: null }, nowIso: "n" }]);
});

test("load: a live row becomes a document from the injected URL, text and gate rules", async () => {
  const [posts] = sources(row({ member_access_json: '{"visibility":"paid"}' }));
  const record = await posts.load({ siteId: "s", workspaceId: WS, documentId: "p1", occurredAtMs: T0 });
  assert.deepEqual(record.document, {
    key: { siteId: "s", workspaceId: WS, collection: "post", documentId: "p1" }, revision: T0 * 1000 + 3,
    url: "/blog/hello", title: "T:p1", body: "plain body", visibility: { kind: "restricted", audiences: ["paid"] },
  });
});

test("load: a row the host rule calls not live is a tombstone, and a row of the other kind is missing", async () => {
  const [posts, pages] = sources(row({ publish_at: iso(T0 + 1) }));
  assert.equal((await posts.load({ siteId: "s", workspaceId: WS, documentId: "p1", occurredAtMs: T0 })).document, null, "still scheduled");
  const [, deadPages] = sources(row(), { isLiveAt: () => false });
  assert.equal((await deadPages.load({ siteId: "s", workspaceId: WS, documentId: "p1", occurredAtMs: T0 })).document, null);
  const missing = await pages.load({ siteId: "s", workspaceId: WS, documentId: "p1", occurredAtMs: T0 });
  assert.deepEqual([missing.document, missing.revision], [null, T0 * 1000 + 999]);
});

async function withPosts(rows: CmsSearchPostRow[], check: (kernel: ReturnType<typeof sqliteKernel<CmsSearchDatabase>>) => Promise<void>) {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE posts (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL,
      slug TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
      version INTEGER NOT NULL, publish_at TEXT, deleted_at TEXT, member_access_json TEXT
    )`);
    const kernel = sqliteKernel<CmsSearchDatabase>({ source: db });
    await kernel.run(handle => handle.insertInto("posts").values(rows).execute());
    await check(kernel);
  } finally {
    db.close();
  }
}

test("scan paginates only currently published posts in the requested workspace", async () => {
  await withPosts([
    row({ id: "30-last", slug: "last" }),
    row({ id: "11-scheduled", publish_at: iso(T0 + 1) }),
    row({ id: "20-now", slug: "today", publish_at: iso(T0), updated_at: iso(T0 - 10) }),
    row({ id: "12-trashed", deleted_at: iso(T0 - 1) }),
    row({ id: "13-other-workspace", workspace_id: "ws-other" }),
    row({ id: "14-draft", status: "draft" }),
    row({ id: "10-first", slug: "first" }),
    row({ id: "15-page", kind: "page" }),
  ], async kernel => {
    const [posts] = createCmsSearchDocumentSources({
      kernel, now: () => T0, isLiveAt, resolveMemberAccess,
      postPublicPath: ({ slug }) => `/blog/${slug}`,
      toSearchText: ({ row: host }) => ({ title: `Article ${host.id}`, bodyText: `Text for ${host.slug}` }),
    }) as [SearchDocumentSource, SearchDocumentSource];
    const input = { siteId: "s", workspaceId: WS, limit: 2 };
    const expected = (documentId: string, slug: string) => {
      const key = { siteId: "s", workspaceId: WS, collection: "post", documentId };
      const revision = T0 * 1000 + 3;
      return { key, revision, document: {
        key, revision, url: `/blog/${slug}`, title: `Article ${documentId}`, body: `Text for ${slug}`,
        visibility: { kind: "public" },
      } };
    };
    assert.deepEqual(await posts.scan(input), {
      records: [expected("10-first", "first"), expected("20-now", "today")], nextCursor: "20-now",
    });
    assert.deepEqual(await posts.scan(input, { cursor: "20-now" }), { records: [expected("30-last", "last")] });
    assert.deepEqual(await posts.scan(input, { cursor: "30-last" }), { records: [] });
  });
});

test("live CMS access matches audiences without accepting stale or mis-scoped keys", async () => {
  await withPosts([
    row({ id: "public" }),
    row({ id: "gold", member_access_json: '{"visibility":"tiers","tierIds":["silver","gold"]}' }),
    row({ id: "paid", member_access_json: '{"visibility":"paid"}' }),
    row({ id: "bad-gate", member_access_json: "{not json" }),
    row({ id: "page", kind: "page" }),
    row({ id: "wrong-workspace", workspace_id: "ws-other" }),
    row({ id: "wrong-site" }),
    row({ id: "draft", status: "draft" }),
    row({ id: "trashed", deleted_at: iso(T0 - 1) }),
    row({ id: "scheduled", publish_at: iso(T0 + 1) }),
    row({ id: "article", kind: "article" }),
  ], async kernel => {
    const rules = { kernel, now: () => T0, isLiveAt, resolveMemberAccess };
    const port = createCmsSearchAccessPort(rules);
    const key = (documentId: string, collection = "post", siteId = "s") =>
      ({ siteId, workspaceId: WS, documentId, collection });
    const keys = [
      key("public"), key("gold"), key("paid"), key("bad-gate"), key("page", "page"),
      key("wrong-workspace"), key("wrong-site", "post", "other-site"), key("page"),
      key("draft"), key("trashed"), key("scheduled"), key("missing"), key("article", "article"),
    ];
    assert.deepEqual(await port.visibleKeys({ siteId: "s", keys, audiences: ["members", "tier:gold"] }),
      new Set(["s/ws-search/post/public", "s/ws-search/post/gold", "s/ws-search/page/page"]));
    assert.deepEqual(await port.visibleKeys({ siteId: "s", keys, audiences: [] }),
      new Set(["s/ws-search/post/public", "s/ws-search/page/page"]));
    const pagesOnly = createCmsSearchAccessPort(rules, { collections: ["page"] });
    assert.deepEqual(await pagesOnly.visibleKeys({ siteId: "s", keys, audiences: ["paid"] }),
      new Set(["s/ws-search/page/page"]));
  });
});
