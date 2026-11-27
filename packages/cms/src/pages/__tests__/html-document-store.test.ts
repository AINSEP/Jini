import { expect, it, vi } from "vitest";
import { PageConcurrentEditError, PageKindMismatchError, PageNotFoundError, SqlPagesHtmlDocumentStore, type PageHtmlStatements, type PageHtmlStatementRow, type PagesHtmlDocumentStoreDeps } from "../html-document-store.js";
import { InMemoryEntryRefsRepo } from "../../widgets/entry-refs.memory.js";
import { InMemoryEntryRepo } from "../../entries/repo.memory.js";
import { restoredEntryRefs } from "../html-inverse.js";
import type { PostRevisionInput } from "../../posts/post.js";

function setup(bodyFormat = "html", actorId?: string) {
  let row: PageHtmlStatementRow & { body_json?: string | null } = { id: "p", workspace_id: "w", kind: "page", status: "draft", publish_at: null, updated_at: "old", deleted_at: null, body_html: bodyFormat === "html" ? "<p>same</p>" : null, body_format: bodyFormat, version: 1 };
  let revisions: PostRevisionInput[] = [];
  const transaction = async <T>({ fn }: { fn: () => Promise<T> }) => { const before = row; const revs = [...revisions]; try { return await fn(); } catch (error) { row = before; revisions = revs; throw error; } };
  const update = vi.fn<PageHtmlStatements["update"]>(async ({ scope, allowedKinds, set, guard }) => {
    if (scope.postId !== row.id || scope.workspaceId !== row.workspace_id || !allowedKinds.has(row.kind as "page" | "post")
      || guard.version !== row.version || (guard.liveHtmlOnly && (row.body_format !== "html" || row.deleted_at !== null))) return 0;
    row = { ...row, ...set };
    return 1;
  });
  const statements: PageHtmlStatements = { readBody: async () => row, readForConversion: async () => row, readForWrite: async () => row,
    readDeletedAt: async () => ({ deleted_at: row.deleted_at }), update, transaction };
  const deps: PagesHtmlDocumentStoreDeps = { statements, clock: { nowMs: () => 0 }, reportUnindexedRef: () => {}, restoredEntryRefs: () => [],
    revisions: { transaction, findById: async () => ({ id: "p", workspaceId: "w", title: "P", slug: "p", bodyJson: row.body_json ? JSON.parse(row.body_json) : { type: "doc", content: [] }, kind: "page", status: row.status === "published" ? "published" : "draft", bodyFormat: row.body_format as "html" | "doc", bodyHtml: row.body_html, version: row.version, updatedAt: row.updated_at }),
      listRevisions: async () => revisions.map((r, i) => ({ ...r, id: String(i), contentHash: "hash" })),
      appendRevision: async input => { revisions.push(input); return { id: "revision", previousId: null }; } } };
  const store = new SqlPagesHtmlDocumentStore({ scope: { workspaceId: "w", postId: "p", ...(actorId === undefined ? {} : { actorId }) }, deps });
  return { store, deps, update, row: () => row, setRow: (value: typeof row) => { row = value; }, revisions: () => revisions };
}
it("stale equal-body write refuses rather than claiming a no-op", async () => {
  const s = setup();
  await s.store.read();
  s.setRow({ ...s.row(), version: 2 });
  await expect(s.store.write({ html: "<p>same</p>" })).rejects.toBeInstanceOf(PageConcurrentEditError);
  expect(s.update).not.toHaveBeenCalled();
  expect(s.store.capturedVersion()).toBe(1);
});
it("failed conversion CAS rolls back the pre-conversion revision", async () => {
  const s = setup("doc");
  s.update.mockResolvedValue(0);
  await expect(s.store.ensureHtmlFormat({ seedHtml: "<p>new</p>" })).rejects.toBeInstanceOf(PageConcurrentEditError);
  expect(s.revisions()).toEqual([]);
  expect(s.row().body_format).toBe("doc");
});
it("restore bypasses authoring normalization", async () => {
  const s = setup();
  const validate = vi.fn(async () => []);
  s.deps.validatePluginEmbeds = validate;
  const html = '<div data-embed-config="{&quot;x&quot;:1}"></div>';
  await s.store.restore({ inverse: { format: "html", html }, expectedVersion: 1 });
  expect(s.row().body_html).toBe(html);
  expect(validate).not.toHaveBeenCalled();
  expect(s.update).toHaveBeenCalledWith(expect.objectContaining({ guard: { version: 1, liveHtmlOnly: true } }));
});

