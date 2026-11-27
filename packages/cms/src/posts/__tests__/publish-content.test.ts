import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { InMemoryChangeSetRepo } from "../../core/commands/repo.memory.js";
import { createMediaAccessEvidence } from "../../media/site/access-evidence.js";
import { contentHash } from "../../publish/content/content-hash.js";
import { collectBodyReferences } from "../../publish/content/content-references.js";
import { applyRunActor, createRepoPublishHandler, gatewayDeps } from "../../publish/content/repo-handler.js";
import type { PublishContentHandler } from "../../publish/content/type-registry.js";
import type { PackedEntity } from "../../publish/transfer/packed-entity.js";
import { prepareTermSync, readTermIds, TERM_SYNC_PERMISSION, withTermIds } from "../../taxonomy/site/publish-term-ids.js";
import { PostConflictError, PostNotFoundError, type PostRecord } from "@jini-ai/cms/posts/post";
import { contributePagePublish, contributePostPublish, packedStateOf, toPublishableState, type PublishContentDeps } from "../publish-content.js";
import { bindInMemoryPostRepo } from "../repo.memory.js";

const created = "2026-10-10T09:00:00.000Z";
const now = "2026-11-26T11:00:00.000Z";
const source: PostRecord = { id: "story", workspaceId: "source", title: "Story", slug: "story", kind: "post",
  status: "draft", version: 13, updatedAt: created, bodyFormat: "doc", bodyHtml: null, bodyJson: { type: "doc" },
  createdByPrincipalId: "source-writer", createdByKind: "agent", createdAt: created,
  ext: { foreign: { value: "do not publish" } } };
const policy = { applyRunActor, createRepoPublishHandler, gatewayDeps, collectBodyReferences, contentHash,
  prepareTermSync, readTermIds, TERM_SYNC_PERMISSION, withTermIds };
const key = { workspaceId: "destination", id: "story" };

function fixture(rows: PostRecord[] = []) {
  let next = 0;
  const Repo = bindInMemoryPostRepo({ nowIso: () => now, newId: () => `rev-${++next}`,
    hashJsonText: (value) => createHash("sha256").update(value).digest("hex"), createEvidence: createMediaAccessEvidence });
  const repo = new Repo({}, { initialRows: rows });
  const reportRollbackError = vi.fn<(message: string, diagnostic: string) => void>();
  const changes = new InMemoryChangeSetRepo();
  const deps = { workspaceId: "destination", clock: { nowMs: () => Date.parse(now) }, idGen: { newId: () => `audit-${++next}` },
    mutationActor: { id: "importer", kind: "user" },
    changeSets: changes, authorize: async () => ({ allowed: true, reason: "grant" }),
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    ports: { post: { repo, reportRollbackError, forgetRemoved: async () => {} } },
  } satisfies PublishContentDeps;
  return { repo, deps, changes, reportRollbackError };
}

async function pack(handler: PublishContentHandler) {
  const entities: PackedEntity[] = [];
  for await (const entity of handler.pack()) entities.push(entity);
  return entities;
}

function entity(state: Record<string, unknown> = {}, id = "story"): PackedEntity {
  return { entityType: "post", id, schemaVersion: 2, hashVersion: 1, contentHash: "plan-fixture", requiredBlobs: [],
    state: { title: "Incoming", slug: "story", kind: "post", status: "draft", bodyFormat: "doc",
      bodyHtml: null, bodyJson: { type: "doc" }, ...state } };
}

test("publishes content and provenance without leaking local bookkeeping or changing legacy byline defaults", () => {
  expect(toPublishableState({ ...source, author: null, showAuthor: false, deletedAt: now })).toEqual({
    title: "Story", slug: "story", bodyJson: { type: "doc" }, status: "draft", kind: "post", bodyFormat: "doc", bodyHtml: null,
    seoExtJson: null, templateChoice: null, overridesThemePage: null, memberAccessJson: null,
    createdByPrincipalId: "source-writer", createdByKind: "agent", createdAt: created,
  });
  expect(toPublishableState({ ...source, author: "Byline", showAuthor: true, featuredMediaId: "cover", publishAt: now }))
    .toMatchObject({ author: "Byline", showAuthor: true, featuredMediaId: "cover", publishAt: now });
});

