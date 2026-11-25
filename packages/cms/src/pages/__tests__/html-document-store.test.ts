import { expect, it, vi } from "vitest";
import { PageConcurrentEditError, SqlPagesHtmlDocumentStore, type PageHtmlStatements, type PageHtmlStatementRow, type PagesHtmlDocumentStoreDeps } from "../html-document-store.js";
import type { PostRevisionInput } from "../../posts/post.js";

function setup(bodyFormat = "html") {
  let row: PageHtmlStatementRow = { id: "p", workspace_id: "w", kind: "page", status: "draft", publish_at: null, updated_at: "old", deleted_at: null, body_html: bodyFormat === "html" ? "<p>same</p>" : null, body_format: bodyFormat, version: 1 };
  let revisions: PostRevisionInput[] = [];
  const transaction = async <T>({ fn }: { fn: () => Promise<T> }) => { const before = row; const revs = [...revisions]; try { return await fn(); } catch (error) { row = before; revisions = revs; throw error; } };
  const update = vi.fn<PageHtmlStatements["update"]>(async ({ set, guard }) => { if (guard.version !== row.version) return 0; row = { ...row, ...set }; return 1; });
  const statements: PageHtmlStatements = { readBody: async () => row, readForConversion: async () => row, readForWrite: async () => row,
    readDeletedAt: async () => ({ deleted_at: row.deleted_at }), update, transaction };
  const deps: PagesHtmlDocumentStoreDeps = { statements, clock: { nowMs: () => 0 }, reportUnindexedRef: () => {}, restoredEntryRefs: () => [],
    revisions: { transaction, findById: async () => ({ id: "p", workspaceId: "w", title: "P", slug: "p", bodyJson: { type: "doc", content: [] }, kind: "page", status: "draft", bodyFormat: row.body_format as "html" | "doc", bodyHtml: row.body_html, version: row.version, updatedAt: row.updated_at }),
      listRevisions: async () => revisions.map((r, i) => ({ ...r, id: String(i), contentHash: "hash" })),
      appendRevision: async input => { revisions.push(input); return { id: "revision", previousId: null }; } } };
  const store = new SqlPagesHtmlDocumentStore({ scope: { workspaceId: "w", postId: "p" }, deps });
  return { store, deps, update, row: () => row, setRow: (value: PageHtmlStatementRow) => { row = value; }, revisions: () => revisions };
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