it.each([
  { name: "doc format", patch: { body_format: "doc" } },
  { name: "missing HTML bytes", patch: { body_html: null } },
  { name: "different kind", patch: { kind: "post" } },
])("does not lend a read basis for $name", async ({ patch }) => {
  const s = setup();
  s.setRow({ ...s.row(), ...patch });
  const promise = s.store.read();
  await expect(promise).rejects.toBeInstanceOf(PageNotFoundError);
  await expect(promise).rejects.toThrow("page 'p' was not found");
  expect(s.store.capturedVersion()).toBeNull();
});

it("leaves an already-converted page intact and lends its current write basis", async () => {
  const s = setup();
  s.setRow({ ...s.row(), version: 7 });
  await s.store.ensureHtmlFormat({ seedHtml: "<p>Do not replace</p>", expectedVersion: 7 });
  expect(s.store.capturedVersion()).toBe(7);
  expect(s.row()).toMatchObject({ body_html: "<p>same</p>", version: 7, updated_at: "old" });
  expect(s.update).not.toHaveBeenCalled();
  expect(s.revisions()).toEqual([]);
});

it("refuses converting another document kind without changing its row or history", async () => {
  const s = setup("doc");
  s.setRow({ ...s.row(), kind: "post" });
  const promise = s.store.ensureHtmlFormat({ seedHtml: "<p>Do not convert</p>", expectedVersion: 1 });
  await expect(promise).rejects.toBeInstanceOf(PageKindMismatchError);
  await expect(promise).rejects.toThrow("'p' is not an allowed HTML document kind");
  expect(s.row()).toMatchObject({ body_html: null, body_format: "doc", version: 1 });
  expect(s.revisions()).toEqual([]);
  expect(s.update).not.toHaveBeenCalled();
});

it("refuses to write without first establishing a version basis", async () => {
  const s = setup();
  await expect(s.store.write({ html: "<p>Undisclosed edit</p>" })).rejects.toThrow(
    "PagesHtmlDocumentStore.write() called before read() — there is no version to condition the write on",
  );
  expect(s.row()).toMatchObject({ body_html: "<p>same</p>", version: 1 });
  expect(s.update).not.toHaveBeenCalled();
});

it("reports Trash even if a page was trashed after the HTML was read", async () => {
  const s = setup();
  expect(await s.store.read()).toBe("<p>same</p>");
  s.setRow({ ...s.row(), deleted_at: "2026-11-20T00:00:00.000Z" });
  await expect(s.store.write({ html: "different" })).rejects.toMatchObject({
    code: "ENTITY_IN_TRASH", entityId: "p", message: "ENTITY_IN_TRASH: page 'p' is in the Trash. Restore it from the Trash before changing it.",
  });
  expect(s.row()).toMatchObject({ body_html: "<p>same</p>", version: 1, deleted_at: "2026-11-20T00:00:00.000Z" });
  expect(s.revisions()).toEqual([]);
});

it("normalized identical HTML is a no-op and a second real write uses the previous write's version", async () => {
  const s = setup();
  expect(await s.store.read()).toBe("<p>same</p>");
  await s.store.write({ html: "<p>same</p>" });
  expect(s.update).not.toHaveBeenCalled();
  expect(s.revisions()).toEqual([]);
  expect(s.store.capturedVersion()).toBe(1);
  await s.store.write({ html: "<p>first</p>" });
  expect(s.row()).toMatchObject({ body_html: "<p>first</p>", version: 2 });
  await s.store.write({ html: "<p>second</p>" });
  expect(s.row()).toMatchObject({ body_html: "<p>second</p>", version: 3 });
  expect(s.store.capturedVersion()).toBe(3);
  expect(s.revisions().map(({ seq, stateJson }) => [seq, stateJson.bodyHtml])).toEqual([[2, "<p>first</p>"], [3, "<p>second</p>"]]);
});

