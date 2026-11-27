import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { InMemoryPagesHtmlDocumentStore } from "../html-document-store.memory.js";
import { PageConcurrentEditError, PageKindMismatchError, PageNotFoundError } from "../html-document-store.js";
import type { PostRepoPort, PostRecord } from "../../posts/post.js";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { bindInMemoryPostRepo } from "../../posts/repo.memory.js";
import { createMediaAccessEvidence } from "../../media/site/access-evidence.js";
import { InMemoryEntryRefsRepo } from "../../widgets/entry-refs.memory.js";
import { restoredEntryRefs } from "../html-inverse.js";

it("a store never crosses scope even with equal post IDs", async () => {
  const other: PostRecord = { id: "p", workspaceId: "other", kind: "page", title: "P", slug: "p", bodyJson: {}, bodyFormat: "html", bodyHtml: "secret", status: "draft", version: 1, updatedAt: "now" };
  const findById = vi.fn(async ({ workspaceId, id }: { workspaceId?: string; id: string }) => other.id === id && (workspaceId === undefined || workspaceId === other.workspaceId) ? other : null);
  const repo = { findById } as unknown as PostRepoPort;
  const store = new InMemoryPagesHtmlDocumentStore({ scope: { workspaceId: "mine", postId: "p" }, deps: { repo, clock: { nowMs: () => 0 }, reportUnindexedRef: () => {}, restoredEntryRefs: () => [] } });
  await expect(store.read()).rejects.toBeInstanceOf(PageNotFoundError);
  expect(findById).toHaveBeenCalledWith({ workspaceId: "mine", id: "p" });
});

const scope = { workspaceId: "site", postId: "page" };
const key = { workspaceId: "site", id: "page" };
const before = "2026-11-19T00:00:00.000Z";
const now = "2026-11-20T12:00:00.000Z";
const docBody = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Before" }] }] };
const htmlBody = `<main><div data-embed-config='{"type":"media","id":"asset-7"}'></div></main>`;
const post: PostRecord = { ...key, kind: "page", title: "Page", slug: "page", bodyJson: docBody,
  bodyFormat: "doc", bodyHtml: null, status: "draft", version: 7, updatedAt: before };

function setup(row: PostRecord, actorId?: string) {
  let n = 0;
  const InMemoryPostRepo = bindInMemoryPostRepo({ nowIso: () => now, newId: () => `revision-${++n}`,
    hashJsonText: text => createHash("sha256").update(text).digest("hex"), createEvidence: createMediaAccessEvidence });
  const repo = new InMemoryPostRepo({}, { initialRows: [row] });
  const entryRefsRepo = new InMemoryEntryRefsRepo();
  const enqueue = vi.fn<OutboxPort["enqueue"]>();
  const validatePluginEmbeds = vi.fn(async (_input: { workspaceId: string; html: string }) => [{ code: "fixture-warning", message: "Review page embed" }]);
  const report = () => {};
  const deps = {
    repo, entryRefsRepo, validatePluginEmbeds, outbox: {
      enqueue, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {},
    },
    clock: { nowMs: () => Date.parse(now) }, reportUnindexedRef: report,
    restoredEntryRefs: (input: Omit<Parameters<typeof restoredEntryRefs>[0], "report">) => restoredEntryRefs({ ...input, report }),
  };
  const store = new InMemoryPagesHtmlDocumentStore({ scope: { ...scope, ...(actorId === undefined ? {} : { actorId }) }, deps });
  return { store, repo, entryRefsRepo, validatePluginEmbeds, enqueue };
}

it("converting a scheduled page records the old and new bodies, adds active references and announces its go-live", async () => {
  const publishAt = "2026-11-20T11:00:00.000Z";
  const { store, repo, entryRefsRepo, validatePluginEmbeds, enqueue } = setup({ ...post, status: "published", publishAt }, "editor");
  expect(store.capturedVersion()).toBeNull();
  await store.ensureHtmlFormat({ seedHtml: htmlBody, expectedVersion: 7 });
  expect(await store.read()).toBe(htmlBody);
  expect(store.capturedVersion()).toBe(8);
  expect(store.embedWarnings()).toEqual([{ code: "fixture-warning", message: "Review page embed" }]);
  expect(validatePluginEmbeds.mock.calls).toEqual([[{ workspaceId: "site", html: htmlBody }]]);
  expect((await repo.listRevisions(scope)).map(({ seq, actorId, stateJson }) => [
    seq, actorId, stateJson.bodyFormat, stateJson.bodyHtml, stateJson.bodyJson,
  ])).toEqual([[7, "editor", "doc", null, docBody], [8, "editor", "html", htmlBody, docBody]]);
  expect(await entryRefsRepo.findByTarget({ workspaceId: "site", targetKind: "asset", targetId: "asset-7" })).toMatchObject([
    { workspaceId: "site", sourceEntryId: "page", sourceKind: "page-html-embed", targetKind: "asset", targetId: "asset-7" },
  ]);
  expect(enqueue.mock.calls).toEqual([[{
    id: "page-entry.published-at-2026-11-20T11:00:00.000Z", name: "entry.published", occurredAt: publishAt,
    aggregateId: "page", workspaceId: "site", payload: { entryId: "page", contentType: "page" },
  }]]);
  await store.ensureHtmlFormat({ seedHtml: "<p>not a replacement</p>", expectedVersion: 8 });
  expect((await repo.findById(key))?.bodyHtml).toBe(htmlBody);
  expect((await repo.listRevisions(scope)).map(row => row.seq)).toEqual([7, 8]);
});