test("packs only live rows of the contributor kind with term ids and resolves all distinct media references", async () => {
  const post = { ...source, workspaceId: "destination", featuredMediaId: "cover", author: null, showAuthor: false };
  const page = { ...post, id: "page", slug: "page", kind: "page" as const };
  const f = fixture([post, page, { ...post, id: "trashed", slug: "trashed", deletedAt: now },
    { ...post, id: "other", workspaceId: "other" }]);
  const read = vi.fn<typeof readTermIds>(async ({ contentType, contentId }) =>
    contentType === "post" && contentId === "story" ? ["term-b"] : undefined);
  const handler = contributePostPublish({ ...policy, readTermIds: read }).build(f.deps);
  const pageHandler = contributePagePublish({ ...policy, readTermIds: read }).build(f.deps);
  expect(handler.dependsOn).toEqual(["media", "term"]);
  expect(handler.alsoAuthorizes).toEqual(["admin.taxonomy.manage"]);
  const packed = await pack(handler);
  expect(packed.map(row => row.id)).toEqual(["story"]);
  expect((await pack(pageHandler)).map(row => [row.entityType, row.id])).toEqual([["page", "page"]]);
  const found = packed[0]!;
  expect(found.state).toMatchObject({ termIds: ["term-b"], featuredMediaId: "cover", createdByPrincipalId: "source-writer" });
  expect(found.state).not.toHaveProperty("author");
  expect(found.state).not.toHaveProperty("showAuthor");
  expect(found.state).not.toHaveProperty("ext");
  expect(read.mock.calls).toEqual([
    [{ ports: undefined, contentType: "post", contentId: "story" }],
    [{ ports: undefined, contentType: "page", contentId: "page" }],
  ]);
  expect(await handler.inspect({ id: "story" })).toEqual({ version: 13, hash: found.contentHash });
  expect(await handler.inspect({ id: "page" })).toBeNull();
  expect(await handler.inspect({ id: "missing" })).toBeNull();
  expect(await packedStateOf({ row: post, termPorts: undefined, readTermIds: read, withTermIds })).toHaveProperty("termIds", ["term-b"]);
  expect(handler.references!({ entity: found })).toEqual([
    { entityType: "term", key: "term-b" }, { entityType: "media", key: "cover" },
  ]);
  expect(handler.references!({ entity: entity({ bodyJson: { type: "image", attrs: { assetId: "cover" } }, featuredMediaId: "cover" }) }))
    .toEqual([{ entityType: "media", key: "cover" }]);
  expect(handler.references!({ entity: entity({ featuredMediaId: "", termIds: ["term-b"] }) }))
    .toEqual([{ entityType: "term", key: "term-b" }]);
});

test("precheck refuses kind changes, unusable slugs, competing holders and trashed destinations without writing", async () => {
  const existing = { ...source, workspaceId: "destination" };
  const f = fixture([
    existing, { ...existing, id: "different", slug: "reserved" },
    { ...existing, id: "gone", slug: "removed", deletedAt: now },
    { ...existing, id: "page", slug: "own-page", kind: "page" },
  ]);
  const handler = contributePostPublish(policy).build(f.deps);
  for (const [candidate, message] of [
    [entity({ kind: "page" }), "post entity 'story' is packed as a 'page' — a post publish writes only posts"],
    [entity({ slug: 4 }), "post entity 'story' has no usable slug to check for a collision"],
    [entity({ slug: "" }), "post entity 'story' has no usable slug to check for a collision"],
    [entity({ slug: "reserved" }), "slug 'reserved' is already held by a different post ('different')"],
    [entity({ slug: "removed" }, "gone"), "post 'gone' is in the trash at this destination — restore it before publishing over it, or publishing would resurrect it as live content"],
    [entity({ slug: "own-page" }, "page"), "'page' is a 'page' at this destination but a 'post' at the source — kind is fixed at creation and cannot be changed by publishing"],
  ] as const) expect(await handler.precheck({ entity: candidate })).toBe(message);
  expect(await handler.precheck({ entity: entity() })).toBeNull();
  expect(await f.repo.findById(key)).toEqual(existing);
  expect(await f.repo.listRevisions({ workspaceId: "destination", postId: "story" })).toEqual([]);
});

test("apply transfers access and presentation while preserving destination-local metadata on update", async () => {
  const f = fixture();
  const handler = contributePostPublish(policy).build(f.deps);
  const access = '{"visibility":"members"}';
  const incoming = entity({ author: "Public credit", showAuthor: true, featuredMediaId: "cover", publishAt: now,
    createdByPrincipalId: "source-writer", createdByKind: "agent", createdAt: created, memberAccessJson: access,
    ext: { foreign: { copy: false } }, version: 999, deletedAt: created });
  const applied = await handler.apply({ entity: incoming, expectedVersion: undefined, principalId: "importer", idempotencyKey: "create" });
  const createdRow = await f.repo.findById(key);
  expect(createdRow).toMatchObject({ id: "story", workspaceId: "destination", version: 1, updatedAt: now,
    author: "Public credit", showAuthor: true, featuredMediaId: "cover", publishAt: now, deletedAt: null,
    createdByPrincipalId: "source-writer", createdByKind: "agent", createdAt: created, memberAccessJson: access });
  expect(createdRow).not.toHaveProperty("ext");
  expect(await f.changes.findById({ workspaceId: "destination", id: applied.changeSetId })).toMatchObject({
    items: [{ operation: "create", entityId: "story", entityVersionAtApply: 1 }],
  });
  await f.repo.save({ ...createdRow!, ext: { destination: { enabled: true } } });

  await handler.apply({ entity: entity({ createdByPrincipalId: "imposter", createdAt: now, memberAccessJson: access }),
    expectedVersion: 1, principalId: "importer", idempotencyKey: "update" });
  const updated = await f.repo.findById(key);
  expect(updated).toMatchObject({ id: "story", version: 2, memberAccessJson: access,
    author: null, showAuthor: false, ext: { destination: { enabled: true } }, createdByPrincipalId: "source-writer",
    createdAt: created, createdByKind: "agent" });
  expect(updated).not.toHaveProperty("featuredMediaId");
  expect(updated).not.toHaveProperty("publishAt");
  expect(await f.repo.listRevisions({ workspaceId: "destination", postId: "story" })).toMatchObject([
    { actorId: "importer", seq: 1, op: "create" }, { actorId: "importer", seq: 2, op: "update" },
  ]);
});