it("converts doc HTML with before and after revisions, normalized widget links, and publication catch-up", async () => {
  const s = setup("doc", "editor");
  const oldDoc = { type: "doc", content: [{ type: "paragraph" }] };
  s.setRow({ ...s.row(), status: "published", updated_at: "2026-11-20T10:00:00.000Z", publish_at: "2026-11-20T11:00:00.000Z", body_json: JSON.stringify(oldDoc) });
  s.deps.clock = { nowMs: () => Date.parse("2026-11-20T12:00:00.000Z") };
  const entryRepo = new InMemoryEntryRepo();
  await entryRepo.save({ id: "form-widget", workspaceId: "w", type: "widget", slug: "contact", status: "published", title: "Contact",
    bodyJson: null, fieldsJson: {}, publishedAt: "2026-11-19T00:00:00.000Z", createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z", version: 1 });
  s.deps.widgetSlugLookup = entryRepo;
  const refs = new InMemoryEntryRefsRepo();
  s.deps.entryRefsRepo = refs;
  const enqueue = vi.fn<NonNullable<typeof s.deps.outbox>["enqueue"]>(async () => {});
  s.deps.outbox = { enqueue };
  s.deps.validatePluginEmbeds = async ({ workspaceId, html }) => {
    expect({ workspaceId, html }).toEqual({ workspaceId: "w", html: `<div data-embed-config='{"type":"widget","slug":"contact","id":"form-widget"}'></div>` });
    return [{ code: "notice", message: "Review this embedded widget" }];
  };

  await s.store.ensureHtmlFormat({ seedHtml: `<div data-embed-config='{"type":"widget","slug":"contact"}'></div>`, expectedVersion: 1 });

  const expectedHtml = `<div data-embed-config='{"type":"widget","slug":"contact","id":"form-widget"}'></div>`;
  expect(s.row()).toMatchObject({ body_format: "html", body_html: expectedHtml, body_json: null, version: 2, updated_at: "2026-11-20T12:00:00.000Z" });
  expect(s.store.capturedVersion()).toBe(2);
  expect(s.store.embedWarnings()).toEqual([{ code: "notice", message: "Review this embedded widget" }]);
  expect(s.revisions().map(({ seq, actorId, stateJson }) => ({ seq, actorId, bodyFormat: stateJson.bodyFormat, bodyHtml: stateJson.bodyHtml, bodyJson: stateJson.bodyJson }))).toEqual([
    { seq: 1, actorId: "editor", bodyFormat: "doc", bodyHtml: null, bodyJson: oldDoc },
    { seq: 2, actorId: "editor", bodyFormat: "html", bodyHtml: expectedHtml, bodyJson: { type: "doc", content: [] } },
  ]);
  expect((await refs.findBySource({ workspaceId: "w", sourceEntryId: "p" })).map(r => [r.sourceEntryId, r.targetKind, r.targetId]))
    .toEqual([["p", "entry", "form-widget"]]);
  const envelope = { workspaceId: "w", aggregateId: "p" };
  expect(enqueue.mock.calls).toEqual([
    [{ ...envelope, id: "p-content.saved-2", name: "content.saved", occurredAt: "2026-11-20T12:00:00.000Z", payload: { entryId: "p", contentType: "page", actorId: "editor", source: "service" } }],
    [{ ...envelope, id: "p-entry.updated-2", name: "entry.updated", occurredAt: "2026-11-20T12:00:00.000Z", payload: { entryId: "p", contentType: "page" } }],
    [{ ...envelope, id: "p-entry.published-at-2026-11-20T11:00:00.000Z", name: "entry.published", occurredAt: "2026-11-20T11:00:00.000Z", payload: { entryId: "p", contentType: "page" } }],
  ]);
});

it("restores original rich text and replaces existing HTML references with the document's references", async () => {
  const s = setup();
  const refs = new InMemoryEntryRefsRepo();
  s.deps.entryRefsRepo = refs;
  s.deps.restoredEntryRefs = input => restoredEntryRefs({ ...input, report: undefined });
  await s.store.read();
  await s.store.write({ html: `<div data-embed-config='{"type":"widget","id":"html-widget"}'></div>` });
  expect((await refs.findBySource({ workspaceId: "w", sourceEntryId: "p" })).map(r => r.targetId)).toEqual(["html-widget"]);

  const bodyJson = { type: "doc", content: [{ type: "widgetEmbed", attrs: { widgetEntryId: "doc-widget" } }] };
  await s.store.restore({ inverse: { format: "doc", bodyJson }, expectedVersion: 2 });
  expect(s.row()).toMatchObject({ body_format: "doc", body_html: null, body_json: JSON.stringify(bodyJson), version: 3 });
  expect((await refs.findBySource({ workspaceId: "w", sourceEntryId: "p" })).map(r => [r.sourceKind, r.targetKind, r.targetId]))
    .toEqual([["widget-embed", "entry", "doc-widget"]]);
  expect(s.revisions().map(r => [r.seq, r.stateJson.bodyFormat])).toEqual([[2, "html"], [3, "doc"]]);
  expect(s.store.capturedVersion()).toBe(3);
});

it("saves a draft through the statements transaction without a revision adapter", async () => {
  const s = setup("html", "editor");
  delete s.deps.revisions;
  const transaction = vi.spyOn(s.deps.statements, "transaction");
  const enqueue = vi.fn<NonNullable<typeof s.deps.outbox>["enqueue"]>(async () => {});
  s.deps.outbox = { enqueue };
  await s.store.read();
  await s.store.write({ html: "<p>Updated draft</p>" });
  expect(s.row()).toMatchObject({ body_html: "<p>Updated draft</p>", version: 2 });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(enqueue).toHaveBeenCalledExactlyOnceWith({
    id: "p-content.saved-2", name: "content.saved", occurredAt: "1970-01-01T00:00:00.000Z", aggregateId: "p", workspaceId: "w",
    payload: { entryId: "p", contentType: "page", actorId: "editor", source: "service" },
  });
});

it("does not append a revision or publish after a late matching-basis write loses its CAS", async () => {
  const s = setup();
  await s.store.read();
  s.update.mockResolvedValueOnce(0);
  const enqueue = vi.fn<NonNullable<typeof s.deps.outbox>["enqueue"]>(async () => {});
  s.deps.outbox = { enqueue };
  const proposed = s.store.write({ html: "<p>Change</p>" });
  await expect(proposed).rejects.toBeInstanceOf(PageConcurrentEditError);
  await expect(proposed).rejects.toThrow("page 'p' was edited elsewhere since this turn started — re-read and retry");
  expect(s.revisions()).toEqual([]);
  expect(enqueue).not.toHaveBeenCalled();
  expect(s.row()).toMatchObject({ body_html: "<p>same</p>", version: 1 });
});

it("leaves matching restored HTML untouched but refuses a late restore CAS loss", async () => {
  const s = setup();
  await s.store.restore({ inverse: { format: "html", html: "<p>same</p>" }, expectedVersion: 1 });
  expect(s.update).not.toHaveBeenCalled();
  expect(s.revisions()).toEqual([]);
  s.update.mockResolvedValueOnce(0);
  const restored = s.store.restore({ inverse: { format: "html", html: "<p>Old body</p>" }, expectedVersion: 1 });
  await expect(restored).rejects.toBeInstanceOf(PageConcurrentEditError);
  await expect(restored).rejects.toThrow("page 'p' changed after this edit was made — the newer version was kept");
  expect(s.row()).toMatchObject({ body_html: "<p>same</p>", version: 1 });
  expect(s.revisions()).toEqual([]);
});