it("conversion refuses a wrong document kind or an outdated basis without writing a revision", async () => {
  const wrongKind = setup({ ...post, kind: "post" });
  await expect(wrongKind.store.ensureHtmlFormat({ seedHtml: htmlBody })).rejects.toThrow(PageKindMismatchError);
  await expect(wrongKind.store.read()).rejects.toThrow(PageNotFoundError);
  expect((await wrongKind.repo.findById(key))?.bodyFormat).toBe("doc");
  expect(await wrongKind.repo.listRevisions(scope)).toEqual([]);

  const { store, repo } = setup(post);
  await expect(store.ensureHtmlFormat({ seedHtml: htmlBody, expectedVersion: 6 }))
    .rejects.toThrow("page 'page' is at version 7, not the expected version 6");
  expect(await repo.findById(key)).toEqual(post);
  expect(await repo.listRevisions(scope)).toEqual([]);
});

it("a read basis is required and an older editor cannot overwrite an already committed HTML write", async () => {
  const start = { ...post, bodyFormat: "html" as const, bodyHtml: "<p>before</p>" };
  const { store, repo, entryRefsRepo, validatePluginEmbeds } = setup(start);
  const stale = new InMemoryPagesHtmlDocumentStore({ scope, deps: { repo, clock: { nowMs: () => Date.parse(now) },
    reportUnindexedRef: () => {}, restoredEntryRefs: () => [] } });
  await expect(store.write({ html: htmlBody })).rejects.toThrow("called before read()");
  expect(validatePluginEmbeds.mock.calls).toEqual([]);
  expect(await store.read()).toBe("<p>before</p>");
  expect(await stale.read()).toBe("<p>before</p>");
  await store.write({ html: "<p>before</p>" });
  expect(await repo.listRevisions(scope)).toEqual([]);
  await store.write({ html: htmlBody });
  await expect(stale.write({ html: htmlBody })).rejects.toThrow(PageConcurrentEditError);
  expect((await repo.findById(key))?.bodyHtml).toBe(htmlBody);
  expect(store.capturedVersion()).toBe(8);
  expect(stale.capturedVersion()).toBe(7);
  expect((await repo.listRevisions(scope)).map(({ seq, actorId }) => [seq, actorId])).toEqual([[8, "system"]]);
  expect((await entryRefsRepo.findBySource({ workspaceId: "site", sourceEntryId: "page" })).map(ref => ref.targetId)).toEqual(["asset-7"]);
});

it("restore writes exact pre-edit bodies and references without running new authoring hooks", async () => {
  const start = { ...post, bodyFormat: "html" as const, bodyHtml: htmlBody };
  const { store, repo, validatePluginEmbeds, entryRefsRepo } = setup(start);
  await store.restore({ inverse: { format: "html", html: htmlBody }, expectedVersion: 7 });
  expect(await repo.listRevisions(scope)).toEqual([]);
  const previous = `<div data-embed-config='{"type":"media","id":"asset-8"}'>  Exact whitespace </div>`;
  await store.restore({ inverse: { format: "html", html: previous }, expectedVersion: 7 });
  expect(await store.read()).toBe(previous);
  expect((await entryRefsRepo.findBySource({ workspaceId: "site", sourceEntryId: "page" })).map(ref => ref.targetId)).toEqual(["asset-8"]);
  await expect(store.restore({ inverse: { format: "doc", bodyJson: docBody }, expectedVersion: 7 })).rejects
    .toThrow("page 'page' changed after this edit was made — the newer version was kept");
  await store.restore({ inverse: { format: "doc", bodyJson: docBody }, expectedVersion: 8 });
  expect(await repo.findById(key)).toMatchObject({ bodyFormat: "doc", bodyHtml: null, bodyJson: docBody, version: 9 });
  expect(store.capturedVersion()).toBe(9);
  expect(await entryRefsRepo.findBySource({ workspaceId: "site", sourceEntryId: "page" })).toEqual([]);
  expect((await repo.listRevisions(scope)).map(({ seq, stateJson }) => [seq, stateJson.bodyFormat])).toEqual([[8, "html"], [9, "doc"]]);
  expect(validatePluginEmbeds.mock.calls).toEqual([]);
});
