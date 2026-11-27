import { expect, it, vi } from "vitest";
import { emailTemplateStore, type EmailTemplateDeps } from "../email-template-store.js";
import { EMAIL_TEMPLATE_KIND } from "../post.js";
import { InMemoryPagesHtmlDocumentStore } from "../../pages/html-document-store.memory.js";
import { PageConcurrentEditError } from "../../pages/html-document-store.js";
import { NOW, WORKSPACE, postClock, postRepo, postRow } from "./post-coverage.fixture.js";

class TemplateNotFound extends Error {}
const template = (fields: Parameters<typeof postRow>[0] = {}) => postRow({
  id: "template-1", kind: EMAIL_TEMPLATE_KIND, slug: "email-template:template-1", title: "Welcome",
  bodyFormat: "html", bodyHtml: "<h1>Welcome</h1>", ...fields,
});
function setup(rows: ReturnType<typeof postRow>[] = []) {
  const repo = postRepo(rows);
  const pagesHtmlStore = vi.fn<EmailTemplateDeps["pagesHtmlStore"]>((scope, options) =>
    new InMemoryPagesHtmlDocumentStore({ scope, deps: {
      repo, clock: postClock, ...(options?.allowedKinds ? { allowedKinds: options.allowedKinds } : {}),
      reportUnindexedRef: () => {}, restoredEntryRefs: () => [],
    } }));
  const deps: EmailTemplateDeps = { workspaceId: WORKSPACE, postRepo: repo, pagesHtmlStore, clock: postClock,
    idGen: { newId: () => "new-template" }, PageConcurrentEditError, EmailTemplateNotFoundError: TemplateNotFound };
  return { repo, deps, store: emailTemplateStore({ deps }), pagesHtmlStore };
}

it("creates the template through the HTML store in its own namespace and reads back the converted row", async () => {
  const s = setup();
  const created = await s.store.create({ name: "Welcome", seedHtml: "<p>Hello</p>", actorId: "editor" });
  expect(s.pagesHtmlStore).toHaveBeenCalledExactlyOnceWith({ workspaceId: WORKSPACE, postId: "new-template", actorId: "editor" }, { allowedKinds: new Set(["email-template"]) });
  expect(created).toEqual({ id: "new-template", name: "Welcome", html: "<p>Hello</p>", version: 2, updatedAt: NOW });
  expect(await s.store.find({ id: "new-template" })).toEqual(created);
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: "new-template" })).toMatchObject({
    title: "Welcome", status: "draft", kind: "email-template", slug: "email-template:new-template", bodyFormat: "html", bodyHtml: "<p>Hello</p>", version: 2,
  });
});

it.each([
  { reason: "missing", row: null },
  { reason: "non-template", row: template({ kind: "page" }) },
  { reason: "doc format", row: template({ bodyFormat: "doc" }) },
  { reason: "null HTML", row: template({ bodyHtml: null }) },
  { reason: "trashed", row: template({ deletedAt: NOW }) },
  { reason: "elsewhere", row: template({ workspaceId: "other" }) },
])("does not expose or rename a $reason template row", async ({ row }) => {
  const s = setup(row ? [row] : []);
  expect(await s.store.find({ id: "template-1" })).toBeNull();
  expect(await s.store.rename({ id: "template-1", name: "New name", ifVersion: 4 })).toBe(false);
  expect(await s.repo.list({ workspaceId: row?.workspaceId ?? WORKSPACE })).toEqual(row ? [row] : []);
});

it("a stale HTML session cannot overwrite a successful edit", async () => {
  const s = setup([template()]);
  const stale = await s.store.openHtml({ id: "template-1", actorId: "first-editor" });
  const fresh = await s.store.openHtml({ id: "template-1", actorId: "second-editor" });
  expect(stale.version).toBe(4);
  expect(fresh.version).toBe(4);
  expect(await fresh.write({ html: "<p>The newer design</p>" })).toBe(true);
  expect(await stale.write({ html: "<p>The stale design</p>" })).toBe(false);
  expect(await s.store.find({ id: "template-1" })).toEqual({
    id: "template-1", name: "Welcome", html: "<p>The newer design</p>", version: 5, updatedAt: NOW,
  });
  expect((await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "template-1" })).map(({ seq, actorId }) => [seq, actorId])).toEqual([[5, "second-editor"]]);
});

