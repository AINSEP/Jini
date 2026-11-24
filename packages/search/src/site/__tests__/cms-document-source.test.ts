import assert from "node:assert/strict";
import { test } from "vitest";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { SearchDocumentSource } from "../../ports.js";
import { memberSearchAudiences } from "../access.js";
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