test("apply refuses mismatched kind and missing rollback wiring without touching the destination", async () => {
  const f = fixture();
  const apply = { expectedVersion: undefined, principalId: "importer", idempotencyKey: "test" };
  const handler = contributePostPublish(policy).build(f.deps);
  await expect(handler.apply({ ...apply, entity: entity({ kind: "page" }) }))
    .rejects.toMatchObject({ rowOutcome: "blocked", message: "post entity 'story' is packed as a 'page' — a post publish writes only posts" });
  const { forgetRemoved: _missing, ...post } = f.deps.ports.post;
  const unwired = contributePostPublish(policy).build({ ...f.deps, ports: { post } });
  await expect(unwired.apply({ ...apply, entity: entity() })).rejects.toThrow("ports.post.repo/forgetRemoved");
  expect(await f.repo.findById(key)).toBeNull();
  expect(await f.changes.listByWorkspace({ workspaceId: "destination" })).toEqual([]);
  expect(handler.isApplyConflict?.(new PostNotFoundError("missing"))).toBe(true);
  expect(handler.isApplyConflict?.(new PostConflictError("slug clash"))).toBe(true);
  expect(handler.isApplyConflict?.(new Error("db unavailable"))).toBe(false);
});

test("a failed term sync removes a newly imported post and its revision even if term rollback also fails", async () => {
  const f = fixture();
  const failedSync = new Error("terms could not be assigned");
  const prepare = vi.fn<typeof prepareTermSync>(async () => ({
    apply: async () => {
      expect((await f.repo.findById(key))?.title).toBe("Incoming");
      throw failedSync;
    },
    revert: async () => { throw new Error("terms could not be rolled back"); },
  }));
  const handler = contributePostPublish({ ...policy, prepareTermSync: prepare }).build(f.deps);
  await expect(handler.apply({ entity: entity({ termIds: ["term-z"] }), expectedVersion: undefined,
    principalId: "importer", idempotencyKey: "terms" })).rejects.toBe(failedSync);
  expect(prepare).toHaveBeenCalledExactlyOnceWith({ ports: undefined, deps: f.deps, entityType: "post", entityId: "story",
    principalId: "importer", contentType: "post", wanted: ["term-z"] });
  expect(await f.repo.findById(key)).toBeNull();
  expect(await f.repo.findBySlug({ workspaceId: "destination", slug: "story" })).toBeNull();
  expect(await f.repo.listRevisions({ workspaceId: "destination", postId: "story" })).toEqual([]);
  expect(f.reportRollbackError.mock.calls).toHaveLength(1);
  expect(f.reportRollbackError.mock.calls[0]?.[0]).toBe("[publish-content] Could not revert imported terms");
  expect(f.reportRollbackError.mock.calls[0]?.[1]).toBe("Error");
});

test("an audit failure reverses term changes before restoring the previously published row forward", async () => {
  const prior: PostRecord = { ...source, workspaceId: "destination", title: "Destination original", ext: { local: { keep: true } } };
  const f = fixture([prior]);
  const auditFailure = new Error("audit ledger unavailable");
  const insert = vi.spyOn(f.changes, "insert").mockRejectedValueOnce(auditFailure);
  const seen: string[] = [];
  const read = vi.fn<typeof readTermIds>(async () => ["old-term"]);
  const prepare = vi.fn<typeof prepareTermSync>(async () => ({
    apply: async () => { seen.push("new assignments"); },
    revert: async () => {
      expect((await f.repo.findById(key))?.title).toBe("Incoming");
      seen.push("restored assignments");
    },
  }));
  try {
    const handler = contributePostPublish({ ...policy, readTermIds: read, prepareTermSync: prepare }).build(f.deps);
    await expect(handler.apply({ entity: entity({ termIds: ["new-term"] }), expectedVersion: 13,
      principalId: "importer", idempotencyKey: "failed-audit" })).rejects.toBe(auditFailure);
    expect(seen).toEqual(["new assignments", "restored assignments"]);
    expect(await f.repo.findById(key)).toEqual({ ...prior, updatedAt: now, version: 15 });
    expect((await f.repo.findById(key))).not.toHaveProperty("termIds");
    expect((await f.repo.listRevisions({ workspaceId: "destination", postId: "story" })).map(({ seq, op }) => [seq, op]))
      .toEqual([[14, "update"], [15, "restore"]]);
    expect(await f.changes.listByWorkspace({ workspaceId: "destination" })).toEqual([]);
  } finally { insert.mockRestore(); }
});