it("does not mistake an infrastructure write error for a stale HTML session", async () => {
  const s = setup([template()]);
  const failure = new Error("write disconnected");
  s.pagesHtmlStore.mockReturnValueOnce({ read: async () => "<h1>Welcome</h1>", capturedVersion: () => 4,
    ensureHtmlFormat: async () => { throw new Error("Unexpected conversion"); }, write: async () => { throw failure; } });
  const session = await s.store.openHtml({ id: "template-1", actorId: "editor" });
  await expect(session.write({ html: "<p>Replacement</p>" })).rejects.toBe(failure);
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: "template-1" })).toEqual(template());
});

it("renames only via a matched version and leaves HTML and revisions alone", async () => {
  const s = setup([template()]);
  expect(await s.store.rename({ id: "template-1", name: "Early edit", ifVersion: 3 })).toBe(false);
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: "template-1" })).toEqual(template());
  expect(await s.store.rename({ id: "template-1", name: "New name", ifVersion: 4 })).toBe(true);
  expect(await s.store.find({ id: "template-1" })).toEqual({
    id: "template-1", name: "New name", html: "<h1>Welcome</h1>", version: 5, updatedAt: NOW,
  });
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "template-1" })).toEqual([]);
  expect(s.pagesHtmlStore).not.toHaveBeenCalled();
});

it("paginates only HTML templates in the selected workspace using the id tie-break", async () => {
  const s = setup([
    template({ id: "b" }), template({ id: "c", updatedAt: "2026-11-20T00:00:00.000Z" }),
    template({ id: "other", workspaceId: "other" }), template({ id: "a" }),
    template({ id: "t", deletedAt: NOW }), template({ id: "page", kind: "page" }),
  ]);
  const one = { id: "a", name: "Welcome", html: "<h1>Welcome</h1>", version: 4, updatedAt: "2026-11-24T12:00:00.000Z" };
  expect(await s.store.listPage({ limit: 1 })).toEqual([one]);
  expect(await s.store.listPage({ limit: 2, before: { id: "a", updatedAt: "2026-11-24T12:00:00.000Z" } }))
    .toEqual([{ ...one, id: "b" }, { ...one, id: "c", updatedAt: "2026-11-20T00:00:00.000Z" }]);
});

it("reports a broken conversion and rolls back the unconverted template", async () => {
  const s = setup();
  s.pagesHtmlStore.mockReturnValueOnce({ ensureHtmlFormat: async () => {}, read: async () => "unused",
    write: async () => { throw new Error("Unexpected ordinary write"); }, capturedVersion: () => null });
  const result = s.store.create({ name: "Welcome", seedHtml: "<p>Hello</p>", actorId: "editor" });
  await expect(result).rejects.toBeInstanceOf(TemplateNotFound);
  await expect(result).rejects.toThrow("email template 'new-template' was not found");
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual([]);
});

it("preserves the page position of a stale candidate without exposing unrelated content", async () => {
  const s = setup();
  const list = vi.spyOn(s.repo, "listHtmlByKind").mockResolvedValueOnce([
    template({ kind: "page" }), template({ id: "valid" }), template({ deletedAt: NOW }),
  ]);
  expect(await s.store.listPage({ limit: 3 })).toEqual([
    null, { id: "valid", name: "Welcome", html: "<h1>Welcome</h1>", version: 4, updatedAt: "2026-11-24T12:00:00.000Z" }, null,
  ]);
  expect(list).toHaveBeenCalledExactlyOnceWith({ workspaceId: WORKSPACE, kind: "email-template", limit: 3 });
});

it("reports an unavailable list capability rather than showing an empty library", async () => {
  const s = setup([template()]);
  Object.defineProperty(s.repo, "listHtmlByKind", { value: undefined });
  await expect(s.store.listPage({ limit: 10 })).rejects.toThrow("Template listing is unavailable.");
});
